import { scheduleAnalyticsRecompute } from "@/lib/analytics/scheduleRecompute";
import { CORE_SYNC_TABLES } from "@/lib/db/sync";
import { seedDefaultCategories } from "@/lib/db/seed";

import { db } from "./local";

export interface ResetLocalDataResult {
	accountsDeleted: number;
	categoriesDeleted: number;
	transactionsDeleted: number;
	categoriesReseeded: number;
}

/**
 * Wipes this user's accounts, categories, and transactions from the local
 * IndexedDB cache and reseeds the default category list — equivalent to what
 * a browser user gets from manually clearing site data, but reachable from
 * inside the app (needed on PWA/mobile installs where there's no easy way to
 * clear IndexedDB manually).
 *
 * Does NOT touch Firebase — if Cloud Sync is enabled, per-table sync
 * watermarks are reset to 0 so the very next sync re-pulls everything from
 * Firestore fresh (mirroring `clearFirestoreForUser`'s reset behavior). If
 * sync is disabled, this is a genuine irreversible local wipe.
 *
 * Does NOT touch Zakat data (`goldItems`, `zakatCalculations`,
 * `zakatPayments`), `dbConfig` (settings/PIN/prefs), or `syncMeta`'s
 * unrelated keys — only the three tables named in the request.
 */
export async function resetLocalFinancialData(userId: string): Promise<ResetLocalDataResult> {
	const [accountsDeleted, categoriesDeleted, transactionsDeleted] = await db.transaction(
		"rw",
		[db.accounts, db.categories, db.transactions, db.dashboardStats, db.syncMeta],
		async () => {
			const deletedCounts = await Promise.all([
				db.accounts.where("userId").equals(userId).delete(),
				db.categories.where("userId").equals(userId).delete(),
				db.transactions.where("userId").equals(userId).delete(),
			]);

			await db.dashboardStats.delete(userId);

			// Reset per-table + legacy watermarks so a future sync re-pulls
			// everything from Firestore instead of assuming it's already synced.
			await db.syncMeta.bulkPut([
				{ id: "lastSync", timestamp: 0 },
				...CORE_SYNC_TABLES.map((table) => ({ id: `lastSync:${table}`, timestamp: 0 })),
			]);

			return deletedCounts;
		}
	);

	await seedDefaultCategories(userId);
	const categoriesReseeded = await db.categories.where("userId").equals(userId).count();

	scheduleAnalyticsRecompute(userId);

	return { accountsDeleted, categoriesDeleted, transactionsDeleted, categoriesReseeded };
}
