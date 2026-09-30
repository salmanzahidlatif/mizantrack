import "fake-indexeddb/auto";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CategoryBreakdownChart } from "@/components/charts/CategoryDonutChart";
import { DashboardPageClient } from "@/components/dashboard/DashboardPageClient";
import { ReportsPageClient } from "@/components/reports/ReportsPageClient";

import type { AccountsAnalytics, PeriodAnalytics } from "@/lib/analytics/periodAnalytics";
import type { ReactNode } from "react";

const USER_ID = "dashboard-ui-rebuild-user";
const NOW = new Date("2026-09-29T12:00:00.000Z");

vi.mock("next/link", () => ({
	default: ({ href, children, ...props }: { href: string; children?: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

vi.mock("recharts", () => {
	function ChartContainer({
		data,
		children,
		testId,
	}: {
		data?: unknown;
		children?: ReactNode;
		testId: string;
	}) {
		return (
			<div data-testid={testId} data-chart={JSON.stringify(data ?? null)}>
				{children}
			</div>
		);
	}

	return {
		ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
			<div data-testid="responsive-container">{children}</div>
		),
		BarChart: ({ data, children }: { data?: unknown; children?: ReactNode }) => (
			<ChartContainer data={data} testId="bar-chart">
				{children}
			</ChartContainer>
		),
		CartesianGrid: () => <div data-testid="cartesian-grid" />,
		XAxis: () => <div data-testid="x-axis" />,
		YAxis: () => <div data-testid="y-axis" />,
		Tooltip: () => <div data-testid="tooltip" />,
		Legend: () => <div data-testid="legend" />,
		Bar: ({ children }: { children?: ReactNode }) => <div data-testid="bar">{children}</div>,
		PieChart: ({ children }: { children?: ReactNode }) => (
			<div data-testid="pie-chart-root">{children}</div>
		),
		Pie: ({ data, children }: { data?: unknown; children?: ReactNode }) => (
			<ChartContainer data={data} testId="pie-chart">
				{children}
			</ChartContainer>
		),
		Cell: () => <div data-testid="cell" />,
	};
});

vi.mock("@/hooks/useAccountsAnalytics", () => ({
	useAccountsAnalytics: vi.fn(),
}));

vi.mock("@/hooks/useAnalyticsMonthSummaries", () => ({
	useAnalyticsMonthSummaries: () => undefined,
}));

vi.mock("@/hooks/useCategories", () => ({
	useCategories: () => [],
}));

vi.mock("@/hooks/useDbConfig", () => ({
	useDbConfig: () => ({ currency: "AED", fiscalYearStartMonth: 1 }),
}));

vi.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({
		light: vi.fn(),
		medium: vi.fn(),
		heavy: vi.fn(),
		success: vi.fn(),
		warning: vi.fn(),
		error: vi.fn(),
		selection: vi.fn(),
	}),
}));

vi.mock("@/hooks/usePeriodAnalytics", () => ({
	usePeriodAnalytics: vi.fn(),
}));

vi.mock("@/store/filter-store", () => ({
	useFilterStore: () => ({ activeCurrency: "" }),
}));

vi.mock("@/store/ui-store", () => ({
	useUIStore: (selector: (state: { openAddAccount: () => void }) => unknown) =>
		selector({ openAddAccount: vi.fn() }),
}));

function buildAnalytics(interval: "monthly" | "quarterly", empty = false): PeriodAnalytics {
	const expense = empty ? 0 : interval === "monthly" ? 600 : 1500;
	const income = empty ? 0 : interval === "monthly" ? 1000 : 3000;

	return {
		userId: USER_ID,
		currency: "AED",
		period: {
			interval,
			key: interval === "monthly" ? "2026-09" : "2026-Q3",
			label: interval === "monthly" ? "Sep 2026" : "Q3 2026",
			from: new Date("2026-09-01T00:00:00.000Z"),
			to: new Date("2026-09-30T23:59:59.999Z"),
			fromMs: new Date("2026-09-01T00:00:00.000Z").getTime(),
			toMs: new Date("2026-09-30T23:59:59.999Z").getTime(),
		},
		income,
		expense,
		net: income - expense,
		incomeBreakdown: empty
			? []
			: [{ categoryId: "salary", title: "Salary", amount: income, share: 1 }],
		expenseBreakdown: empty
			? []
			: [
					{ categoryId: "food", title: "Food & Drink", amount: expense * (2 / 3), share: 2 / 3 },
					{ categoryId: "transport", title: "Transport", amount: expense / 3, share: 1 / 3 },
				],
		transactionCount: empty ? 0 : 3,
	};
}

function buildAccountsAnalytics(netWorth = 97218.91): AccountsAnalytics {
	return {
		userId: USER_ID,
		currency: "AED",
		asOf: NOW,
		period: buildAnalytics("monthly").period,
		netWorth,
		inflow: 1000,
		outflow: 600,
		netFlow: 400,
		accounts: [
			{
				accountId: "fab",
				title: "FAB - Savings",
				currency: "AED",
				balance: 142594.69,
				isArchived: false,
				accountType: "asset",
			},
			{
				accountId: "cash",
				title: "Cash",
				currency: "AED",
				balance: 378.09,
				isArchived: false,
				accountType: "asset",
			},
		],
		warnings: [],
	};
}

async function mockHooks(empty = false) {
	const { useAccountsAnalytics } = await import("@/hooks/useAccountsAnalytics");
	const { usePeriodAnalytics } = await import("@/hooks/usePeriodAnalytics");

	vi.mocked(useAccountsAnalytics).mockReturnValue(buildAccountsAnalytics());
	vi.mocked(usePeriodAnalytics).mockImplementation((_userId, query) => {
		if (!query?.currency) return undefined;
		return buildAnalytics(query.interval === "quarterly" ? "quarterly" : "monthly", empty);
	});
}

describe("dashboard UI rebuild", () => {
	beforeEach(async () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		await mockHooks();

		window.matchMedia = vi.fn().mockImplementation((query: string) => ({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
			addListener: vi.fn(),
			removeListener: vi.fn(),
			dispatchEvent: vi.fn(),
		}));
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it("highlights the selected month and disables next at the current month", () => {
		render(<DashboardPageClient userId={USER_ID} />);

		const selectedMonth = screen.getByRole("button", { name: "Sep 2026, selected" });
		expect(selectedMonth).toHaveAttribute("aria-current", "date");
		expect(selectedMonth).toHaveAttribute("aria-pressed", "true");
		expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
		expect(screen.getByLabelText("Swipe dashboard month summary")).toHaveAttribute(
			"data-swipe-navigation-ignore"
		);
	});

	it("shows the same negative net-worth sign as accounts analytics", async () => {
		const { useAccountsAnalytics } = await import("@/hooks/useAccountsAnalytics");
		vi.mocked(useAccountsAnalytics).mockReturnValue(buildAccountsAnalytics(-4355391.13));

		render(<DashboardPageClient userId={USER_ID} />);

		expect(screen.getByText((text) => text.includes("-4,355,391.13"))).toBeInTheDocument();
	});

	it("changing interval updates every figure on the reports screen", async () => {
		const { usePeriodAnalytics } = await import("@/hooks/usePeriodAnalytics");
		render(<ReportsPageClient userId={USER_ID} />);

		expect(screen.getByText("Insights for Sep 2026")).toBeInTheDocument();
		expect(screen.getAllByText((text) => text.includes("1,000.00")).length).toBeGreaterThan(0);
		expect(screen.getAllByText((text) => text.includes("600.00")).length).toBeGreaterThan(0);

		fireEvent.click(screen.getByRole("button", { name: "Choose interval" }));
		fireEvent.click(screen.getByRole("radio", { name: "Quarterly" }));
		fireEvent.click(screen.getByRole("button", { name: "APPLY" }));

		expect(screen.getByText("Insights for Q3 2026")).toBeInTheDocument();
		expect(screen.getAllByText((text) => text.includes("3,000.00")).length).toBeGreaterThan(0);
		expect(screen.getAllByText((text) => text.includes("1,500.00")).length).toBeGreaterThan(0);
		expect(vi.mocked(usePeriodAnalytics).mock.calls.at(-1)?.[1]?.currency).toBe("AED");
	});

	it("keeps donut legend amounts equal to the displayed total", () => {
		render(
			<CategoryBreakdownChart
				userId={USER_ID}
				currency="AED"
				title="Expense"
				total={600}
				breakdown={[
					{ categoryId: "food", title: "Food & Drink", amount: 350, share: 350 / 600 },
					{ categoryId: "transport", title: "Transport", amount: 150, share: 150 / 600 },
					{ categoryId: null, title: "Uncategorized", amount: 100, share: 100 / 600 },
				]}
			/>
		);

		const legendTotal = screen
			.getAllByTestId("donut-legend-amount")
			.reduce((sum, item) => sum + Number(item.getAttribute("data-amount")), 0);

		expect(legendTotal).toBe(600);
		expect(screen.getByTestId("category-breakdown-total")).toHaveTextContent("600.00");
		expect(screen.getByText("Uncategorized")).toBeInTheDocument();
	});

	it("renders empty period states instead of broken charts", async () => {
		await mockHooks(true);

		render(<ReportsPageClient userId={USER_ID} />);

		expect(screen.getByText("No Income in this period")).toBeInTheDocument();
		expect(screen.getByText("No expenses in this period")).toBeInTheDocument();
		expect(within(screen.getByText("No Income in this period").closest("section")!)).toBeTruthy();
	});
});
