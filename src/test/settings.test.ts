/**
 * Sprint 5: Settings, Sync & Data Portability tests
 * Covers: dbConfigSchema validation, HK import logic, export filename
 */
import "fake-indexeddb/auto";

import * as XLSX from "xlsx";
import { beforeEach, describe, expect, it } from "vitest";

import { getDateRange } from "@/lib/dateRange";
import { db } from "@/lib/db/local";
import { importHysabKytab } from "@/lib/import/hysabKytab";
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

	it("update_WhenNoRecord_ReturnsZeroAndDoesNotCreate", async () => {
		// Regression: Dexie update silently fails when the record doesn't exist.
		// scheduleSave must upsert, not just update.
		const count = await db.dbConfig.update("nonexistent-user", { currency: "PKR" });
		expect(count).toBe(0);
		const config = await db.dbConfig.get("nonexistent-user");
		expect(config).toBeUndefined();
	});

	it("upsertDbConfig_WhenNoRecord_CreatesWithCorrectCurrency", async () => {
		// Regression: saving PKR must succeed even when no config record exists yet.
		const userId = "upsert-test-user";
		const count = await db.dbConfig.update(userId, { currency: "PKR", fiscalYearStartMonth: 4 });
		if (count === 0) {
			await db.dbConfig.put({
				id: userId,
				currency: "PKR",
				fiscalYearStartMonth: 4,
				firebaseConfig: "",
				enabled: false,
			});
		}
		const saved = await db.dbConfig.get(userId);
		expect(saved?.currency).toBe("PKR");
		expect(saved?.fiscalYearStartMonth).toBe(4);
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

	it("getDateRange_All_FromIsEpochZeroSoFilterSkipped", () => {
		// Regression: "all" period must return from=epoch-0 so useTransactions skips
		// the from-filter (0 is falsy) and shows every historical transaction.
		const { from, to } = getDateRange("all");
		expect(from.getTime()).toBe(0);
		// to must be far in the future — beyond any realistic transaction date
		expect(to.getTime()).toBeGreaterThan(new Date("2100-01-01").getTime());
	});
});

// ─── HK Import: currency regression ─────────────────────────────────────────

function makeMinimalHKFile(accountTitle = "Cash", openingBalance = 5000): File {
	const wb = XLSX.utils.book_new();

	XLSX.utils.book_append_sheet(
		wb,
		XLSX.utils.json_to_sheet([{ Title: accountTitle, "Opening Balance": openingBalance }]),
		"ACCOUNT"
	);
	XLSX.utils.book_append_sheet(
		wb,
		XLSX.utils.json_to_sheet([{ Title: "Grocery", "Category Type": "Expense" }]),
		"CATEGORY"
	);
	XLSX.utils.book_append_sheet(
		wb,
		XLSX.utils.json_to_sheet([
			{
				"Voucher Type": "Expense",
				"Voucher Date": "01/01/2020",
				"Voucher Amount": -100,
				"Category Name": "Grocery",
				"Account Name": accountTitle,
			},
		]),
		"ACTIVITIES"
	);

	// XLSX type:"array" returns a plain number[] — convert to a proper ArrayBuffer via Uint8Array
	const arr = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as number[];
	return new File([new Uint8Array(arr).buffer], "test.xlsx", {
		type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	});
}

describe("importHysabKytab — currency", () => {
	const USER_PKR = "hk-import-pkr-user";
	const USER_NO_CONFIG = "hk-import-noconfig-user";

	beforeEach(async () => {
		await db.accounts.where("userId").anyOf([USER_PKR, USER_NO_CONFIG]).delete();
		await db.dbConfig.delete(USER_PKR);
		await db.dbConfig.delete(USER_NO_CONFIG);
	});

	it("importHysabKytab_UserCurrencyPKR_AccountsImportedAsPKR", async () => {
		// Regression: before fix, currency was hardcoded to "AED" regardless of user config
		await db.dbConfig.put({
			id: USER_PKR,
			currency: "PKR",
			fiscalYearStartMonth: 4,
			firebaseConfig: "",
			enabled: false,
		});

		const file = makeMinimalHKFile();
		await importHysabKytab(file, USER_PKR);

		const accounts = await db.accounts.where("userId").equals(USER_PKR).toArray();
		expect(accounts.length).toBeGreaterThan(0);
		accounts.forEach((a) => expect(a.currency).toBe("PKR"));
	});

	it("importHysabKytab_NoConfig_AccountsFallBackToAED", async () => {
		// When no dbConfig exists, currency should fall back to "AED"
		const file = makeMinimalHKFile();
		await importHysabKytab(file, USER_NO_CONFIG);

		const accounts = await db.accounts.where("userId").equals(USER_NO_CONFIG).toArray();
		expect(accounts.length).toBeGreaterThan(0);
		accounts.forEach((a) => expect(a.currency).toBe("AED"));
	});

	it("importHysabKytab_TransactionWithNoCategory_CategoryIdOmitted", async () => {
		// Regression: categoryId: undefined causes Firestore WriteBatch.set() to throw.
		// After fix, transactions with no matching category must omit categoryId entirely.
		await db.dbConfig.put({
			id: USER_PKR,
			currency: "PKR",
			fiscalYearStartMonth: 4,
			firebaseConfig: "",
			enabled: false,
		});

		const wb = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(
			wb,
			XLSX.utils.json_to_sheet([{ Title: "Cash", "Opening Balance": 0 }]),
			"ACCOUNT"
		);
		XLSX.utils.book_append_sheet(
			wb,
			XLSX.utils.json_to_sheet([{ Title: "Grocery", "Category Type": "Expense" }]),
			"CATEGORY"
		);
		// Activity references a category that does NOT exist in the CATEGORY sheet
		XLSX.utils.book_append_sheet(
			wb,
			XLSX.utils.json_to_sheet([
				{
					"Voucher Type": "Expense",
					"Voucher Date": "01/01/2020",
					"Voucher Amount": -50,
					"Category Name": "Unknown Category",
					"Account Name": "Cash",
				},
			]),
			"ACTIVITIES"
		);
		const arr = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as number[];
		const file = new File([new Uint8Array(arr).buffer], "test.xlsx");

		await importHysabKytab(file, USER_PKR);

		const txns = await db.transactions.where("userId").equals(USER_PKR).toArray();
		expect(txns.length).toBeGreaterThan(0);
		txns.forEach((t) => {
			// categoryId must be absent (undefined), NOT explicitly set to undefined
			expect(Object.prototype.hasOwnProperty.call(t, "categoryId") && t.categoryId === undefined).toBe(false);
		});
	});
});
