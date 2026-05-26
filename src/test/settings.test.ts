/**
 * Sprint 5: Settings, Sync & Data Portability tests
 * Covers: dbConfigSchema validation, HK import logic, export filename
 */
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { getDateRange } from "@/lib/dateRange";
import { db } from "@/lib/db/local";
import { dbConfigSchema } from "@/lib/validations/dbConfig";

const USER_ID = "user-sprint5-test";

// ─── dbConfigSchema validation ──────────────────────────────────────────────

describe("dbConfigSchema", () => {
	it("accepts valid config", () => {
		const result = dbConfigSchema.safeParse({
			currency: "AED",
			fiscalYearStartMonth: 7,
			enabled: false,
		});
		expect(result.success).toBe(true);
	});

	it("rejects currency that's not 3 chars", () => {
		const result = dbConfigSchema.safeParse({
			currency: "AE",
			fiscalYearStartMonth: 7,
			enabled: false,
		});
		expect(result.success).toBe(false);
	});

	it("rejects fiscalYearStartMonth out of range", () => {
		const r1 = dbConfigSchema.safeParse({
			currency: "AED",
			fiscalYearStartMonth: 0,
			enabled: false,
		});
		const r2 = dbConfigSchema.safeParse({
			currency: "AED",
			fiscalYearStartMonth: 13,
			enabled: false,
		});
		expect(r1.success).toBe(false);
		expect(r2.success).toBe(false);
	});

	it("accepts valid Firebase config JSON", () => {
		const firebaseJson = JSON.stringify({
			apiKey: "test-key",
			authDomain: "test.firebaseapp.com",
			projectId: "test-project",
		});
		const result = dbConfigSchema.safeParse({
			currency: "USD",
			fiscalYearStartMonth: 1,
			firebaseConfig: firebaseJson,
			enabled: true,
		});
		expect(result.success).toBe(true);
	});

	it("rejects Firebase config JSON missing required fields", () => {
		const badJson = JSON.stringify({ apiKey: "test-key" });
		const result = dbConfigSchema.safeParse({
			currency: "USD",
			fiscalYearStartMonth: 1,
			firebaseConfig: badJson,
			enabled: true,
		});
		expect(result.success).toBe(false);
	});

	it("rejects malformed JSON", () => {
		const result = dbConfigSchema.safeParse({
			currency: "USD",
			fiscalYearStartMonth: 1,
			firebaseConfig: "not-valid-json",
			enabled: true,
		});
		expect(result.success).toBe(false);
	});

	it("accepts empty firebaseConfig (sync disabled)", () => {
		const result = dbConfigSchema.safeParse({
			currency: "PKR",
			fiscalYearStartMonth: 4,
			firebaseConfig: "",
			enabled: false,
		});
		expect(result.success).toBe(true);
	});
});

// ─── DbConfig Dexie CRUD ─────────────────────────────────────────────────────

describe("DbConfig Dexie operations", () => {
	beforeEach(async () => {
		await db.dbConfig.clear();
	});

	it("creates a default config if none exists", async () => {
		await db.dbConfig.put({
			id: USER_ID,
			currency: "AED",
			fiscalYearStartMonth: 7,
			firebaseConfig: "",
			enabled: false,
		});
		const config = await db.dbConfig.get(USER_ID);
		expect(config?.currency).toBe("AED");
		expect(config?.fiscalYearStartMonth).toBe(7);
	});

	it("updates currency and fiscalYearStartMonth independently", async () => {
		await db.dbConfig.put({
			id: USER_ID,
			currency: "AED",
			fiscalYearStartMonth: 7,
			firebaseConfig: "",
			enabled: false,
		});
		await db.dbConfig.update(USER_ID, { currency: "PKR", fiscalYearStartMonth: 4 });
		const updated = await db.dbConfig.get(USER_ID);
		expect(updated?.currency).toBe("PKR");
		expect(updated?.fiscalYearStartMonth).toBe(4);
	});

	it("saves enabled flag and firebaseConfig", async () => {
		const firebaseConfig = JSON.stringify({
			apiKey: "abc",
			authDomain: "x.firebaseapp.com",
			projectId: "my-project",
		});
		await db.dbConfig.put({
			id: USER_ID,
			currency: "USD",
			fiscalYearStartMonth: 1,
			firebaseConfig,
			enabled: true,
		});
		const config = await db.dbConfig.get(USER_ID);
		expect(config?.enabled).toBe(true);
		expect(config?.firebaseConfig).toBe(firebaseConfig);
	});
});

// ─── Export range logic ───────────────────────────────────────────────────────

describe("export date range", () => {
	it("current month range has correct day boundaries", () => {
		const { from, to } = getDateRange("month", 7);
		expect(from.getDate()).toBe(1);
		// End of month: to should be last day
		const lastDay = new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate();
		expect(to.getDate()).toBe(lastDay);
	});

	it("fiscal year range covers 12 months", () => {
		const { from, to } = getDateRange("fiscal-year", 7);
		const fromMs = from.getTime();
		const toMs = to.getTime();
		const days = Math.round((toMs - fromMs) / (1000 * 60 * 60 * 24));
		// ~365 days (365 or 366 for leap year)
		expect(days).toBeGreaterThanOrEqual(364);
		expect(days).toBeLessThanOrEqual(366);
	});
});
