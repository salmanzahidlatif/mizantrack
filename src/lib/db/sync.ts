import {
	collection,
	getDocs,
	writeBatch,
	doc,
	query,
	where,
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

export async function getFirestoreUsage(userId: string) {
	const firestore = await getFirestoreForUser(userId);
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
