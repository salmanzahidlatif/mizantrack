/**
 * Sprint 3: Transaction management tests
 * Covers: transactionSchema validation, db CRUD, filter logic
 */
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/local";
import { transactionSchema } from "@/lib/validations/transaction";

const ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440030";
const ACCOUNT_ID_2 = "550e8400-e29b-41d4-a716-446655440031";
const CATEGORY_ID = "550e8400-e29b-41d4-a716-446655440032";
const USER_ID = "user-txn-test";

// ─── transactionSchema ─────────────────────────────────────────────────────

describe("transactionSchema", () => {
	it("accepts a valid expense", () => {
		const result = transactionSchema.safeParse({
			type: "Expense",
			amount: 50,
			date: new Date(),
			accountId: ACCOUNT_ID,
			categoryId: CATEGORY_ID,
		});
		expect(result.success).toBe(true);
	});

	it("accepts a valid income", () => {
		const result = transactionSchema.safeParse({
			type: "Income",
			amount: 3000,
			date: new Date(),
			accountId: ACCOUNT_ID,
		});
		expect(result.success).toBe(true);
	});

	it("accepts a valid transfer with toAccountId", () => {
		const result = transactionSchema.safeParse({
			type: "Transfer",
			amount: 200,
			date: new Date(),
			accountId: ACCOUNT_ID,
			toAccountId: ACCOUNT_ID_2,
		});
		expect(result.success).toBe(true);
	});

	it("rejects a transfer missing toAccountId", () => {
		const result = transactionSchema.safeParse({
			type: "Transfer",
			amount: 200,
			date: new Date(),
			accountId: ACCOUNT_ID,
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const paths = result.error.issues.map((i) => i.path.join("."));
			expect(paths).toContain("toAccountId");
		}
	});

	it("rejects a transfer where source and destination are the same", () => {
		const result = transactionSchema.safeParse({
			type: "Transfer",
			amount: 200,
			date: new Date(),
			accountId: ACCOUNT_ID,
			toAccountId: ACCOUNT_ID,
		});
		expect(result.success).toBe(false);
	});

	it("rejects zero amount", () => {
		const result = transactionSchema.safeParse({
			type: "Expense",
			amount: 0,
			date: new Date(),
			accountId: ACCOUNT_ID,
		});
		expect(result.success).toBe(false);
	});

	it("rejects negative amount", () => {
		const result = transactionSchema.safeParse({
			type: "Expense",
			amount: -10,
			date: new Date(),
			accountId: ACCOUNT_ID,
		});
		expect(result.success).toBe(false);
	});

	it("coerces string amount to number", () => {
		const result = transactionSchema.safeParse({
			type: "Expense",
			amount: "125.50",
			date: new Date(),
			accountId: ACCOUNT_ID,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.amount).toBe(125.5);
		}
	});

	it("accepts optional description and place", () => {
		const result = transactionSchema.safeParse({
			type: "Expense",
			amount: 25,
			date: new Date(),
			accountId: ACCOUNT_ID,
			description: "Coffee",
			place: "Starbucks",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.description).toBe("Coffee");
			expect(result.data.place).toBe("Starbucks");
		}
	});

	it("rejects invalid accountId (not UUID)", () => {
		const result = transactionSchema.safeParse({
			type: "Expense",
			amount: 10,
			date: new Date(),
			accountId: "not-a-uuid",
		});
		expect(result.success).toBe(false);
	});
});

// ─── Dexie transactions CRUD ───────────────────────────────────────────────

describe("transactions db operations", () => {
	const TXN_ID = "550e8400-e29b-41d4-a716-446655440033";
	const TXN_ID_2 = "550e8400-e29b-41d4-a716-446655440034";

	beforeEach(async () => {
		await db.transactions.clear();
	});

	it("can add and retrieve a transaction", async () => {
		await db.transactions.put({
			id: TXN_ID,
			userId: USER_ID,
			type: "Expense",
			amount: 50,
			date: Date.now(),
			accountId: ACCOUNT_ID,
			updatedAt: Date.now(),
		});
		const txn = await db.transactions.get(TXN_ID);
		expect(txn).toBeDefined();
		expect(txn?.type).toBe("Expense");
		expect(txn?.amount).toBe(50);
	});

	it("can soft-delete a transaction", async () => {
		await db.transactions.put({
			id: TXN_ID,
			userId: USER_ID,
			type: "Income",
			amount: 3000,
			date: Date.now(),
			accountId: ACCOUNT_ID,
			updatedAt: Date.now(),
		});
		await db.transactions.update(TXN_ID, {
			deletedAt: Date.now(),
			updatedAt: Date.now(),
		});
		const txn = await db.transactions.get(TXN_ID);
		expect(txn?.deletedAt).toBeDefined();
	});

	it("can store a transfer transaction", async () => {
		await db.transactions.put({
			id: TXN_ID,
			userId: USER_ID,
			type: "Transfer",
			amount: 500,
			date: Date.now(),
			accountId: ACCOUNT_ID,
			toAccountId: ACCOUNT_ID_2,
			updatedAt: Date.now(),
		});
		const txn = await db.transactions.get(TXN_ID);
		expect(txn?.toAccountId).toBe(ACCOUNT_ID_2);
	});

	it("can filter non-deleted transactions by userId", async () => {
		const now = Date.now();
		await db.transactions.bulkPut([
			{
				id: TXN_ID,
				userId: USER_ID,
				type: "Expense",
				amount: 100,
				date: now,
				accountId: ACCOUNT_ID,
				updatedAt: now,
			},
			{
				id: TXN_ID_2,
				userId: USER_ID,
				type: "Income",
				amount: 200,
				date: now,
				accountId: ACCOUNT_ID,
				updatedAt: now,
				deletedAt: now, // soft-deleted
			},
		]);
		const active = await db.transactions
			.where("userId")
			.equals(USER_ID)
			.filter((t) => !t.deletedAt)
			.toArray();
		expect(active).toHaveLength(1);
		expect(active[0]?.type).toBe("Expense");
	});

	it("can update a transaction", async () => {
		const now = Date.now();
		await db.transactions.put({
			id: TXN_ID,
			userId: USER_ID,
			type: "Expense",
			amount: 50,
			date: now,
			accountId: ACCOUNT_ID,
			updatedAt: now,
		});
		await db.transactions.update(TXN_ID, { amount: 75, updatedAt: Date.now() });
		const txn = await db.transactions.get(TXN_ID);
		expect(txn?.amount).toBe(75);
	});
});
