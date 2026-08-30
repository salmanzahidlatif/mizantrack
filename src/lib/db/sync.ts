import {
	collection,
	doc,
	getDocs,
	getDoc,
	getCountFromServer,
	query,
	setDoc,
	type Firestore,
	writeBatch,
	where,
} from "firebase/firestore";

import { sanitizeDashboardStats } from "@/lib/analytics/computeDashboardStats";
import { scheduleAnalyticsRecompute } from "@/lib/analytics/scheduleRecompute";

import { getFirestoreForUser } from "./firebase";
import { db as localDb } from "./local";

import type { Account, Category, DashboardStats, Transaction } from "@/types";

type SyncableTable = "accounts" | "categories" | "transactions";
type SyncableRecord = Account | Category | Transaction;

export const FIRESTORE_FREE_TIER_DAILY_WRITE_LIMIT = 20_000;
export const FIRESTORE_FREE_TIER_DAILY_READ_LIMIT = 50_000;
export const CORE_SYNC_TABLES = ["accounts", "categories", "transactions"] as const;

function formatFirestoreLimit(limit: number): string {
	return new Intl.NumberFormat("en-US").format(limit);
}

export const FIRESTORE_DAILY_QUOTA_EXCEEDED_MESSAGE =
	`Sync failed: Firestore daily quota exceeded. Free tier allows ${formatFirestoreLimit(FIRESTORE_FREE_TIER_DAILY_WRITE_LIMIT)} writes and ${formatFirestoreLimit(FIRESTORE_FREE_TIER_DAILY_READ_LIMIT)} reads per day. Sync will resume tomorrow.`;

function getPerTableSyncKey(table: SyncableTable): string {
	return `lastSync:${table}`;
}

async function getTableLastSync(table: SyncableTable): Promise<number> {
	const perTableMeta = await localDb.syncMeta.get(getPerTableSyncKey(table));
	if (perTableMeta) return perTableMeta.timestamp;

	const legacyMeta = await localDb.syncMeta.get("lastSync");
	return legacyMeta?.timestamp ?? 0;
}

export interface SyncTableResult {
	pushed: number;
	pulled: number;
}

export interface SyncResult {
	synced: boolean;
	reason?: string;
	tables?: Record<SyncableTable, SyncTableResult>;
	totalPushed: number;
	totalPulled: number;
}

export type SyncProgressCallback = (progress: {
	table: SyncableTable;
	pushed: number;
	pulled: number;
	totalPushed: number;
	totalPulled: number;
}) => void;

export async function syncAll(
	userId: string,
	onProgress?: SyncProgressCallback
): Promise<SyncResult> {
	const firestore = await getFirestoreForUser(userId);
	if (!firestore) return { synced: false, reason: "no-config", totalPushed: 0, totalPulled: 0 };

	const tables = {} as Record<SyncableTable, SyncTableResult>;
	let totalPushed = 0;
	let totalPulled = 0;
	let pulledCoreChanges = false;

	for (const table of CORE_SYNC_TABLES) {
		const syncStartedAt = Date.now();
		const lastSync = await getTableLastSync(table);
		const result = await syncCollection(userId, table, lastSync, firestore);
		await localDb.syncMeta.put({ id: getPerTableSyncKey(table), timestamp: syncStartedAt });
		tables[table] = result;
		totalPushed += result.pushed;
		totalPulled += result.pulled;
		if (result.pulled > 0) pulledCoreChanges = true;
		onProgress?.({ table, ...result, totalPushed, totalPulled });
	}

	// Fixed doc-level sync cost after the 3 collection loops:
	// - settings/prefs: 1 read + up to 1 write
	// - analytics/dashboard: 1 read + up to 1 write
	// No per-field reads/writes are introduced here.
	await syncSettingsPrefs(userId, firestore);
	await syncDashboardStats(userId, firestore);

	if (pulledCoreChanges) {
		scheduleAnalyticsRecompute(userId);
	}

	return { synced: true, tables, totalPushed, totalPulled };
}

