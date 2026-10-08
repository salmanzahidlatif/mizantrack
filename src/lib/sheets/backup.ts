import { chunkSheetRows } from "@/lib/sheets/chunk";
import { SHEETS_META_TAB, SHEETS_BACKUP_SCHEMA_VERSION } from "@/lib/sheets/constants";
import { GoogleSheetsBackupError, getGoogleSheetsErrorMessage } from "@/lib/sheets/errors";
import {
	batchUpdateSpreadsheet,
	clearValuesAfterRow,
	createSpreadsheet,
	getDriveFile,
	getSpreadsheetMetadata,
	listBackupFiles,
	tagDriveFile,
	updateValues,
} from "@/lib/sheets/googleApi";
import {
	clearSheetsSpreadsheetState,
	getSheetsCurrencyState,
	normalizeSheetsCurrency,
	putSheetsCurrencyState,
} from "@/lib/sheets/metadata";
import {
	buildMetaRows,
	collectSheetsBackupSnapshot,
	getAllRequiredSheetTitles,
} from "@/lib/sheets/serialize";
import { fetchGoogleSheetsAccessToken } from "@/lib/sheets/token";

import type { GoogleSheetsBackupProgress, GoogleSheetsCurrencyBackupState } from "@/types";

export interface GoogleSheetsBackupResult {
	currency: string;
	spreadsheetId: string;
	spreadsheetUrl?: string;
	rowCounts: Record<string, number>;
	lastBackupAt: number;
}

export type GoogleSheetsProgressCallback = (progress: GoogleSheetsBackupProgress) => void;

interface ResolvedSpreadsheet {
	spreadsheetId: string;
	spreadsheetUrl?: string;
	spreadsheetName?: string;
	created: boolean;
}

