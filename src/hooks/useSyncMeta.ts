import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/local";
import { CORE_SYNC_TABLES } from "@/lib/db/sync";

import type { SyncMeta } from "@/types";

export function useSyncMeta(): SyncMeta | undefined {
	return useLiveQuery(async () => {
		const legacy = await db.syncMeta.get("lastSync");
		const perTable = await Promise.all(
			CORE_SYNC_TABLES.map(async (table) => db.syncMeta.get(`lastSync:${table}`))
		);
		const timestamps = [legacy?.timestamp, ...perTable.map((meta) => meta?.timestamp)].filter(
			(timestamp): timestamp is number => timestamp !== undefined
		);
		if (timestamps.length === 0) return undefined;

		return { id: "lastSync", timestamp: Math.max(...timestamps) };
	}, []);
}