async function syncCollection(
	userId: string,
	tableName: SyncableTable,
	lastSync: number,
	firestore: Firestore
): Promise<SyncTableResult> {
	const table = localDb[tableName];

	// Push local changes
	const localChanged = await table
		.where("userId")
		.equals(userId)
		.and((r: SyncableRecord) => r.updatedAt > lastSync)
		.toArray();

	let pushed = 0;
	if (localChanged.length > 0) {
		// Firestore batch limit is 500
		for (let i = 0; i < localChanged.length; i += 499) {
			const chunk = localChanged.slice(i, i + 499);
			const batch = writeBatch(firestore);
			chunk.forEach((record: SyncableRecord) => {
				const ref = doc(firestore, `users/${userId}/${tableName}`, record.id);
				// Firestore rejects documents with `undefined` values — strip them before writing
				const clean = Object.fromEntries(
					Object.entries(record).filter(([, v]) => v !== undefined)
				);
				batch.set(ref, clean, { merge: true });
			});
			await batch.commit();
			pushed += chunk.length;
		}
	}

	// Pull remote changes
	const remoteSnap = await getDocs(
		query(collection(firestore, `users/${userId}/${tableName}`), where("updatedAt", ">", lastSync))
	);

	let pulled = 0;
	for (const docSnap of remoteSnap.docs) {
		const remote = docSnap.data() as SyncableRecord;
		const local = await table.get(remote.id);
		if (!local || remote.updatedAt > local.updatedAt) {
			switch (tableName) {
				case "accounts":
					await localDb.accounts.put(remote as Account);
					break;
				case "categories":
					await localDb.categories.put(remote as Category);
					break;
				case "transactions":
					await localDb.transactions.put(remote as Transaction);
					break;
			}
			pulled++;
		}
	}

	return { pushed, pulled };
}

/** Fields synced to Firestore settings/prefs document. biometricCredentialId is intentionally excluded. */
const SYNCED_PREFS_FIELDS = [
	"pinHash",
	"appLockEnabled",
	"biometricEnabled",
	"currency",
	"enabledCurrencies",
	"fiscalYearStartMonth",
] as const;

/**
 * Push/pull the settings/prefs Firestore document.
 * Path: /users/{userId}/settings/prefs
 * Conflict resolution: last-write-wins on prefs.updatedAt
 */
async function syncSettingsPrefs(userId: string, firestore: Firestore): Promise<void> {
	const localConfig = await localDb.dbConfig.get(userId);
	if (!localConfig) return;

	const prefsRef = doc(firestore, `users/${userId}/settings`, "prefs");

	// On a fresh device prefsUpdatedAt is undefined — default to 0 so Firebase always wins.
	const localUpdatedAt = (localConfig as unknown as Record<string, unknown>).prefsUpdatedAt as number | undefined ?? 0;

	const remoteSnap = await getDoc(prefsRef);

	if (remoteSnap.exists()) {
		const remote = remoteSnap.data() as Record<string, unknown>;
		const remoteUpdatedAt = (remote.updatedAt as number | undefined) ?? 0;

		if (remoteUpdatedAt > localUpdatedAt) {
			// Pull remote → local
			const patch: Partial<typeof localConfig> = {};
			for (const field of SYNCED_PREFS_FIELDS) {
				if (remote[field] !== undefined) {
					(patch as Record<string, unknown>)[field] = remote[field];
				}
			}
			if (Object.keys(patch).length > 0) {
				await localDb.dbConfig.update(userId, patch);
			}
			return;
		}
	}

	// Push local → remote
	const prefs: Record<string, unknown> = { updatedAt: localUpdatedAt };
	for (const field of SYNCED_PREFS_FIELDS) {
		const val = (localConfig as unknown as Record<string, unknown>)[field];
		if (val !== undefined) prefs[field] = val;
	}
	await setDoc(prefsRef, prefs, { merge: true });
}

