import Dexie, { type Table } from "dexie";

import { buildZakatGoldYearItemBackfill } from "@/lib/zakatGoldYearItems";

import type {
	Account,
	Category,
	Transaction,
	Budget,
	DbConfig,
	DashboardStats,
	SyncMeta,
	GoldItem,
	ZakatCalculation,
	ZakatPayment,
	ReportAccountTag,
	ReportProject,
	ReportTransactionTag,
	ReportManualEntry,
	ReportMonthlySalaryRow,
	ZakatYearOverride,
	ZakatGoldYear,
	ZakatGoldYearItem,
} from "@/types";

export interface SyncDirtyFields {
	pendingSync?: boolean;
}

export const LEGACY_ZAKAT_CURRENCY = "PKR";
export const ZAKAT_CURRENCY_BACKFILL_META_ID = "zakatCurrencyBackfill:PKR:v1";
/**
 * Marks the one-time move of the shared gold inventory into the per-year holdings table.
 * Recorded like the currency backfill so a later upgrade never runs it twice and
 * re-seeds years the owner has since edited.
 */
export const ZAKAT_GOLD_YEAR_ITEMS_BACKFILL_META_ID = "zakatGoldYearItemsBackfill:v1";

/**
 * The highest schema version declared below. Full backups record it so a file written
 * by a newer build is refused with a clear message instead of being half-applied.
 * A test pins this to the opened database's `verno`, so bumping one without the other
 * fails loudly.
 */
export const MIZAN_TRACK_DEXIE_VERSION = 14;

let suppressSyncDirtyTracking = 0;

export async function withoutSyncDirtyTracking<T>(operation: () => Promise<T>): Promise<T> {
	suppressSyncDirtyTracking++;
	try {
		return await operation();
	} finally {
		suppressSyncDirtyTracking--;
	}
}

function isSyncDirtyTrackingSuppressed(): boolean {
	return suppressSyncDirtyTracking > 0;
}

function installSyncDirtyHooks<T extends object>(table: Table<T>): void {
	const trackedTable = table as Table<T & SyncDirtyFields>;

	trackedTable.hook("creating", (_primaryKey, obj) => {
		if (isSyncDirtyTrackingSuppressed()) return;
		obj.pendingSync = true;
	});

	trackedTable.hook("updating", (modifications) => {
		if (isSyncDirtyTrackingSuppressed()) return;

		return {
			...modifications,
			pendingSync: true,
		};
	});
}

type StoreSchema = Record<string, string | null>;

/**
 * Schema versions are cumulative: each version spreads the previous one and only
 * declares what actually changed. A `null` value drops a table in that version.
 */
const STORES_V1: StoreSchema = {
	accounts: "id, userId, isArchived, updatedAt, deletedAt",
	categories: "id, userId, type, updatedAt, deletedAt",
	transactions: "id, userId, type, date, accountId, categoryId, toAccountId, updatedAt, deletedAt",
	dbConfig: "id",
	syncMeta: "id",
};

// Version 2: Add zakat-related tables
const STORES_V2: StoreSchema = {
	...STORES_V1,
	accounts: "id, userId, isArchived, accountType, updatedAt, deletedAt",
	goldItems: "id, userId, purity, updatedAt, deletedAt",
	zakatCalculations: "id, userId, islamicYear, assessmentDate, updatedAt, deletedAt",
	zakatPayments: "id, userId, islamicYear, date, calculationId, updatedAt, deletedAt",
};

// Version 3: Add precomputed dashboard analytics cache
const STORES_V3: StoreSchema = {
	...STORES_V2,
	dashboardStats: "id, updatedAt",
};

// Version 4: Index category currency
const STORES_V4: StoreSchema = {
	...STORES_V3,
	categories: "id, userId, type, currency, updatedAt, deletedAt",
};

// Version 5: Track pending sync state on user-editable tables
const STORES_V5: StoreSchema = {
	...STORES_V4,
	accounts: "id, userId, isArchived, accountType, updatedAt, deletedAt, pendingSync",
	categories: "id, userId, type, currency, updatedAt, deletedAt, pendingSync",
	transactions:
		"id, userId, type, date, accountId, categoryId, toAccountId, updatedAt, deletedAt, pendingSync",
};

// Version 6: Add category currency backfill decisions
const STORES_V6: StoreSchema = {
	...STORES_V5,
	categoryCurrencyBackfillDecisions: "id, userId, categoryId, action, assignedAt",
};

// Version 7: Add [userId+date] compound index for transaction range queries
const STORES_V7: StoreSchema = {
	...STORES_V6,
	transactions:
		"id, userId, [userId+date], type, date, accountId, categoryId, toAccountId, updatedAt, deletedAt, pendingSync",
};

