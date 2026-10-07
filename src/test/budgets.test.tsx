import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BudgetList } from "@/components/budgets/BudgetList";
import { buildBudgetProgressRows } from "@/hooks/useBudgets";

import type { PeriodAnalytics } from "@/lib/analytics/periodAnalytics";
import type { Budget, Category } from "@/types";

vi.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({
		error: vi.fn(),
		light: vi.fn(),
		selection: vi.fn(),
		success: vi.fn(),
		warning: vi.fn(),
	}),
}));

const period = {
	from: new Date("2026-10-01T00:00:00.000Z"),
	fromMs: Date.parse("2026-10-01T00:00:00.000Z"),
	interval: "monthly" as const,
	key: "2026-10",
	label: "Oct 2026",
	to: new Date("2026-10-31T23:59:59.999Z"),
	toMs: Date.parse("2026-10-31T23:59:59.999Z"),
};

function analytics(currency: string, categoryId: string, amount: number): PeriodAnalytics {
	return {
		userId: "user-1",
		currency,
		period,
		income: 0,
		expense: amount,
		net: -amount,
		incomeBreakdown: [],
		expenseBreakdown: [
			{
				categoryId,
				title: "Groceries",
				amount,
				share: 1,
			},
		],
		transactionCount: 1,
	};
}

const categories: Category[] = [
	{
		id: "cat-aed",
		userId: "user-1",
		title: "Groceries",
		type: "Expense",
		currency: "AED",
		icon: "🛒",
		updatedAt: 1,
	},
	{
		id: "cat-pkr",
		userId: "user-1",
		title: "Fuel",
		type: "Expense",
		currency: "PKR",
		updatedAt: 1,
	},
];

const budgets: Budget[] = [
	{
		id: "budget-aed",
		userId: "user-1",
		categoryId: "cat-aed",
		period: "2026-10",
		amount: 500,
		currency: "AED",
		active: true,
		updatedAt: 1,
	},
	{
		id: "budget-pkr",
		userId: "user-1",
		categoryId: "cat-pkr",
		period: "2026-10",
		amount: 5000,
		currency: "PKR",
		active: true,
		updatedAt: 1,
	},
];

describe("budget progress", () => {
	it("uses PeriodAnalytics expense breakdowns and does not mix currencies", () => {
		const rows = buildBudgetProgressRows(
			budgets,
			categories,
			analytics("AED", "cat-aed", 125),
			" aed "
		);

		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			categoryId: "cat-aed",
			budgeted: 500,
			spent: 125,
			remaining: 375,
			status: "under",
			currency: "AED",
		});

		const staleAnalyticsRows = buildBudgetProgressRows(
			budgets,
			categories,
			analytics("PKR", "cat-pkr", 4500),
			"AED"
		);
		expect(staleAnalyticsRows).toHaveLength(1);
		expect(staleAnalyticsRows[0]?.spent).toBe(0);
	});

	it("renders over-budget state with explicit non-colour warning text", () => {
		const row = buildBudgetProgressRows(
			budgets,
			categories,
			analytics("AED", "cat-aed", 650),
			"AED"
		)[0]!;

		render(
			<BudgetList
				userId="user-1"
				rows={[row]}
				currency="AED"
				monthLabel="Oct 2026"
				onEdit={vi.fn()}
			/>
		);

		const renderedRow = screen.getByTestId("budget-row");
		expect(renderedRow).toHaveAttribute("data-status", "over");
		expect(within(renderedRow).getByText("OVER BUDGET")).toBeInTheDocument();
		expect(within(renderedRow).getByText("Overspent by")).toBeInTheDocument();
		expect(within(renderedRow).getByText("Spending exceeded the budget limit")).toBeInTheDocument();
	});

	it("shows an intentional empty state when the selected month has no budgets", () => {
		render(
			<BudgetList userId="user-1" rows={[]} currency="AED" monthLabel="Oct 2026" onEdit={vi.fn()} />
		);

		expect(screen.getByTestId("budget-empty-state")).toBeInTheDocument();
		expect(screen.getByText("No budgets for Oct 2026")).toBeInTheDocument();
		expect(screen.getByText(/Create per-category budgets for AED/i)).toBeInTheDocument();
	});
});
