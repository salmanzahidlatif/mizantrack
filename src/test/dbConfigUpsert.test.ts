import { beforeEach, describe, expect, it } from "vitest";

import { defaultDbConfig, upsertDbConfig } from "@/lib/db/dbConfig";
import { db } from "@/lib/db/local";

const USER_ID = "user-upsert-config";

/**
 * Settings were written with Dexie's `update()`, which resolves successfully
 * while writing nothing when the row does not exist. On a fresh install, or
 * after clearing local data, saving the Firebase config or an app-lock PIN
 * silently did nothing.
 */
describe("dbConfig upsert", () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	it("creates the config row when none exists", async () => {
		expect(await db.dbConfig.get(USER_ID)).toBeUndefined();

		await upsertDbConfig(USER_ID, { firebaseConfig: '{"projectId":"demo"}', enabled: true });

		const saved = await db.dbConfig.get(USER_ID);
		expect(saved).toBeDefined();
		expect(saved?.firebaseConfig).toBe('{"projectId":"demo"}');
		expect(saved?.enabled).toBe(true);
		// Untouched fields fall back to sensible defaults rather than undefined.
		expect(saved?.currency).toBe(defaultDbConfig(USER_ID).currency);
		expect(saved?.fiscalYearStartMonth).toBe(defaultDbConfig(USER_ID).fiscalYearStartMonth);
	});

	it("preserves existing values when patching", async () => {
		await db.dbConfig.put({
			...defaultDbConfig(USER_ID),
			currency: "AED",
			fiscalYearStartMonth: 1,
		});

		await upsertDbConfig(USER_ID, { appLockEnabled: true });

		const saved = await db.dbConfig.get(USER_ID);
		expect(saved?.currency).toBe("AED");
		expect(saved?.fiscalYearStartMonth).toBe(1);
		expect(saved?.appLockEnabled).toBe(true);
	});

	it("never changes the row id", async () => {
		await upsertDbConfig(USER_ID, { enabled: true });
		const rows = await db.dbConfig.toArray();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.id).toBe(USER_ID);
	});

	it("demonstrates why update() was unsafe on an empty database", async () => {
		// Guards the original bug: Dexie reports success but writes nothing.
		const updated = await db.dbConfig.update(USER_ID, { enabled: true });
		expect(updated).toBe(0);
		expect(await db.dbConfig.get(USER_ID)).toBeUndefined();
	});
});