// Version 8: Add budgets and sourceId provenance
const STORES_V8: StoreSchema = {
	...STORES_V7,
	accounts: "id, userId, isArchived, accountType, sourceId, updatedAt, deletedAt, pendingSync",
	categories: "id, userId, type, currency, sourceId, updatedAt, deletedAt, pendingSync",
	transactions:
		"id, userId, [userId+date], type, date, accountId, categoryId, toAccountId, sourceId, updatedAt, deletedAt, pendingSync",
	budgets:
		"id, userId, categoryId, period, [userId+period], [categoryId+period], sourceId, updatedAt, deletedAt, pendingSync",
};

// Version 9: Drop the category currency backfill decisions table
const STORES_V9: StoreSchema = {
	...STORES_V8,
	categoryCurrencyBackfillDecisions: null,
};

// Version 10: Scope zakat data by currency
const STORES_V10: StoreSchema = {
	...STORES_V9,
	goldItems: "id, userId, currency, [userId+currency], purity, updatedAt, deletedAt, pendingSync",
	zakatCalculations:
		"id, userId, currency, [userId+currency], islamicYear, assessmentDate, updatedAt, deletedAt, pendingSync",
	zakatPayments:
		"id, userId, currency, [userId+currency], islamicYear, date, calculationId, updatedAt, deletedAt, pendingSync",
};

// Version 11: Add runtime-report user inputs (no computed report data is ever stored)
const STORES_V11: StoreSchema = {
	...STORES_V10,
	reportAccountTags: "id, userId, accountId, [userId+accountId], updatedAt, deletedAt, pendingSync",
	reportProjects: "id, userId, updatedAt, deletedAt, pendingSync",
	reportTransactionTags:
		"id, userId, transactionId, projectId, [userId+transactionId], role, updatedAt, deletedAt, pendingSync",
	reportManualEntries:
		"id, userId, fiscalYearKey, section, [userId+fiscalYearKey], updatedAt, deletedAt, pendingSync",
	reportMonthlySalaryRows:
		"id, userId, fiscalYearKey, monthKey, [userId+fiscalYearKey], updatedAt, deletedAt, pendingSync",
};

// Version 12: Persist per-year Ramaḍān anchors so the zakat calendar is data, not code.
// Only the anchor is stored — the twelve months are always recomputed from it.
const STORES_V12: StoreSchema = {
	...STORES_V11,
	zakatYears: "id, userId, islamicYear, [userId+islamicYear], updatedAt, deletedAt, pendingSync",
};

// Version 13: Per-year gold pricing. The inventory stays single — only the price per
// gram the owner types for a year (and an optional grams snapshot) belongs to the year.
const STORES_V13: StoreSchema = {
	...STORES_V12,
	zakatGoldYears:
		"id, userId, currency, islamicYear, [userId+currency], [userId+islamicYear], updatedAt, deletedAt, pendingSync",
};

// Version 14: Per-year gold HOLDINGS. Pieces are sold and bought one at a time, so each
// zakat year owns its own itemised list and editing one year can never reach another.
// `goldItems` stays exactly as it is — the current holding, and what the sheet exports
// read — while `lineageId` carries a piece's identity across the years it was held in.
const STORES_V14: StoreSchema = {
	...STORES_V13,
	zakatGoldYearItems:
		"id, userId, currency, islamicYear, lineageId, [userId+currency], [userId+currency+islamicYear], updatedAt, deletedAt, pendingSync",
};

export class MizanTrackDB extends Dexie {
	accounts!: Table<Account>;
	categories!: Table<Category>;
	transactions!: Table<Transaction>;
	budgets!: Table<Budget>;
	dbConfig!: Table<DbConfig>;
	syncMeta!: Table<SyncMeta>;
	dashboardStats!: Table<DashboardStats>;
	goldItems!: Table<GoldItem>;
	zakatCalculations!: Table<ZakatCalculation>;
	zakatPayments!: Table<ZakatPayment>;
	reportAccountTags!: Table<ReportAccountTag>;
	reportProjects!: Table<ReportProject>;
	reportTransactionTags!: Table<ReportTransactionTag>;
	reportManualEntries!: Table<ReportManualEntry>;
	reportMonthlySalaryRows!: Table<ReportMonthlySalaryRow>;
	zakatYears!: Table<ZakatYearOverride>;
	zakatGoldYears!: Table<ZakatGoldYear>;
	zakatGoldYearItems!: Table<ZakatGoldYearItem>;

