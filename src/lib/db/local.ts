import Dexie, { type Table } from "dexie";

import type {
	Account,
	Category,
	Transaction,
	DbConfig,
	DashboardStats,
	SyncMeta,
	GoldItem,
	ZakatCalculation,
	ZakatPayment,
} from "@/types";

class MizanTrackDB extends Dexie {
	accounts!: Table<Account>;
	categories!: Table<Category>;
	transactions!: Table<Transaction>;
	dbConfig!: Table<DbConfig>;
	syncMeta!: Table<SyncMeta>;
	dashboardStats!: Table<DashboardStats>;
	goldItems!: Table<GoldItem>;
	zakatCalculations!: Table<ZakatCalculation>;
	zakatPayments!: Table<ZakatPayment>;

	constructor() {
		super("mizantrack");
		this.version(1).stores({
			accounts: "id, userId, isArchived, updatedAt, deletedAt",
			categories: "id, userId, type, updatedAt, deletedAt",
			transactions:
				"id, userId, type, date, accountId, categoryId, toAccountId, updatedAt, deletedAt",
			dbConfig: "id",
			syncMeta: "id",
		});

		// Version 2: Add zakat-related tables
		this.version(2).stores({
			accounts: "id, userId, isArchived, accountType, updatedAt, deletedAt",
			categories: "id, userId, type, updatedAt, deletedAt",
			transactions:
				"id, userId, type, date, accountId, categoryId, toAccountId, updatedAt, deletedAt",
			dbConfig: "id",
			syncMeta: "id",
			goldItems: "id, userId, purity, updatedAt, deletedAt",
			zakatCalculations: "id, userId, islamicYear, assessmentDate, updatedAt, deletedAt",
			zakatPayments: "id, userId, islamicYear, date, calculationId, updatedAt, deletedAt",
		});

		// Version 3: Add precomputed dashboard analytics cache
		this.version(3).stores({
			accounts: "id, userId, isArchived, accountType, updatedAt, deletedAt",
			categories: "id, userId, type, updatedAt, deletedAt",
			transactions:
				"id, userId, type, date, accountId, categoryId, toAccountId, updatedAt, deletedAt",
			dbConfig: "id",
			syncMeta: "id",
			dashboardStats: "id, updatedAt",
			goldItems: "id, userId, purity, updatedAt, deletedAt",
			zakatCalculations: "id, userId, islamicYear, assessmentDate, updatedAt, deletedAt",
			zakatPayments: "id, userId, islamicYear, date, calculationId, updatedAt, deletedAt",
		});

		this.version(4).stores({
			accounts: "id, userId, isArchived, accountType, updatedAt, deletedAt",
			categories: "id, userId, type, currency, updatedAt, deletedAt",
			transactions:
				"id, userId, type, date, accountId, categoryId, toAccountId, updatedAt, deletedAt",
			dbConfig: "id",
			syncMeta: "id",
			dashboardStats: "id, updatedAt",
			goldItems: "id, userId, purity, updatedAt, deletedAt",
			zakatCalculations: "id, userId, islamicYear, assessmentDate, updatedAt, deletedAt",
			zakatPayments: "id, userId, islamicYear, date, calculationId, updatedAt, deletedAt",
		});

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
