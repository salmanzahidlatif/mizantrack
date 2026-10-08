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
		details?: Array<{
			reason?: string;
			metadata?: Record<string, string>;
		}>;
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

function getGoogleErrorReasons(payload: GoogleErrorPayload): string[] {
	return (
		payload.error?.details
			?.map((detail) => detail.reason)
			.filter((reason): reason is string => Boolean(reason)) ?? []
	);
}

async function parseGoogleError(response: Response): Promise<GoogleSheetsBackupError> {
	const payload = (await response.json().catch(() => ({}))) as GoogleErrorPayload;
	const status = payload.error?.status;
	const message = payload.error?.message ?? `Google API request failed with ${response.status}.`;
	const lowerMessage = message.toLowerCase();
	const reasons = getGoogleErrorReasons(payload);
	if (response.status === 401) {
		return new GoogleSheetsBackupError("RequiresReconnect", undefined, 401);
	}
	if (response.status === 403) {
		if (
			status === "PERMISSION_DENIED" &&
			(lowerMessage.includes("insufficient authentication scopes") ||
				lowerMessage.includes("access_token_scope_insufficient"))
		) {
			return new GoogleSheetsBackupError(
				"NotConnected",
				"Google Drive file permission was not granted. Reconnect Google Sheets and approve https://www.googleapis.com/auth/drive.file only.",
				403
			);
		}
		if (
			reasons.includes("SERVICE_DISABLED") ||
			lowerMessage.includes("has not been used") ||
			lowerMessage.includes("is disabled") ||
			lowerMessage.includes("api has not been")
		) {
			return new GoogleSheetsBackupError(
				"GoogleApiError",
				"Google Sheets or Google Drive API is not enabled for this OAuth project. In Google Cloud Console → APIs & Services → Library, enable both APIs, then try again.",
				403
			);
		}
		return new GoogleSheetsBackupError(
			"GoogleApiError",
			`${message} Check that both Google Sheets API and Google Drive API are enabled for the OAuth project.`,
			403
		);
	}
	if (response.status === 404) {
		return new GoogleSheetsBackupError("SheetMissing", undefined, 404);
	}
	if (response.status === 429 || status === "RESOURCE_EXHAUSTED") {
		return new GoogleSheetsBackupError("QuotaExceeded", undefined, 429);
	}
	return new GoogleSheetsBackupError(
		response.status >= 500 ? "GoogleServerError" : "GoogleApiError",
		response.status >= 500 ? undefined : message,
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
	const result = await googleApiFetch<{ updatedRows?: number }>(
		accessToken,
		`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}?valueInputOption=RAW`,
		{ method: "PUT", body: JSON.stringify({ values: rows }) }
	);
	if (typeof result.updatedRows === "number" && result.updatedRows < rows.length) {
		throw new GoogleSheetsBackupError(
			"PartialWrite",
			`Google wrote ${result.updatedRows} of ${rows.length} requested row(s) to ${sheetName}. Run Back up now again.`
		);
	}
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