	constructor(databaseName = "mizantrack") {
		super(databaseName);
		this.version(1).stores(STORES_V1);
		this.version(2).stores(STORES_V2);
		this.version(3).stores(STORES_V3);
		this.version(4).stores(STORES_V4);
		this.version(5).stores(STORES_V5);
		this.version(6).stores(STORES_V6);
		this.version(7).stores(STORES_V7);
		this.version(8).stores(STORES_V8);
		this.version(9).stores(STORES_V9);
		this.version(10)
			.stores(STORES_V10)
			.upgrade(async (tx) => {
				const syncMeta = tx.table<SyncMeta, string>("syncMeta");
				const alreadyBackfilled = await syncMeta.get(ZAKAT_CURRENCY_BACKFILL_META_ID);
				if (alreadyBackfilled) return;

				const backfillCurrency = (record: { currency?: string } & SyncDirtyFields) => {
					if (record.currency) return;
					record.currency = LEGACY_ZAKAT_CURRENCY;
					record.pendingSync = true;
				};

				await tx.table("goldItems").toCollection().modify(backfillCurrency);
				await tx.table("zakatCalculations").toCollection().modify(backfillCurrency);
				await tx.table("zakatPayments").toCollection().modify(backfillCurrency);
				await syncMeta.put({ id: ZAKAT_CURRENCY_BACKFILL_META_ID, timestamp: Date.now() });
			});
		this.version(11).stores(STORES_V11);
		this.version(12).stores(STORES_V12);
		this.version(13).stores(STORES_V13);
		this.version(14)
			.stores(STORES_V14)
			.upgrade(async (tx) => {
				const syncMeta = tx.table<SyncMeta, string>("syncMeta");
				const alreadyBackfilled = await syncMeta.get(ZAKAT_GOLD_YEAR_ITEMS_BACKFILL_META_ID);
				if (alreadyBackfilled) return;

				// Every year the owner already settled keeps the holding it was assessed
				// on. `goldItems` is left untouched: it is still the current holding and
				// still what the sheet exports read.
				const [goldItems, goldYears, calculations] = await Promise.all([
					tx.table<GoldItem, string>("goldItems").toArray(),
					tx.table<ZakatGoldYear, string>("zakatGoldYears").toArray(),
					tx.table<ZakatCalculation, string>("zakatCalculations").toArray(),
				]);
				const rows = buildZakatGoldYearItemBackfill({
					goldItems,
					goldYears,
					calculations,
					now: Date.now(),
				});

				if (rows.length > 0) {
					await tx
						.table<ZakatGoldYearItem, string>("zakatGoldYearItems")
						.bulkPut(rows.map((row) => ({ ...row, pendingSync: true })));
				}
				await syncMeta.put({
					id: ZAKAT_GOLD_YEAR_ITEMS_BACKFILL_META_ID,
					timestamp: Date.now(),
				});
			});

		installSyncDirtyHooks(this.accounts);
		installSyncDirtyHooks(this.categories);
		installSyncDirtyHooks(this.transactions);
		installSyncDirtyHooks(this.budgets);
		installSyncDirtyHooks(this.goldItems);
		installSyncDirtyHooks(this.zakatCalculations);
		installSyncDirtyHooks(this.zakatPayments);
		installSyncDirtyHooks(this.reportAccountTags);
		installSyncDirtyHooks(this.reportProjects);
		installSyncDirtyHooks(this.reportTransactionTags);
		installSyncDirtyHooks(this.reportManualEntries);
		installSyncDirtyHooks(this.reportMonthlySalaryRows);
		installSyncDirtyHooks(this.zakatYears);
		installSyncDirtyHooks(this.zakatGoldYears);
		installSyncDirtyHooks(this.zakatGoldYearItems);

		this.on("blocked", (event) => {
			console.warn("MizanTrack IndexedDB upgrade is blocked by another open app instance.", event);
			if (typeof window !== "undefined") {
				window.dispatchEvent(
					new CustomEvent("mizantrack-db-blocked", {
						detail: {
							oldVersion: event.oldVersion,
							newVersion: event.newVersion,
						},
					})
				);
			}
		});

		this.on("versionchange", (event) => {
			console.warn(
				"Temporarily closing stale MizanTrack IndexedDB connection for schema upgrade.",
				event
			);
			this.close({ disableAutoOpen: false });
			if (typeof window !== "undefined") {
				window.dispatchEvent(
					new CustomEvent("mizantrack-db-versionchange", {
						detail: {
							oldVersion: event.oldVersion,
							newVersion: event.newVersion,
							willAutoReopen: true,
						},
					})
				);
			}
		});
	}
}

export const db = new MizanTrackDB();