async function syncDashboardStats(userId: string, firestore: Firestore): Promise<void> {
	const analyticsRef = doc(firestore, `users/${userId}/analytics`, "dashboard");
	const local = await localDb.dashboardStats.get(userId);
	const remoteSnap = await getDoc(analyticsRef);

	if (remoteSnap.exists()) {
		const remote = remoteSnap.data() as DashboardStats;
		const localUpdatedAt = local?.updatedAt ?? 0;
		const remoteUpdatedAt = remote.updatedAt ?? 0;

		if (remoteUpdatedAt > localUpdatedAt) {
			await localDb.dashboardStats.put(sanitizeDashboardStats({ ...remote, id: userId }));
			return;
		}
	}

	if (local) {
		await setDoc(analyticsRef, sanitizeDashboardStats(local));
	}
}

export async function getFirestoreUsage(userId: string) {
	const firestore = await getFirestoreForUser(userId);
	if (!firestore) return null;

	try {
		const counts = await Promise.all(
			CORE_SYNC_TABLES.map(async (col) => {
				const snap = await getCountFromServer(collection(firestore, `users/${userId}/${col}`));
				return { col, count: snap.data().count };
			})
		);

		// Rough estimate: avg doc ~600 bytes
		const totalDocs = counts.reduce((sum, c) => sum + c.count, 0);
		const estimatedMB = ((totalDocs * 600) / 1024 / 1024).toFixed(2);
		const freeLimitMB = 1024;

		return {
			counts,
			totalDocs,
			estimatedMB,
			freeLimitMB,
			percentUsed: ((+estimatedMB / freeLimitMB) * 100).toFixed(1),
		};
	} catch {
		return null;
	}
}

export interface ClearResult {
	deleted: number;
	collections: Record<string, number>;
}

/**
 * Batch-delete all documents under /users/{userId}/ in the user's Firestore.
 * Deletes: accounts, categories, transactions, settings/prefs, analytics/dashboard.
 * After deletion resets local syncMeta watermarks to 0 so next sync re-uploads everything.
 */
export async function clearFirestoreForUser(
	userId: string,
	onProgress?: (deleted: number) => void
): Promise<ClearResult> {
	const firestore = await getFirestoreForUser(userId);
	if (!firestore) throw new Error("Firebase not configured.");

	let totalDeleted = 0;
	const collectionCounts: Record<string, number> = {};

	for (const col of CORE_SYNC_TABLES) {
		const snap = await getDocs(collection(firestore, `users/${userId}/${col}`));
		let count = 0;
		for (let i = 0; i < snap.docs.length; i += 499) {
			const chunk = snap.docs.slice(i, i + 499);
			const batch = writeBatch(firestore);
			chunk.forEach((d) => batch.delete(d.ref));
			await batch.commit();
			count += chunk.length;
			totalDeleted += chunk.length;
			onProgress?.(totalDeleted);
		}
		collectionCounts[col] = count;
	}

	// Delete settings/prefs document
	try {
		const docsToDelete = [
			{ key: "settings", ref: doc(firestore, `users/${userId}/settings`, "prefs") },
			{ key: "analytics", ref: doc(firestore, `users/${userId}/analytics`, "dashboard") },
		];

		for (const { key, ref } of docsToDelete) {
			const snap = await getDoc(ref);
			if (!snap.exists()) continue;

			const batch = writeBatch(firestore);
			batch.delete(ref);
			await batch.commit();
			totalDeleted++;
			collectionCounts[key] = 1;
		}
	} catch {
		// Non-critical — continue
	}

	// Reset both legacy and per-table watermarks so next sync re-uploads everything.
	await localDb.syncMeta.bulkPut([
		{ id: "lastSync", timestamp: 0 },
		...CORE_SYNC_TABLES.map((table) => ({ id: getPerTableSyncKey(table), timestamp: 0 })),
	]);

	return { deleted: totalDeleted, collections: collectionCounts };
}
