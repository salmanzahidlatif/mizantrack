import { describe, it, expect } from "vitest";

import { accountSchema } from "@/lib/validations/account";
import { categorySchema } from "@/lib/validations/category";
import { dbConfigSchema } from "@/lib/validations/dbConfig";
import { transactionSchema } from "@/lib/validations/transaction";

// ─── accountSchema ─────────────────────────────────────────────────────────

describe("accountSchema", () => {
	it("accepts a valid account", () => {
		const result = accountSchema.safeParse({
			title: "My AED Account",
			currency: "AED",
			openingBalance: 1000,
		});
		expect(result.success).toBe(true);
	});

	it("rejects empty title", () => {
		const result = accountSchema.safeParse({ title: "", currency: "AED", openingBalance: 0 });
		expect(result.success).toBe(false);
		expect(result.error?.issues?.[0]?.path).toContain("title");
	});

	it("rejects title longer than 100 chars", () => {
		const result = accountSchema.safeParse({
			title: "a".repeat(101),
			currency: "AED",
			openingBalance: 0,
		});
		expect(result.success).toBe(false);
	});

	it("rejects currency not exactly 3 chars", () => {
		const result = accountSchema.safeParse({
			title: "Test",
			currency: "AE",
			openingBalance: 0,
		});
		expect(result.success).toBe(false);
	});

	it("rejects negative opening balance", () => {
		const result = accountSchema.safeParse({
			title: "Test",
			currency: "AED",
			openingBalance: -100,
		});
		expect(result.success).toBe(false);
	});

	it("accepts zero opening balance", () => {
		const result = accountSchema.safeParse({
			title: "Test",
			currency: "PKR",
			openingBalance: 0,
		});
		expect(result.success).toBe(true);
	});

	it("uppercases currency code", () => {
		const result = accountSchema.safeParse({
			title: "Test",
			currency: "aed",
			openingBalance: 0,
		});
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.currency).toBe("AED");
	});
});

// ─── categorySchema ────────────────────────────────────────────────────────

describe("categorySchema", () => {
	it("accepts valid expense category", () => {
		const result = categorySchema.safeParse({ title: "Food", type: "Expense" });
		expect(result.success).toBe(true);
	});

	it("accepts valid income category with parentId", () => {
		const result = categorySchema.safeParse({
			title: "Freelance",
			type: "Income",
			parentId: "550e8400-e29b-41d4-a716-446655440001",
		});
		expect(result.success).toBe(true);
	});

	it("rejects empty title", () => {
		const result = categorySchema.safeParse({ title: "", type: "Expense" });
		expect(result.success).toBe(false);
	});

	it("rejects invalid type", () => {
		const result = categorySchema.safeParse({ title: "Food", type: "Transfer" });
		expect(result.success).toBe(false);
	});

	it("rejects invalid parentId UUID", () => {
		const result = categorySchema.safeParse({
			title: "Food",
			type: "Expense",
			parentId: "not-a-uuid",
		});
		expect(result.success).toBe(false);
	});
});

// ─── transactionSchema ─────────────────────────────────────────────────────

const validAccountId = "550e8400-e29b-41d4-a716-446655440001";
const otherAccountId = "550e8400-e29b-41d4-a716-446655440002";

describe("transactionSchema", () => {
	it("accepts valid expense", () => {
		const result = transactionSchema.safeParse({
			type: "Expense",
			amount: 50,
			date: new Date(),
			accountId: validAccountId,
			categoryId: "550e8400-e29b-41d4-a716-446655440003",
		});
		expect(result.success).toBe(true);
	});

	it("accepts valid income", () => {
		const result = transactionSchema.safeParse({
			type: "Income",
			amount: 5000,
			date: new Date(),
			accountId: validAccountId,
		});
		expect(result.success).toBe(true);
	});

	it("accepts valid transfer with different accounts", () => {
		const result = transactionSchema.safeParse({
			type: "Transfer",
			amount: 200,
			date: new Date(),
			accountId: validAccountId,
			toAccountId: otherAccountId,
		});
		expect(result.success).toBe(true);
	});

	it("rejects zero amount", () => {
		const result = transactionSchema.safeParse({
			type: "Expense",
			amount: 0,
			date: new Date(),
			accountId: validAccountId,
		});
		expect(result.success).toBe(false);
	});

	it("rejects negative amount", () => {
		const result = transactionSchema.safeParse({
			type: "Expense",
			amount: -100,
			date: new Date(),
			accountId: validAccountId,
		});
		expect(result.success).toBe(false);
	});

	it("rejects transfer without toAccountId", () => {
		const result = transactionSchema.safeParse({
			type: "Transfer",
			amount: 100,
			date: new Date(),
			accountId: validAccountId,
		});
		expect(result.success).toBe(false);
	});

	it("rejects transfer where source equals destination", () => {
		const result = transactionSchema.safeParse({
			type: "Transfer",
			amount: 100,
			date: new Date(),
			accountId: validAccountId,
			toAccountId: validAccountId,
		});
		expect(result.success).toBe(false);
	});

	it("rejects invalid date", () => {
		const result = transactionSchema.safeParse({
			type: "Expense",
			amount: 50,
			date: "not-a-date",
			accountId: validAccountId,
		});
		expect(result.success).toBe(false);
	});
});

// ─── dbConfigSchema ────────────────────────────────────────────────────────

describe("dbConfigSchema", () => {
	it("accepts valid config without firebase", () => {
		const result = dbConfigSchema.safeParse({
			currency: "AED",
			fiscalYearStartMonth: 7,
			enabled: false,
		});
		expect(result.success).toBe(true);
	});

	it("accepts valid config with valid firebase JSON", () => {
		const result = dbConfigSchema.safeParse({
			currency: "PKR",
			fiscalYearStartMonth: 1,
			firebaseConfig: JSON.stringify({
				apiKey: "test-key",
				authDomain: "test.firebaseapp.com",
				projectId: "test-project",
			}),
			enabled: true,
		});
		expect(result.success).toBe(true);
	});

	it("rejects invalid firebase JSON string", () => {
		const result = dbConfigSchema.safeParse({
			currency: "AED",
			fiscalYearStartMonth: 7,
			firebaseConfig: "not-json",
			enabled: true,
		});
		expect(result.success).toBe(false);
	});

	it("rejects firebase JSON missing required fields", () => {
		const result = dbConfigSchema.safeParse({
			currency: "AED",
			fiscalYearStartMonth: 7,
			firebaseConfig: JSON.stringify({ apiKey: "key" }), // missing authDomain, projectId
			enabled: true,
		});
		expect(result.success).toBe(false);
	});

	it("rejects fiscal month out of range", () => {
		const result = dbConfigSchema.safeParse({
			currency: "AED",
			fiscalYearStartMonth: 13,
			enabled: false,
		});
		expect(result.success).toBe(false);
	});

	it("rejects currency not 3 chars", () => {
		const result = dbConfigSchema.safeParse({
			currency: "USDX",
			fiscalYearStartMonth: 1,
			enabled: false,
		});
		expect(result.success).toBe(false);
	});
});
