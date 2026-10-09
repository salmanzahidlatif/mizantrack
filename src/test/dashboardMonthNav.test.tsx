import "fake-indexeddb/auto";

import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CategoryBreakdownChart } from "@/components/charts/CategoryDonutChart";
import {
	AccountDistributionChart,
	CashFlowTrendChart,
	SpendingTrendChart,
} from "@/components/charts/DashboardDesktopCharts";
import { DashboardPageClient } from "@/components/dashboard/DashboardPageClient";
import { ReportsPageClient } from "@/components/reports/ReportsPageClient";

import type {
	AccountsAnalytics,
	AnalyticsMonthSummaryItem,
	PeriodAnalytics,
} from "@/lib/analytics/periodAnalytics";
import type { ReactNode } from "react";

const USER_ID = "dashboard-ui-rebuild-user";
const NOW = new Date("2026-09-29T12:00:00.000Z");

const mocks = vi.hoisted(() => ({
	useAnalyticsMonthSummaries: vi.fn(),
	useBudgets: vi.fn(),
}));

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
		AreaChart: ({ data, children }: { data?: unknown; children?: ReactNode }) => (
			<ChartContainer data={data} testId="area-chart">
				{children}
			</ChartContainer>
		),
		Area: () => <div data-testid="area" />,
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
	useAnalyticsMonthSummaries: mocks.useAnalyticsMonthSummaries,
}));

vi.mock("@/hooks/useBudgets", () => ({
	useBudgets: mocks.useBudgets,
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
		allAccounts: [
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
		unscopedAccounts: [],
		warnings: [],
	};
}

function trendSummaries(empty = false): AnalyticsMonthSummaryItem[] {
	const values = [
		["Feb", "2026-02", 1200, 700],
		["Mar", "2026-03", 1500, 0],
		["Apr", "2026-04", 1600, 900],
		["May", "2026-05", 1400, 800],
		["Jun", "2026-06", 2000, 1100],
		["Jul", "2026-07", 1800, 1200],
		["Aug", "2026-08", 2200, 1300],
		["Sep", "2026-09", 2400, 1500],
	] as const;

	return values.map(([month, key, income, expense]) => ({
		month,
		key,
		label: `${month} 2026`,
		from: new Date(`${key}-01T00:00:00.000Z`),
		to: new Date(`${key}-28T23:59:59.999Z`),
		fromMs: new Date(`${key}-01T00:00:00.000Z`).getTime(),
		toMs: new Date(`${key}-28T23:59:59.999Z`).getTime(),
		income: empty ? 0 : income,
		expense: empty ? 0 : expense,
		net: empty ? 0 : income - expense,
		hasData: !empty && (income > 0 || expense > 0),
		currency: "AED",
	}));
}

async function mockHooks(empty = false) {
	const { useAccountsAnalytics } = await import("@/hooks/useAccountsAnalytics");
	const { usePeriodAnalytics } = await import("@/hooks/usePeriodAnalytics");

	vi.mocked(useAccountsAnalytics).mockReturnValue(buildAccountsAnalytics());
	vi.mocked(usePeriodAnalytics).mockImplementation((_userId, query) => {
		if (!query?.currency) return undefined;
		return buildAnalytics(query.interval === "quarterly" ? "quarterly" : "monthly", empty);
	});
	mocks.useAnalyticsMonthSummaries.mockReturnValue(trendSummaries(empty));
	mocks.useBudgets.mockReturnValue({ budgets: [], categories: [], rows: [] });
}

function mockMatchMedia(matches: boolean | Record<string, boolean>) {
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		matches: typeof matches === "boolean" ? matches : (matches[query] ?? false),
		media: query,
		onchange: null,
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		addListener: vi.fn(),
		removeListener: vi.fn(),
		dispatchEvent: vi.fn(),
	}));
}

