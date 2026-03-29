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

export async function syncAll(userId: string): Promise<{ synced: boolean; reason?: string }> {
	const firestore = await getFirestoreForUser(userId);
	if (!firestore) return { synced: false, reason: "no-config" };

	const meta = await localDb.syncMeta.get("lastSync");
	const lastSync = meta?.timestamp ?? 0;

	for (const table of ["accounts", "categories", "transactions"] as SyncableTable[]) {
		await syncCollection(userId, table, lastSync, firestore);
	}

	await localDb.syncMeta.put({ id: "lastSync", timestamp: Date.now() });
	return { synced: true };
}

async function syncCollection(
	userId: string,
	tableName: SyncableTable,
	lastSync: number,
	firestore: Firestore
) {
	const table = localDb[tableName];

	// Push local changes
	const localChanged = await table
		.where("userId")
		.equals(userId)
		.and((r: SyncableRecord) => r.updatedAt > lastSync)
		.toArray();

	if (localChanged.length > 0) {
		// Firestore batch limit is 500
		for (let i = 0; i < localChanged.length; i += 499) {
			const chunk = localChanged.slice(i, i + 499);
			const batch = writeBatch(firestore);
			chunk.forEach((record: SyncableRecord) => {
				const ref = doc(firestore, `users/${userId}/${tableName}`, record.id);
				batch.set(ref, record, { merge: true });
			});
			await batch.commit();
		}
	}

	// Pull remote changes
	const remoteSnap = await getDocs(
		query(collection(firestore, `users/${userId}/${tableName}`), where("updatedAt", ">", lastSync))
	);

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
		}
	}
}

export async function getFirestoreUsage(userId: string) {
	const firestore = await getFirestoreForUser(userId);
	if (!firestore) return null;

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
}