function makeBackupId(currency: string): string {
	return `${currency}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function resolveSpreadsheet(
	accessToken: string,
	userId: string,
	currency: string,
	state?: GoogleSheetsCurrencyBackupState
): Promise<ResolvedSpreadsheet> {
	if (state?.spreadsheetId) {
		try {
			const file = await getDriveFile(accessToken, state.spreadsheetId);
			if (file.trashed) {
				await clearSheetsSpreadsheetState(currency);
			} else {
				return {
					spreadsheetId: file.id,
					spreadsheetUrl: file.webViewLink ?? state.spreadsheetUrl,
					spreadsheetName: file.name ?? state.spreadsheetName,
					created: false,
				};
			}
		} catch (error) {
			if (error instanceof GoogleSheetsBackupError && error.code === "SheetMissing") {
				await clearSheetsSpreadsheetState(currency);
			} else {
				throw error;
			}
		}
	}

	const matches = await listBackupFiles(accessToken, userId, currency);
	const reusable = matches.find((file) => !file.trashed);
	if (reusable) {
		return {
			spreadsheetId: reusable.id,
			spreadsheetUrl: reusable.webViewLink,
			spreadsheetName: reusable.name,
			created: false,
		};
	}

	const created = await createSpreadsheet(accessToken, currency);
	await tagDriveFile(accessToken, created.spreadsheetId, userId, currency);
	return {
		spreadsheetId: created.spreadsheetId,
		spreadsheetUrl: created.spreadsheetUrl,
		spreadsheetName: `MizanTrack Backup - ${currency}`,
		created: true,
	};
}

async function ensureSheetTabs(
	accessToken: string,
	spreadsheetId: string,
	created: boolean
): Promise<void> {
	const metadata = await getSpreadsheetMetadata(accessToken, spreadsheetId);
	const existingTitles = new Set((metadata.sheets ?? []).map((sheet) => sheet.properties.title));
	const addSheetRequests = getAllRequiredSheetTitles()
		.filter((title) => !existingTitles.has(title))
		.map((title) => ({ addSheet: { properties: { title } } }));
	const formatRequests = created
		? (metadata.sheets ?? []).map((sheet) => ({
				updateSheetProperties: {
					properties: {
						sheetId: sheet.properties.sheetId,
						gridProperties: { frozenRowCount: 1 },
					},
					fields: "gridProperties.frozenRowCount",
				},
			}))
		: [];
	await batchUpdateSpreadsheet(accessToken, spreadsheetId, [
		...addSheetRequests,
		...formatRequests,
	]);
}

async function writeMeta(
	accessToken: string,
	spreadsheetId: string,
	values: Record<string, unknown>
): Promise<void> {
	await updateValues(accessToken, spreadsheetId, SHEETS_META_TAB, 1, buildMetaRows(values));
}

export async function backupGoogleSheetsCurrency(
	userId: string,
	currency: string,
	onProgress?: GoogleSheetsProgressCallback
): Promise<GoogleSheetsBackupResult> {
	const normalizedCurrency = normalizeSheetsCurrency(currency);
	if (!normalizedCurrency) {
		throw new GoogleSheetsBackupError("GoogleApiError", "Choose a currency to back up.");
	}
	if (typeof navigator !== "undefined" && navigator.onLine === false) {
		throw new GoogleSheetsBackupError("Offline", "You're offline. Backup needs a connection.");
	}

	const { accessToken } = await fetchGoogleSheetsAccessToken();
	const state = await getSheetsCurrencyState(normalizedCurrency);
	const snapshot = await collectSheetsBackupSnapshot(userId, normalizedCurrency);
	const backupId = makeBackupId(normalizedCurrency);
	const spreadsheet = await resolveSpreadsheet(accessToken, userId, normalizedCurrency, state);
	await putSheetsCurrencyState(normalizedCurrency, {
		selected: state?.selected ?? true,
		spreadsheetId: spreadsheet.spreadsheetId,
		spreadsheetUrl: spreadsheet.spreadsheetUrl,
		spreadsheetName: spreadsheet.spreadsheetName,
		lastBackupStartedAt: snapshot.startedAt,
		lastStatus: "in_progress",
		lastError: undefined,
	});

	try {
		await ensureSheetTabs(accessToken, spreadsheet.spreadsheetId, spreadsheet.created);
		await writeMeta(accessToken, spreadsheet.spreadsheetId, {
			schemaVersion: SHEETS_BACKUP_SCHEMA_VERSION,
			userId,
			currency: normalizedCurrency,
			backupId,
			status: "in_progress",
			startedAt: new Date(snapshot.startedAt).toISOString(),
			rowCounts: snapshot.rowCounts,
		});

		for (const tab of snapshot.tabs) {
			let written = 0;
			for (const chunk of chunkSheetRows(tab.rows)) {
				await updateValues(
					accessToken,
					spreadsheet.spreadsheetId,
					tab.sheetName,
					chunk.startRow,
					chunk.rows
				);
				written += chunk.rows.length;
				onProgress?.({
					currency: normalizedCurrency,
					tab: tab.sheetName,
					rowsWritten: Math.min(written, tab.rows.length),
					totalRows: tab.rows.length,
				});
			}
			await clearValuesAfterRow(
				accessToken,
				spreadsheet.spreadsheetId,
				tab.sheetName,
				tab.rows.length + 1
			);
		}

		const completedAt = Date.now();
		await writeMeta(accessToken, spreadsheet.spreadsheetId, {
			schemaVersion: SHEETS_BACKUP_SCHEMA_VERSION,
			userId,
			currency: normalizedCurrency,
			backupId,
			status: "complete",
			startedAt: new Date(snapshot.startedAt).toISOString(),
			completedAt: new Date(completedAt).toISOString(),
			rowCounts: snapshot.rowCounts,
		});
		await putSheetsCurrencyState(normalizedCurrency, {
			selected: state?.selected ?? true,
			spreadsheetId: spreadsheet.spreadsheetId,
			spreadsheetUrl: spreadsheet.spreadsheetUrl,
			spreadsheetName: spreadsheet.spreadsheetName,
			lastBackupAt: completedAt,
			lastBackupCompletedAt: completedAt,
			lastStatus: "success",
			lastError: undefined,
			rowCounts: snapshot.rowCounts,
		});
		return {
			currency: normalizedCurrency,
			spreadsheetId: spreadsheet.spreadsheetId,
			spreadsheetUrl: spreadsheet.spreadsheetUrl,
			rowCounts: snapshot.rowCounts,
			lastBackupAt: completedAt,
		};
	} catch (error) {
		const message = getGoogleSheetsErrorMessage(error);
		await putSheetsCurrencyState(normalizedCurrency, {
			selected: state?.selected ?? true,
			spreadsheetId: spreadsheet.spreadsheetId,
			spreadsheetUrl: spreadsheet.spreadsheetUrl,
			spreadsheetName: spreadsheet.spreadsheetName,
			lastStatus: "failed",
			lastError: message,
		});
		await writeMeta(accessToken, spreadsheet.spreadsheetId, {
			schemaVersion: SHEETS_BACKUP_SCHEMA_VERSION,
			userId,
			currency: normalizedCurrency,
			backupId,
			status: "failed",
			startedAt: new Date(snapshot.startedAt).toISOString(),
			failedAt: new Date().toISOString(),
			error: message,
			rowCounts: snapshot.rowCounts,
		}).catch(() => undefined);
		throw error;
	}
}

export async function backupGoogleSheetsCurrencies(
	userId: string,
	currencies: readonly string[],
	onProgress?: GoogleSheetsProgressCallback
): Promise<GoogleSheetsBackupResult[]> {
	const results: GoogleSheetsBackupResult[] = [];
	for (const currency of currencies) {
		results.push(await backupGoogleSheetsCurrency(userId, currency, onProgress));
	}
	return results;
}
