import {
	SHEETS_BACKUP_APP_PROPERTY,
	SHEETS_BACKUP_APP_PROPERTY_VALUE,
	SHEETS_BACKUP_CURRENCY_PROPERTY,
	SHEETS_BACKUP_USER_PROPERTY,
	SHEETS_META_TAB,
} from "@/lib/sheets/constants";
import { GoogleSheetsBackupError } from "@/lib/sheets/errors";

interface GoogleErrorPayload {
	error?: {
		code?: number;
		message?: string;
		status?: string;
	};
}

export interface DriveFileMetadata {
	id: string;
	name?: string;
	trashed?: boolean;
	webViewLink?: string;
	modifiedTime?: string;
}

export interface SpreadsheetMetadata {
	spreadsheetId: string;
	spreadsheetUrl?: string;
	properties?: { title?: string };
	sheets?: Array<{
		properties: {
			sheetId: number;
			title: string;
			gridProperties?: { rowCount?: number; columnCount?: number };
		};
	}>;
}

export interface CreatedSpreadsheet {
	spreadsheetId: string;
	spreadsheetUrl?: string;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
	return status === 429 || status >= 500;
}

async function parseGoogleError(response: Response): Promise<GoogleSheetsBackupError> {
	const payload = (await response.json().catch(() => ({}))) as GoogleErrorPayload;
	const status = payload.error?.status;
	const message = payload.error?.message ?? `Google API request failed with ${response.status}.`;
	if (response.status === 401) {
		return new GoogleSheetsBackupError(
			"RequiresReconnect",
			"Google requires reconnecting Sheets.",
			401
		);
	}
	if (response.status === 403) {
		return new GoogleSheetsBackupError("NotConnected", message, 403);
	}
	if (response.status === 404) {
		return new GoogleSheetsBackupError("SheetMissing", "Backup spreadsheet was not found.", 404);
	}
	if (response.status === 429 || status === "RESOURCE_EXHAUSTED") {
		return new GoogleSheetsBackupError(
			"QuotaExceeded",
			"Google is rate-limiting this backup.",
			429
		);
	}
	return new GoogleSheetsBackupError(
		response.status >= 500 ? "GoogleServerError" : "GoogleApiError",
		message,
		response.status
	);
}

export async function googleApiFetch<T>(
	accessToken: string,
	url: string,
	init: RequestInit = {},
	attempts = 5
): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt < attempts; attempt++) {
		const response = await fetch(url, {
			...init,
			headers: {
				Authorization: `Bearer ${accessToken}`,
				...(init.body ? { "Content-Type": "application/json" } : {}),
				...init.headers,
			},
			cache: "no-store",
		});
		if (response.ok) {
			if (response.status === 204) return undefined as T;
			return (await response.json().catch(() => ({}))) as T;
		}

		const error = await parseGoogleError(response);
		lastError = error;
		if (!isRetryableStatus(response.status) || attempt === attempts - 1) throw error;
		await sleep(Math.min(2 ** attempt * 1000 + Math.random() * 1000, 32_000));
	}
	throw lastError;
}

function quoteSheetName(sheetName: string): string {
	return `'${sheetName.replaceAll("'", "''")}'`;
}

function encodeRange(sheetName: string, range: string): string {
	return encodeURIComponent(`${quoteSheetName(sheetName)}!${range}`);
}

function driveQueryForCurrency(userId: string, currency: string): string {
	return [
		`appProperties has { key='${SHEETS_BACKUP_APP_PROPERTY}' and value='${SHEETS_BACKUP_APP_PROPERTY_VALUE}' }`,
		`appProperties has { key='${SHEETS_BACKUP_CURRENCY_PROPERTY}' and value='${currency}' }`,
		`appProperties has { key='${SHEETS_BACKUP_USER_PROPERTY}' and value='${userId}' }`,
		"trashed = false",
	].join(" and ");
}

export async function getDriveFile(
	accessToken: string,
	spreadsheetId: string
): Promise<DriveFileMetadata> {
	const fields = "id,name,trashed,webViewLink,modifiedTime";
	return googleApiFetch<DriveFileMetadata>(
		accessToken,
		`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}?fields=${fields}`
	);
}

export async function listBackupFiles(
	accessToken: string,
	userId: string,
	currency: string
): Promise<DriveFileMetadata[]> {
	const params = new URLSearchParams({
		q: driveQueryForCurrency(userId, currency),
		spaces: "drive",
		fields: "files(id,name,trashed,webViewLink,modifiedTime)",
		orderBy: "modifiedTime desc",
	});
	const result = await googleApiFetch<{ files?: DriveFileMetadata[] }>(
		accessToken,
		`https://www.googleapis.com/drive/v3/files?${params}`
	);
	return result.files ?? [];
}

export async function createSpreadsheet(
	accessToken: string,
	currency: string
): Promise<CreatedSpreadsheet> {
	return googleApiFetch<CreatedSpreadsheet>(
		accessToken,
		"https://sheets.googleapis.com/v4/spreadsheets",
		{
			method: "POST",
			body: JSON.stringify({
				properties: { title: `MizanTrack Backup - ${currency}` },
				sheets: [{ properties: { title: SHEETS_META_TAB } }],
			}),
		}
	);
}

export async function tagDriveFile(
	accessToken: string,
	spreadsheetId: string,
	userId: string,
	currency: string
): Promise<void> {
	await googleApiFetch(
		accessToken,
		`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(spreadsheetId)}?fields=id,appProperties,webViewLink`,
		{
			method: "PATCH",
			body: JSON.stringify({
				appProperties: {
					[SHEETS_BACKUP_APP_PROPERTY]: SHEETS_BACKUP_APP_PROPERTY_VALUE,
					[SHEETS_BACKUP_CURRENCY_PROPERTY]: currency,
					[SHEETS_BACKUP_USER_PROPERTY]: userId,
				},
			}),
		}
	);
}

export async function getSpreadsheetMetadata(
	accessToken: string,
	spreadsheetId: string
): Promise<SpreadsheetMetadata> {
	const fields =
		"spreadsheetId,spreadsheetUrl,properties(title),sheets.properties(sheetId,title,gridProperties)";
	return googleApiFetch<SpreadsheetMetadata>(
		accessToken,
		`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent(fields)}`
	);
}

export async function batchUpdateSpreadsheet(
	accessToken: string,
	spreadsheetId: string,
	requests: unknown[]
): Promise<void> {
	if (requests.length === 0) return;
	await googleApiFetch(
		accessToken,
		`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
		{ method: "POST", body: JSON.stringify({ requests }) }
	);
}

export async function updateValues(
	accessToken: string,
	spreadsheetId: string,
	sheetName: string,
	startRow: number,
	rows: string[][]
): Promise<void> {
	const range = encodeRange(sheetName, `A${startRow}`);
	await googleApiFetch(
		accessToken,
		`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}?valueInputOption=RAW`,
		{ method: "PUT", body: JSON.stringify({ values: rows }) }
	);
}

export async function clearValuesAfterRow(
	accessToken: string,
	spreadsheetId: string,
	sheetName: string,
	firstEmptyRow: number
): Promise<void> {
	const range = encodeRange(sheetName, `A${firstEmptyRow}:ZZZ`);
	await googleApiFetch(
		accessToken,
		`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}:clear`,
		{ method: "POST", body: JSON.stringify({}) }
	);
}
