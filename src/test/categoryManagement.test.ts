import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	filterCategoriesForManagement,
	getCategoryTreeCategories,
} from "@/components/categories/categoryManagement";
import {
	findDuplicateCategoryGroups,
	mergeDuplicateCategories,
} from "@/components/categories/duplicateCategoryMerge";
import { recomputeAnalyticsNow } from "@/lib/analytics/scheduleRecompute";
import { db, withoutSyncDirtyTracking } from "@/lib/db/local";

import type { Category, Transaction } from "@/types";

vi.mock("@/lib/analytics/scheduleRecompute", () => ({
	recomputeAnalyticsNow: vi.fn(),
}));

const USER_ID = "category-management-test-user";

function category(id: string, patch: Partial<Category> = {}): Category {
	return {
		id,
		userId: USER_ID,
		title: id,
		type: "Expense",
		updatedAt: 1_000,
		...patch,
	};
}

function transaction(
	id: string,
	categoryId: string,
	patch: Partial<Transaction> = {}
): Transaction {
	return {
		id,
		userId: USER_ID,
		type: "Expense",
		date: 1_000,
		amount: 10,
		accountId: "account-1",
		categoryId,
		updatedAt: 1_000,
		...patch,
	};
}

function pendingSync(record: Category | Transaction | undefined) {
	return (record as ((Category | Transaction) & { pendingSync?: boolean }) | undefined)
		?.pendingSync;
}

async function clearUserData() {
	await db.transactions.where("userId").equals(USER_ID).delete();
	await db.categories.where("userId").equals(USER_ID).delete();
}

async function seedData(input: { categories?: Category[]; transactions?: Transaction[] }) {
	await withoutSyncDirtyTracking(async () => {
		if (input.categories?.length) await db.categories.bulkPut(input.categories);
		if (input.transactions?.length) await db.transactions.bulkPut(input.transactions);
	});
}

beforeEach(async () => {
	await clearUserData();
	vi.mocked(recomputeAnalyticsNow).mockClear();
});

describe("category management filters", () => {
	it("shows only categories tagged with the active currency in This currency scope", () => {
		const categories = [
			category("aed-food", { currency: "AED" }),
			category("pkr-food", { currency: "PKR" }),
			category("shared-food"),
			category("deleted-aed", { currency: "AED", deletedAt: 2_000 }),
		];

		const filtered = filterCategoriesForManagement(categories, "currency", "AED");

		expect(filtered?.map((item) => item.id)).toEqual(["aed-food"]);
	});

	it("keeps Expense and Income categories under their exact headings", () => {
		const categories = [
			category("expense-parent", { type: "Expense" }),
			category("expense-child", { type: "Expense", parentId: "expense-parent" }),
			category("income-parent", { type: "Income" }),
			category("income-child", { type: "Income", parentId: "income-parent" }),
			category("deleted-income", { type: "Income", deletedAt: 2_000 }),
		];

		expect(getCategoryTreeCategories(categories, "Expense").map((item) => item.id)).toEqual([
			"expense-parent",
			"expense-child",
		]);
		expect(getCategoryTreeCategories(categories, "Income").map((item) => item.id)).toEqual([
			"income-parent",
			"income-child",
		]);
	});
});

describe("duplicate category merge", () => {
	it("detects duplicates only within the same currency and type", () => {
		const categories = [
			category("aed-food-1", { title: "Food", currency: "AED", type: "Expense" }),
			category("aed-food-2", { title: " food  ", currency: "AED", type: "Expense" }),
			category("aed-income-food", { title: "Food", currency: "AED", type: "Income" }),
			category("pkr-food", { title: "FOOD", currency: "PKR", type: "Expense" }),
			category("shared-food-1", { title: "Food", type: "Expense" }),
			category("shared-food-2", { title: " food ", type: "Expense" }),
		];

		const groups = findDuplicateCategoryGroups(categories, [
			transaction("txn-1", "aed-food-1"),
			transaction("txn-2", "aed-food-2"),
			transaction("txn-3", "pkr-food"),
		]);

		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({
			type: "Expense",
			currency: "AED",
			totalTransactionCount: 2,
		});
		expect(groups[0]?.candidates.map((candidate) => candidate.category.id).sort()).toEqual([
			"aed-food-1",
			"aed-food-2",
		]);
	});

	it("moves all transactions, reparents children, soft-deletes losers, and preserves analytics counts", async () => {
		await seedData({
			categories: [
				category("survivor", { title: "Food", currency: "AED" }),
				category("duplicate", { title: " food ", currency: "AED" }),
				category("child", { title: "Restaurants", currency: "AED", parentId: "duplicate" }),
			],
			transactions: [
				transaction("survivor-txn", "survivor"),
				transaction("duplicate-txn-1", "duplicate"),
				transaction("duplicate-txn-2", "duplicate"),
				transaction("deleted-duplicate-txn", "duplicate", { deletedAt: 2_000 }),
			],
		});

		const beforeActiveCount = (
			await db.transactions
				.where("userId")
				.equals(USER_ID)
				.filter(
					(item) =>
						!item.deletedAt && (item.categoryId === "survivor" || item.categoryId === "duplicate")
				)
				.toArray()
		).length;

		const result = await mergeDuplicateCategories(USER_ID, "survivor", ["duplicate"]);
		const survivorTxn = await db.transactions.get("survivor-txn");
		const duplicateTxn1 = await db.transactions.get("duplicate-txn-1");
		const duplicateTxn2 = await db.transactions.get("duplicate-txn-2");
		const deletedDuplicateTxn = await db.transactions.get("deleted-duplicate-txn");
		const child = await db.categories.get("child");
		const duplicate = await db.categories.get("duplicate");
		const afterActiveSurvivorCount = (
			await db.transactions
				.where("userId")
				.equals(USER_ID)
				.filter((item) => !item.deletedAt && item.categoryId === "survivor")
				.toArray()
		).length;

		expect(result).toMatchObject({
			survivorId: "survivor",
			loserIds: ["duplicate"],
			movedTransactions: 3,
			reparentedChildren: 1,
			softDeletedCategories: 1,
			activeTransactionsBefore: beforeActiveCount,
			activeSurvivorTransactionsAfter: beforeActiveCount,
		});
		expect(afterActiveSurvivorCount).toBe(beforeActiveCount);
		expect(duplicateTxn1).toMatchObject({ categoryId: "survivor", pendingSync: true });
		expect(duplicateTxn2).toMatchObject({ categoryId: "survivor", pendingSync: true });
		expect(deletedDuplicateTxn).toMatchObject({ categoryId: "survivor", pendingSync: true });
		expect(survivorTxn?.categoryId).toBe("survivor");
		expect(pendingSync(survivorTxn)).toBeUndefined();
		expect(child).toMatchObject({ parentId: "survivor", pendingSync: true });
		expect(duplicate?.deletedAt).toBeDefined();
		expect(pendingSync(duplicate)).toBe(true);
		expect(recomputeAnalyticsNow).toHaveBeenCalledWith(USER_ID);
	});
});
