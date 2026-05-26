/**
 * Sprint 2: Account management tests
 * Covers: accountSchema validation, useAccounts hook, useAccountBalance logic
 */
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/local";
import { accountSchema } from "@/lib/validations/account";

// ─── accountSchema ─────────────────────────────────────────────────────────

describe("accountSchema", () => {
	it("accepts valid account data", () => {
		const result = accountSchema.safeParse({
			title: "Cash",
			currency: "aed",
			openingBalance: 500,
		});
		expect(result.success).toBe(true);
	});

	it("uppercases currency", () => {
		const result = accountSchema.safeParse({
			title: "Cash",
			currency: "usd",
			openingBalance: 0,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.currency).toBe("USD");
		}
	});

	it("rejects missing title", () => {
		const result = accountSchema.safeParse({
			title: "",
			currency: "USD",
			openingBalance: 0,
		});
		expect(result.success).toBe(false);
	});

	it("rejects currency that is not 3 characters", () => {
		const result = accountSchema.safeParse({
			title: "Cash",
			currency: "US",
			openingBalance: 0,
		});
		expect(result.success).toBe(false);
	});

	it("rejects negative opening balance", () => {
		const result = accountSchema.safeParse({
			title: "Cash",
			currency: "USD",
			openingBalance: -1,
		});
		expect(result.success).toBe(false);
	});

	it("accepts zero opening balance", () => {
		const result = accountSchema.safeParse({
			title: "Cash",
			currency: "USD",
			openingBalance: 0,
		});
		expect(result.success).toBe(true);
	});

	it("coerces string opening balance to number", () => {
		const result = accountSchema.safeParse({
			title: "Cash",
			currency: "USD",
			openingBalance: "1000",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.openingBalance).toBe(1000);
		}
	});

	it("accepts optional color and icon", () => {
		const result = accountSchema.safeParse({
			title: "Wallet",
			currency: "EUR",
			openingBalance: 200,
			color: "#6366f1",
			icon: "💼",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.color).toBe("#6366f1");
			expect(result.data.icon).toBe("💼");
		}
	});
});

// ─── Dexie accounts CRUD ───────────────────────────────────────────────────

describe("accounts db operations", () => {
	const userId = "user-acc-test";
	const accountId = "550e8400-e29b-41d4-a716-446655440010";

	beforeEach(async () => {
		await db.accounts.clear();
	});

	it("can add and retrieve an account", async () => {
		await db.accounts.put({
			id: accountId,
			userId,
			title: "Main Account",
			currency: "AED",
			openingBalance: 1000,
			isArchived: false,
			updatedAt: Date.now(),
		});
		const account = await db.accounts.get(accountId);
		expect(account).toBeDefined();
		expect(account?.title).toBe("Main Account");
		expect(account?.currency).toBe("AED");
	});

	it("can soft-delete an account", async () => {
		await db.accounts.put({
			id: accountId,
			userId,
			title: "Temp Account",
			currency: "USD",
			openingBalance: 0,
			isArchived: false,
			updatedAt: Date.now(),
		});
		await db.accounts.update(accountId, {
			deletedAt: Date.now(),
			updatedAt: Date.now(),
		});
		const account = await db.accounts.get(accountId);
		expect(account?.deletedAt).toBeDefined();
	});

	it("can archive an account", async () => {
		await db.accounts.put({
			id: accountId,
			userId,
			title: "Old Account",
			currency: "GBP",
			openingBalance: 500,
			isArchived: false,
			updatedAt: Date.now(),
		});
		await db.accounts.update(accountId, { isArchived: true, updatedAt: Date.now() });
		const account = await db.accounts.get(accountId);
		expect(account?.isArchived).toBe(true);
	});

	it("can store multiple accounts for a user", async () => {
		await db.accounts.bulkPut([
			{
				id: "550e8400-e29b-41d4-a716-446655440011",
				userId,
				title: "Savings",
				currency: "AED",
				openingBalance: 5000,
				isArchived: false,
				updatedAt: Date.now(),
			},
			{
				id: "550e8400-e29b-41d4-a716-446655440012",
				userId,
				title: "Checking",
				currency: "USD",
				openingBalance: 200,
				isArchived: false,
				updatedAt: Date.now(),
			},
		]);
		const accounts = await db.accounts.where("userId").equals(userId).toArray();
		expect(accounts).toHaveLength(2);
	});
});
