import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/local";

import type { DbConfig } from "@/types";

export function useDbConfig(userId: string): DbConfig | undefined {
	return useLiveQuery(() => {
		if (typeof userId !== "string") return undefined;

		const normalizedUserId = userId.trim();
		if (!normalizedUserId) return undefined;

		return db.dbConfig.get(normalizedUserId);
	}, [userId]);
}
