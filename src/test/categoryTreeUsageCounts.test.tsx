import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CategoryTree } from "@/components/categories/CategoryTree";
import {
	buildCategoryChildCounts,
	buildCategoryTransactionCounts,
} from "@/components/categories/duplicateCategoryMerge";

import type { Category, Transaction } from "@/types";

const USER_ID = "category-tree-usage-test-user";

vi.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({
		error: vi.fn(),
		heavy: vi.fn(),
		light: vi.fn(),
		medium: vi.fn(),
		selection: vi.fn(),
		success: vi.fn(),
		warning: vi.fn(),
	}),
}));

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

describe("category tree usage counts", () => {
	it("shows transaction counts and parent child counts with accessible labels", () => {
		const categories = [
			category("parent", { title: "Food" }),
			category("child-1", { title: "Groceries", parentId: "parent" }),
			category("child-2", { title: "Restaurants", parentId: "parent" }),
			category("childless", { title: "Fuel" }),
		];
		const transactions = [
			transaction("txn-1", "parent"),
			transaction("txn-2", "parent"),
			transaction("txn-3", "child-1"),
			transaction("txn-deleted", "parent", { deletedAt: 2_000 }),
		];

		render(
			<CategoryTree
				categories={categories}
				childCounts={buildCategoryChildCounts(categories)}
				type="Expense"
				transactionCounts={buildCategoryTransactionCounts(transactions)}
			/>
		);

		expect(screen.getByText("Food")).toBeInTheDocument();
		expect(screen.getByLabelText("2 transactions")).toHaveTextContent("2 txns");
		expect(screen.getByLabelText("2 subcategories")).toHaveTextContent("2 subcats");
		expect(screen.getByLabelText("1 transaction")).toHaveTextContent("1 txn");
		expect(screen.getAllByLabelText("0 transactions")).toHaveLength(2);
		expect(screen.queryByLabelText("0 subcategories")).not.toBeInTheDocument();
	});

	it("excludes soft-deleted transactions and child categories from usage counts", () => {
		const categories = [
			category("parent"),
			category("active-child", { parentId: "parent" }),
			category("deleted-child", { parentId: "parent", deletedAt: 2_000 }),
		];
		const transactions = [
			transaction("active", "parent"),
			transaction("deleted", "parent", { deletedAt: 2_000 }),
		];

		expect(buildCategoryTransactionCounts(transactions).get("parent")).toBe(1);
		expect(buildCategoryChildCounts(categories).get("parent")).toBe(1);
	});

	it("reads active transaction category ids once while building the count map", () => {
		const readCategoryId = vi.fn();
		const transactions = [
			transaction("txn-1", "parent"),
			transaction("txn-2", "child"),
			transaction("txn-deleted", "parent", { deletedAt: 2_000 }),
		];

		for (const item of transactions) {
			const categoryId = item.categoryId;
			Object.defineProperty(item, "categoryId", {
				get() {
					readCategoryId();
					return categoryId;
				},
			});
		}

		const counts = buildCategoryTransactionCounts(transactions);

		expect(counts.get("parent")).toBe(1);
		expect(counts.get("child")).toBe(1);
		expect(readCategoryId).toHaveBeenCalledTimes(2);
	});
});
