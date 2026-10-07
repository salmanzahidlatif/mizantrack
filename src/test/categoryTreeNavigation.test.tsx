import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CategoriesPageClient } from "@/components/categories/CategoriesPageClient";
import { CategoryTree } from "@/components/categories/CategoryTree";
import { db } from "@/lib/db/local";
import { useFilterStore } from "@/store/filter-store";
import { useUIStore } from "@/store/ui-store";

import type { Category } from "@/types";

const userId = "category-tree-navigation-user";

const mocks = vi.hoisted(() => ({
	categories: [] as Category[],
	childCounts: new Map<string, number>(),
	push: vi.fn(),
	transactionCounts: new Map<string, number>(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/components/categories/CategoryDrawer", () => ({
	CategoryDrawer: () => null,
}));

vi.mock("@/components/categories/DuplicateCategoryMergePanel", () => ({
	DuplicateCategoryMergePanel: () => null,
}));

vi.mock("@/hooks/useCategories", () => ({
	useCategories: () => mocks.categories,
}));

vi.mock("@/hooks/useCategoryUsageCounts", () => ({
	useCategoryUsageCounts: () => ({
		childCounts: mocks.childCounts,
		transactionCounts: mocks.transactionCounts,
	}),
}));

vi.mock("@/hooks/useDbConfig", () => ({
	useDbConfig: () => ({
		currency: "PKR",
		enabledCurrencies: ["PKR", "AED"],
	}),
}));

vi.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({
		light: vi.fn(),
		selection: vi.fn(),
		warning: vi.fn(),
	}),
}));

vi.mock("@/hooks/useRequiredUserId", () => ({
	useRequiredUserId: (providedUserId?: string) => providedUserId ?? userId,
}));

vi.mock("@/lib/analytics/scheduleRecompute", () => ({
	recomputeAnalyticsNow: vi.fn(),
	scheduleAnalyticsRecompute: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
	},
}));

function category(id: string, patch: Partial<Category> = {}): Category {
	return {
		id,
		userId,
		title: id,
		type: "Expense",
		currency: "PKR",
		updatedAt: 1_000,
		...patch,
	};
}

async function openCategoryMenu(name = /category options/i) {
	const trigger = screen.getByRole("button", { name });

	fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

	return screen.findByRole("menu");
}

function rowLabels(): string[] {
	return screen
		.getAllByRole("button", { name: /view transactions for/i })
		.map((button) => button.getAttribute("aria-label") ?? "");
}

beforeEach(async () => {
	await db.categories.clear();
	await db.transactions.clear();
	mocks.categories = [];
	mocks.childCounts = new Map();
	mocks.transactionCounts = new Map();
	mocks.push.mockClear();
	useFilterStore.setState({
		period: "month",
		accountId: null,
		categoryId: null,
		transactionType: "All",
		searchQuery: "",
		customRange: null,
		activeCurrency: "PKR",
		showArchivedAccounts: false,
	});
	useUIStore.setState({
		isAccountDrawerOpen: false,
		editAccountId: null,
		isTransactionDrawerOpen: false,
		editTransactionId: null,
		isCategoryDrawerOpen: false,
		editCategoryId: null,
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("CategoryTree navigation", () => {
	it("sets the category filter and navigates to transactions when a category row is tapped", () => {
		const food = category("food", { title: "Food" });
		mocks.categories = [food];
		mocks.transactionCounts = new Map([[food.id, 7]]);

		render(<CategoriesPageClient userId={userId} />);

		fireEvent.click(screen.getByRole("button", { name: "View transactions for Food" }));

		expect(useFilterStore.getState()).toMatchObject({
			categoryId: food.id,
			transactionType: "Expense",
		});
		expect(mocks.push).toHaveBeenCalledWith("/transactions");
	});

	it("keeps edit and delete menu actions from invoking row navigation", async () => {
		const food = category("food", { title: "Food" });
		const onSelectCategory = vi.fn();

		await db.categories.put(food);

		render(
			<CategoryTree
				categories={[food]}
				onSelectCategory={onSelectCategory}
				type="Expense"
				transactionCounts={new Map([[food.id, 1]])}
			/>
		);

		await openCategoryMenu(/category options for food/i);
		fireEvent.click(await screen.findByRole("menuitem", { name: /^Edit$/ }));

		expect(onSelectCategory).not.toHaveBeenCalled();
		expect(useUIStore.getState().isCategoryDrawerOpen).toBe(true);
		expect(useUIStore.getState().editCategoryId).toBe(food.id);

		await waitFor(() => expect(screen.queryByRole("menuitem", { name: /^Edit$/ })).toBeNull());

		await openCategoryMenu(/category options for food/i);
		fireEvent.click(await screen.findByRole("menuitem", { name: /^Delete$/ }));

		expect(onSelectCategory).not.toHaveBeenCalled();
		await waitFor(async () => {
			const deletedCategory = await db.categories.get(food.id);

			expect(deletedCategory?.deletedAt).toEqual(expect.any(Number));
		});
	});
});

describe("CategoryTree usage sorting", () => {
	it("orders each category level by transaction count with a stable title tie-break", () => {
		const parentLow = category("parent-low", { title: "Alpha" });
		const parentHigh = category("parent-high", { title: "Beta" });
		const parentTie = category("parent-tie", { title: "Gamma" });
		const childTieB = category("child-tie-b", {
			title: "Bananas",
			parentId: parentLow.id,
		});
		const childHigh = category("child-high", {
			title: "Card",
			parentId: parentLow.id,
		});
		const childTieA = category("child-tie-a", {
			title: "Apples",
			parentId: parentLow.id,
		});

		render(
			<CategoryTree
				categories={[parentLow, parentHigh, parentTie, childTieB, childHigh, childTieA]}
				childCounts={new Map([[parentLow.id, 3]])}
				type="Expense"
				transactionCounts={
					new Map([
						[parentLow.id, 3],
						[parentHigh.id, 5],
						[parentTie.id, 3],
						[childTieB.id, 4],
						[childHigh.id, 8],
						[childTieA.id, 4],
					])
				}
			/>
		);

		expect(rowLabels()).toEqual([
			"View transactions for Beta",
			"View transactions for Alpha (direct transactions only)",
			"View transactions for Card",
			"View transactions for Apples",
			"View transactions for Bananas",
			"View transactions for Gamma",
		]);
	});

	it("preserves parent and child hierarchy instead of flattening by global usage", () => {
		const quietParent = category("quiet-parent", { title: "Quiet Parent" });
		const busyParent = category("busy-parent", { title: "Busy Parent" });
		const veryBusyChild = category("very-busy-child", {
			title: "Very Busy Child",
			parentId: quietParent.id,
		});
		const busyChild = category("busy-child", {
			title: "Busy Child",
			parentId: busyParent.id,
		});

		render(
			<CategoryTree
				categories={[quietParent, veryBusyChild, busyParent, busyChild]}
				childCounts={
					new Map([
						[quietParent.id, 1],
						[busyParent.id, 1],
					])
				}
				type="Expense"
				transactionCounts={
					new Map([
						[quietParent.id, 1],
						[veryBusyChild.id, 99],
						[busyParent.id, 10],
						[busyChild.id, 2],
					])
				}
			/>
		);

		expect(rowLabels()).toEqual([
			"View transactions for Busy Parent (direct transactions only)",
			"View transactions for Busy Child",
			"View transactions for Quiet Parent (direct transactions only)",
			"View transactions for Very Busy Child",
		]);
	});
});
