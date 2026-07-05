import Dexie, { type Table } from "dexie";

import type {
	Account,
	Category,
	Transaction,
	DbConfig,
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
	}
}

export const db = new MizanTrackDB();
