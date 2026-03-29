import Dexie, { type Table } from "dexie";

import type { Account, Category, Transaction, DbConfig, SyncMeta } from "@/types";

class MizanTrackDB extends Dexie {
	accounts!: Table<Account>;
	categories!: Table<Category>;
	transactions!: Table<Transaction>;
	dbConfig!: Table<DbConfig>;
	syncMeta!: Table<SyncMeta>;

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
	}
}

export const db = new MizanTrackDB();
