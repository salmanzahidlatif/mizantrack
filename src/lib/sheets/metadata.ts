import { db } from "@/lib/db/local";

import type { GoogleSheetsCurrencyBackupState, SyncMeta } from "@/types";

const PREFIX = "googleSheetsBackup:";

export function normalizeSheetsCurrency(currency: string): string {
	return currency.trim().toUpperCase();
}

export function getSheetsStateId(currency: string): string {
	return `${PREFIX}${normalizeSheetsCurrency(currency)}`;
}

function sanitizeState(currency: string, state?: Partial<GoogleSheetsCurrencyBackupState>) {
	return {
		currency: normalizeSheetsCurrency(currency),
		selected: state?.selected ?? true,
		spreadsheetId: state?.spreadsheetId,
		spreadsheetUrl: state?.spreadsheetUrl,
		spreadsheetName: state?.spreadsheetName,
		lastBackupAt: state?.lastBackupAt,
		lastBackupStartedAt: state?.lastBackupStartedAt,
		lastBackupCompletedAt: state?.lastBackupCompletedAt,
		lastStatus: state?.lastStatus ?? "idle",
		lastError: state?.lastError,
		rowCounts: state?.rowCounts,
	} satisfies GoogleSheetsCurrencyBackupState;
}

export async function getSheetsCurrencyState(
	currency: string
): Promise<GoogleSheetsCurrencyBackupState | undefined> {
	const normalizedCurrency = normalizeSheetsCurrency(currency);
	const record = await db.syncMeta.get(getSheetsStateId(normalizedCurrency));
	if (!record) return undefined;
	return sanitizeState(normalizedCurrency, record as SyncMeta & GoogleSheetsCurrencyBackupState);
}

export async function listSheetsCurrencyStates(): Promise<GoogleSheetsCurrencyBackupState[]> {
	const records = await db.syncMeta.filter((record) => record.id.startsWith(PREFIX)).toArray();
	return records.map((record) => {
		const currency = record.id.slice(PREFIX.length);
		return sanitizeState(currency, record as SyncMeta & GoogleSheetsCurrencyBackupState);
	});
}

export async function putSheetsCurrencyState(
	currency: string,
	patch: Partial<GoogleSheetsCurrencyBackupState>
): Promise<GoogleSheetsCurrencyBackupState> {
	const normalizedCurrency = normalizeSheetsCurrency(currency);
	const existing = await getSheetsCurrencyState(normalizedCurrency);
	const next = sanitizeState(normalizedCurrency, { ...existing, ...patch });
	await db.syncMeta.put({
		id: getSheetsStateId(normalizedCurrency),
		timestamp: next.lastBackupAt ?? next.lastBackupStartedAt ?? Date.now(),
		...next,
	} as SyncMeta & GoogleSheetsCurrencyBackupState);
	return next;
}

export async function clearSheetsSpreadsheetState(currency: string): Promise<void> {
	await putSheetsCurrencyState(currency, {
		spreadsheetId: undefined,
		spreadsheetUrl: undefined,
		spreadsheetName: undefined,
	});
}
