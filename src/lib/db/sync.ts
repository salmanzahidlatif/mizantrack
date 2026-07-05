import {
	collection,
	getDocs,
	writeBatch,
	doc,
	query,
	where,
	getDoc,
	setDoc,
	getCountFromServer,
	type Firestore,
} from "firebase/firestore";

import { getFirestoreForUser } from "./firebase";
import { db as localDb } from "./local";

import type { Account, Category, Transaction } from "@/types";

type SyncableTable = "accounts" | "categories" | "transactions";
type SyncableRecord = Account | Category | Transaction;

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

	const meta = await localDb.syncMeta.get("lastSync");
	const lastSync = meta?.timestamp ?? 0;

	const tables = {} as Record<SyncableTable, SyncTableResult>;
	let totalPushed = 0;
	let totalPulled = 0;

	for (const table of ["accounts", "categories", "transactions"] as SyncableTable[]) {
		const result = await syncCollection(userId, table, lastSync, firestore);
		tables[table] = result;
		totalPushed += result.pushed;
		totalPulled += result.pulled;
		onProgress?.({ table, ...result, totalPushed, totalPulled });
	}

	await localDb.syncMeta.put({ id: "lastSync", timestamp: Date.now() });

	// Sync settings/prefs document alongside financial data
	await syncSettingsPrefs(userId, firestore);

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

export async function getFirestoreUsage(userId: string) {	const firestore = await getFirestoreForUser(userId);
	if (!firestore) return null;

	try {
		const counts = await Promise.all(
			["transactions", "accounts", "categories"].map(async (col) => {
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
 * Deletes: accounts, categories, transactions, settings/prefs.
 * After deletion resets local syncMeta.lastSync to 0 so next sync re-uploads everything.
 */
export async function clearFirestoreForUser(
	userId: string,
	onProgress?: (deleted: number) => void
): Promise<ClearResult> {
	const firestore = await getFirestoreForUser(userId);
	if (!firestore) throw new Error("Firebase not configured.");

	const COLLECTIONS = ["accounts", "categories", "transactions"];
	let totalDeleted = 0;
	const collectionCounts: Record<string, number> = {};

	for (const col of COLLECTIONS) {
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
		const prefsRef = doc(firestore, `users/${userId}/settings`, "prefs");
		const prefsSnap = await getDoc(prefsRef);
		if (prefsSnap.exists()) {
			const batch = writeBatch(firestore);
			batch.delete(prefsRef);
			await batch.commit();
			totalDeleted++;
			collectionCounts["settings"] = 1;
		}
	} catch {
		// Non-critical — continue
	}

	// Reset local sync timestamp so next sync re-uploads everything
	await localDb.syncMeta.put({ id: "lastSync", timestamp: 0 });

	return { deleted: totalDeleted, collections: collectionCounts };
}
