import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/local";

import type { SyncMeta } from "@/types";

export function useSyncMeta(): SyncMeta | undefined {
	return useLiveQuery(() => db.syncMeta.get("lastSync"), []);
}