describe("dashboard UI rebuild", () => {
	beforeEach(async () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		await mockHooks();
		mockMatchMedia(false);
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

		expect(screen.getAllByText((text) => text.includes("-4,355,391.13")).length).toBeGreaterThan(0);
	});

	it("keeps dashboard account analytics on the current balance basis", async () => {
		const { useAccountsAnalytics } = await import("@/hooks/useAccountsAnalytics");

		render(<DashboardPageClient userId={USER_ID} />);

		expect(screen.getAllByText((text) => text.includes("97,218.91")).length).toBeGreaterThan(0);
		const accountQuery = vi.mocked(useAccountsAnalytics).mock.calls.at(-1)?.[1];
		expect(accountQuery).not.toHaveProperty("includeFutureDatedBalances");
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

	it("shows every dashboard widget on mobile while reflowing to a desktop grid", () => {
		render(<DashboardPageClient userId={USER_ID} />);

		const grid = screen.getByTestId("dashboard-responsive-grid");
		expect(grid).toHaveClass("space-y-4");
		expect(grid).toHaveClass("md:grid");
		expect(grid).toHaveClass("md:grid-cols-12");
		expect(grid).toHaveClass("md:items-stretch");
		expect(screen.getByLabelText("Swipe dashboard month summary")).toHaveAttribute(
			"data-swipe-navigation-ignore"
		);
		expect(screen.getByText("What You Have")).toBeInTheDocument();
		expect(screen.getByLabelText(/Income and expense for/i)).toBeInTheDocument();
		expect(screen.getByTestId("account-distribution-chart")).toBeInTheDocument();
		expect(screen.getByLabelText("Financial overview")).toBeInTheDocument();
		expect(screen.getByText("Income vs expense trend")).toBeInTheDocument();
		expect(screen.getByText("Spending trend")).toBeInTheDocument();
		expect(screen.getByText("Your Monthly Expense")).toBeInTheDocument();
		expect(screen.getByText("Budget progress")).toBeInTheDocument();
	});

	it("stretches desktop row cards to a consistent row height without hiding mobile content", async () => {
		const { useAccountsAnalytics } = await import("@/hooks/useAccountsAnalytics");
		const analytics = buildAccountsAnalytics();
		analytics.accounts = [
			...analytics.accounts,
			{
				accountId: "emergency",
				title: "Emergency Fund",
				currency: "AED",
				balance: 1200,
				isArchived: false,
				accountType: "asset",
			},
			{
				accountId: "wallet",
				title: "Wallet",
				currency: "AED",
				balance: 800,
				isArchived: false,
				accountType: "asset",
			},
		];
		analytics.allAccounts = analytics.accounts;
		vi.mocked(useAccountsAnalytics).mockReturnValue(analytics);

		render(<DashboardPageClient userId={USER_ID} />);

		const topCells = screen.getAllByTestId("dashboard-top-card-cell");
		expect(topCells).toHaveLength(3);
		topCells.forEach((cell) => {
			expect(cell.className).toMatch(/md:flex|xl:flex/);
		});
		expect(screen.getByTestId("what-you-have-card")).toHaveClass("md:h-full");
		expect(screen.getAllByTestId("dashboard-account-tile")[3]).not.toHaveClass("xl:hidden");
	});

	it("mounts one shared account distribution widget instead of breakpoint-specific copies", () => {
		render(<DashboardPageClient userId={USER_ID} />);

		expect(screen.getAllByTestId("account-distribution-chart")).toHaveLength(1);
		const topCells = screen.getAllByTestId("dashboard-top-card-cell");
		expect(topCells).toHaveLength(3);
		expect(within(topCells[2]!).getByTestId("account-distribution-chart")).toBeInTheDocument();
	});

	it("requests chart data from the shared cached analytics hook on every viewport", async () => {
		const { useAnalyticsMonthSummaries } = await import("@/hooks/useAnalyticsMonthSummaries");

		render(<DashboardPageClient userId={USER_ID} />);

		expect(vi.mocked(useAnalyticsMonthSummaries)).toHaveBeenCalledWith(
			USER_ID,
			expect.objectContaining({
				currency: "AED",
				months: 8,
				mode: "ending",
			})
		);
	});

	it("renders new trend charts from analytics month summaries", () => {
		const summaries = trendSummaries();
		const { rerender } = render(<CashFlowTrendChart summaries={summaries} currency="AED" />);

		expect(screen.getByTestId("bar-chart")).toHaveAttribute(
			"data-chart",
			JSON.stringify(
				summaries.map((item) => ({
					month: item.month,
					income: item.income,
					expense: item.expense,
					net: item.net,
					currency: item.currency,
				}))
			)
		);

		rerender(<SpendingTrendChart summaries={summaries} currency="AED" />);
		expect(screen.getByTestId("area-chart")).toHaveAttribute(
			"data-chart",
			JSON.stringify(
				summaries.map((item) => ({
					month: item.month,
					expense: item.expense,
					currency: item.currency,
				}))
			)
		);
	});

	it("keeps account distribution scoped to the active currency analytics", () => {
		const analytics = buildAccountsAnalytics(1500);
		analytics.accounts = [
			{
				accountId: "aed-wallet",
				title: "AED Wallet",
				currency: "AED",
				balance: 1000,
				isArchived: false,
				accountType: "asset",
			},
			{
				accountId: "aed-cash",
				title: "AED Cash",
				currency: "AED",
				balance: 500,
				isArchived: false,
				accountType: "asset",
			},
		];
		analytics.allAccounts = [
			...analytics.accounts,
			{
				accountId: "pkr-wallet",
				title: "PKR Wallet",
				currency: "PKR",
				balance: 200000,
				isArchived: false,
				accountType: "asset",
			},
		];

		render(<AccountDistributionChart analytics={analytics} />);

		expect(screen.getByText("AED Wallet")).toBeInTheDocument();
		expect(screen.getByText("AED Cash")).toBeInTheDocument();
		expect(screen.queryByText("PKR Wallet")).not.toBeInTheDocument();
		const displayedTotal = screen
			.getAllByTestId("account-distribution-amount")
			.reduce((sum, item) => sum + Number(item.getAttribute("data-amount")), 0);
		expect(displayedTotal).toBe(1500);
	});

	it("keeps every account distribution legend row reachable with its value", () => {
		const analytics = buildAccountsAnalytics(2925);
		analytics.accounts = [
			{
				accountId: "checking",
				title: "Checking",
				currency: "AED",
				balance: 1000,
				isArchived: false,
				accountType: "asset",
			},
			{
				accountId: "savings",
				title: "Savings",
				currency: "AED",
				balance: 900,
				isArchived: false,
				accountType: "asset",
			},
			{
				accountId: "wallet",
				title: "Wallet",
				currency: "AED",
				balance: 600,
				isArchived: false,
				accountType: "asset",
			},
			{
				accountId: "emergency",
				title: "Emergency Fund",
				currency: "AED",
				balance: 400,
				isArchived: false,
				accountType: "asset",
			},
			{
				accountId: "cash",
				title: "Cash",
				currency: "AED",
				balance: 25,
				isArchived: false,
				accountType: "asset",
			},
		];
		analytics.allAccounts = analytics.accounts;

		render(<AccountDistributionChart analytics={analytics} />);

		const legend = screen.getByTestId("account-distribution-legend");
		expect(legend).toHaveClass("overflow-y-auto");
		expect(legend).toHaveClass("max-h-36");
		expect(legend).toHaveClass("md:max-h-44");

		const rows = screen.getAllByTestId("account-distribution-row");
		expect(rows).toHaveLength(5);
		const cashRow = rows.find((row) => within(row).queryByText("Cash"));
		expect(cashRow).toBeDefined();
		expect(within(cashRow!).getByTestId("account-distribution-amount")).toHaveAttribute(
			"data-amount",
			"25"
		);
		expect(within(cashRow!).getByText((text) => text.includes("25.00"))).toBeInTheDocument();
	});

	it("renders empty period states instead of broken charts", async () => {
		await mockHooks(true);

		render(<ReportsPageClient userId={USER_ID} />);

		expect(screen.getByText("No Income in this period")).toBeInTheDocument();
		expect(screen.getByText("No expenses in this period")).toBeInTheDocument();
		expect(within(screen.getByText("No Income in this period").closest("section")!)).toBeTruthy();
	});

	it("renders intentional empty states for new desktop charts", () => {
		const emptySummaries = trendSummaries(true);
		const emptyAccounts = buildAccountsAnalytics(0);
		emptyAccounts.accounts = [];

		const { rerender } = render(<CashFlowTrendChart summaries={emptySummaries} currency="AED" />);
		expect(screen.getByText("No cash-flow trend yet")).toBeInTheDocument();

		rerender(<SpendingTrendChart summaries={emptySummaries} currency="AED" />);
		expect(screen.getByText("No spending trend yet")).toBeInTheDocument();

		rerender(<AccountDistributionChart analytics={emptyAccounts} />);
		expect(screen.getByText("No positive account balances")).toBeInTheDocument();
	});
});
