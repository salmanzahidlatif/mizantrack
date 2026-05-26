import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/local";

import type { DbConfig } from "@/types";

export function useDbConfig(userId: string): DbConfig | undefined {
	return useLiveQuery(() => db.dbConfig.get(userId), [userId]);
}
