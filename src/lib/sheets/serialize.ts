import { db } from "@/lib/db/local";
import {
	MIZAN_TRACK_BACKUP_ENCODING,
	MIZAN_TRACK_BACKUP_SHEETS,
	SECURITY_EXCLUDED_DB_CONFIG_FIELDS,
} from "@/lib/export";
import { SHEETS_META_TAB } from "@/lib/sheets/constants";

import type { Account, DbConfig, Transaction } from "@/types";

const UNDEFINED_SENTINEL = "__MIZANTRACK_UNDEFINED_V1__";

export interface SerializedSheetTab {
	entity: string;
	sheetName: string;
	columns: readonly string[];
	rows: string[][];
	rowCount: number;
}

export interface SheetsBackupSnapshot {
	currency: string;
	startedAt: number;
	tabs: SerializedSheetTab[];
	rowCounts: Record<string, number>;
	totalRows: number;
}

function normalizeCurrency(value?: string): string {
	return value?.trim().toUpperCase() ?? "";
}

function encodeBackupCell(value: unknown): string {
	if (value === undefined) return UNDEFINED_SENTINEL;
	return JSON.stringify(value);
}

function rowsFromRecords(columns: readonly string[], records: readonly object[]): string[][] {
	return [
		[...columns],
		...records.map((record) =>
			columns.map((column) => encodeBackupCell((record as Record<string, unknown>)[column]))
		),
	];
}

function belongsToCurrency(recordCurrency: string | undefined, currency: string): boolean {
	const normalizedRecordCurrency = normalizeCurrency(recordCurrency);
	return !normalizedRecordCurrency || normalizedRecordCurrency === currency;
}

function filterTransactionsByCurrency(
	transactions: Transaction[],
	accounts: Account[],
	currency: string
): Transaction[] {
	const accountIds = new Set(
		accounts
			.filter((account) => normalizeCurrency(account.currency) === currency)
			.map((account) => account.id)
	);
	return transactions.filter(
		(transaction) =>
			accountIds.has(transaction.accountId) ||
			(Boolean(transaction.toAccountId) && accountIds.has(transaction.toAccountId!))
	);
}

function filterDbConfig(config: DbConfig | undefined): Partial<DbConfig>[] {
	if (!config) return [];
	const excluded = new Set<string>(SECURITY_EXCLUDED_DB_CONFIG_FIELDS);
	const safeConfig: Partial<DbConfig> = {};
	for (const definition of MIZAN_TRACK_BACKUP_SHEETS) {
		if (definition.entity !== "DbConfig") continue;
		for (const column of definition.columns) {
			if (!excluded.has(column)) {
				(safeConfig as Record<string, unknown>)[column] = (
					config as unknown as Record<string, unknown>
				)[column];
			}
		}
	}
	return [safeConfig];
}

async function loadRecordsForCurrency(userId: string, currency: string) {
	const [
		accounts,
		categories,
		transactions,
		budgets,
		goldItems,
		zakatCalculations,
		zakatPayments,
		config,
		syncMeta,
		dashboardStats,
	] = await Promise.all([
		db.accounts.where("userId").equals(userId).toArray(),
		db.categories.where("userId").equals(userId).toArray(),
		db.transactions.where("userId").equals(userId).toArray(),
		db.budgets.where("userId").equals(userId).toArray(),
		db.goldItems.where("userId").equals(userId).toArray(),
		db.zakatCalculations.where("userId").equals(userId).toArray(),
		db.zakatPayments.where("userId").equals(userId).toArray(),
		db.dbConfig.get(userId),
		db.syncMeta.toArray(),
		db.dashboardStats.get(userId),
	]);

	const currencyAccounts = accounts.filter(
		(account) => normalizeCurrency(account.currency) === currency
	);

	return {
		Account: currencyAccounts,
		Category: categories.filter((category) => belongsToCurrency(category.currency, currency)),
		Transaction: filterTransactionsByCurrency(transactions, accounts, currency),
		Budget: budgets.filter((budget) => belongsToCurrency(budget.currency, currency)),
		GoldItem: goldItems.filter((item) => normalizeCurrency(item.currency) === currency),
		ZakatCalculation: zakatCalculations.filter(
			(calculation) => normalizeCurrency(calculation.currency) === currency
		),
		ZakatPayment: zakatPayments.filter(
			(payment) => normalizeCurrency(payment.currency) === currency
		),
		DbConfig: filterDbConfig(config),
		SyncMeta: syncMeta,
		DashboardStats: dashboardStats ? [dashboardStats] : [],
	} satisfies Record<string, readonly object[]>;
}

export async function collectSheetsBackupSnapshot(
	userId: string,
	currency: string
): Promise<SheetsBackupSnapshot> {
	const normalizedCurrency = normalizeCurrency(currency);
	const startedAt = Date.now();
	const byEntity = await loadRecordsForCurrency(userId, normalizedCurrency);
	const tabs = MIZAN_TRACK_BACKUP_SHEETS.map((definition) => {
		const records = byEntity[definition.entity] ?? [];
		return {
			entity: definition.entity,
			sheetName: definition.sheetName,
			columns: definition.columns,
			rows: rowsFromRecords(definition.columns, records),
			rowCount: records.length,
		} satisfies SerializedSheetTab;
	});
	const rowCounts = Object.fromEntries(tabs.map((tab) => [tab.sheetName, tab.rowCount]));
	return {
		currency: normalizedCurrency,
		startedAt,
		tabs,
		rowCounts,
		totalRows: tabs.reduce((sum, tab) => sum + tab.rows.length, 0),
	};
}

export function buildMetaRows(values: Record<string, unknown>): string[][] {
	return [
		["Key", "Value"],
		["encoding", MIZAN_TRACK_BACKUP_ENCODING],
		...Object.entries(values).map(([key, value]) => [key, encodeBackupCell(value)]),
	];
}

export function getAllRequiredSheetTitles(): string[] {
	return [SHEETS_META_TAB, ...MIZAN_TRACK_BACKUP_SHEETS.map((definition) => definition.sheetName)];
}
