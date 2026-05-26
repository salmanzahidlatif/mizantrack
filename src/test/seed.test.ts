import { describe, it, expect, beforeEach } from "vitest";

import { db } from "@/lib/db/local";
import { seedDefaultCategories } from "@/lib/db/seed";

const TEST_USER_ID = "test-user-seed-001";

beforeEach(async () => {
	// Clear categories for isolation
	await db.categories.where("userId").equals(TEST_USER_ID).delete();
});

describe("seedDefaultCategories", () => {
	it("inserts 15 default categories on first call", async () => {
		await seedDefaultCategories(TEST_USER_ID);
		const count = await db.categories.where("userId").equals(TEST_USER_ID).count();
		expect(count).toBe(15);
	});

	it("inserts 10 Expense and 5 Income categories", async () => {
		await seedDefaultCategories(TEST_USER_ID);
		const all = await db.categories.where("userId").equals(TEST_USER_ID).toArray();
		const expenses = all.filter((c) => c.type === "Expense");
		const incomes = all.filter((c) => c.type === "Income");
		expect(expenses).toHaveLength(10);
		expect(incomes).toHaveLength(5);
	});

	it("is idempotent — calling twice does not duplicate categories", async () => {
		await seedDefaultCategories(TEST_USER_ID);
		await seedDefaultCategories(TEST_USER_ID);
		const count = await db.categories.where("userId").equals(TEST_USER_ID).count();
		expect(count).toBe(15);
	});

	it("assigns correct userId to all inserted categories", async () => {
		await seedDefaultCategories(TEST_USER_ID);
		const all = await db.categories.where("userId").equals(TEST_USER_ID).toArray();
		expect(all.every((c) => c.userId === TEST_USER_ID)).toBe(true);
	});

	it("does not affect categories of a different user", async () => {
		const otherUserId = "other-user-999";
		await db.categories.put({
			id: "existing-cat",
			userId: otherUserId,
			title: "Existing",
			type: "Expense",
			updatedAt: Date.now(),
		});
		await seedDefaultCategories(TEST_USER_ID);
		const otherCount = await db.categories.where("userId").equals(otherUserId).count();
		expect(otherCount).toBe(1);
		await db.categories.delete("existing-cat");
	});
});
