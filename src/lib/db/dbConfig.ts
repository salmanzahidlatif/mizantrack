import { db } from "@/lib/db/local";

import type { DbConfig } from "@/types";

/**
 * Dexie's `update()` silently does nothing when the row is absent, so settings
 * saved before a config row exists — on a fresh install, or after clearing
 * local data — were reported as saved while never being written.
 */
export function defaultDbConfig(userId: string): DbConfig {
	return {
		id: userId,
		firebaseConfig: "",
		enabled: false,
		currency: "PKR",
		fiscalYearStartMonth: 7,
	};
}

/** Applies a partial update, creating the config row first if it is missing. */
export async function upsertDbConfig(
	userId: string,
	patch: Partial<Omit<DbConfig, "id">>
): Promise<DbConfig> {
	const existing = await db.dbConfig.get(userId);
	const next: DbConfig = { ...(existing ?? defaultDbConfig(userId)), ...patch, id: userId };
	await db.dbConfig.put(next);
	return next;
}
