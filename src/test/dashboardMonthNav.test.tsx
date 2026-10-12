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
import { getPeriodStripRanges } from "@/lib/dateRange";
import { useFilterStore } from "@/store/filter-store";

import type {
	AccountsAnalytics,
	AnalyticsMonthSummaryItem,
	MonthlySummariesQuery,
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
		interval: "monthly",
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

function periodSummaries(
	query: MonthlySummariesQuery | undefined,
	empty = false
): AnalyticsMonthSummaryItem[] {
	const ranges = getPeriodStripRanges(query?.anchorDate ?? NOW, {
		interval: query?.interval ?? "monthly",
		fiscalYearStartMonth: query?.fiscalYearStartMonth,
		periods: query?.months ?? 6,
		mode: query?.mode === "around" ? "around" : "ending",
		timeZoneOffsetMinutes: query?.timeZoneOffsetMinutes,
	});

	return ranges.map((range, index) => {
		const income = empty ? 0 : 1000 + index * 200;
		const expense = empty ? 0 : 500 + index * 100;

		return {
			month: range.shortLabel,
			key: range.key,
			label: range.label,
			interval: range.interval,
			from: range.from,
			to: range.to,
			fromMs: range.fromMs,
			toMs: range.toMs,
			income,
			expense,
			net: income - expense,
			hasData: !empty,
			currency: "AED",
		};
	});
}

function chartBuckets(testId: "bar-chart" | "area-chart"): string[] {
	const raw = screen.getByTestId(testId).getAttribute("data-chart");
	return (JSON.parse(raw ?? "[]") as Array<{ month: string }>).map((item) => item.month);
}

function applyInterval(label: string) {
	fireEvent.click(screen.getByRole("button", { name: "Choose interval" }));
	fireEvent.click(screen.getByRole("radio", { name: label }));
	fireEvent.click(screen.getByRole("button", { name: "APPLY" }));
}

async function mockHooks(empty = false) {
	const { useAccountsAnalytics } = await import("@/hooks/useAccountsAnalytics");
	const { usePeriodAnalytics } = await import("@/hooks/usePeriodAnalytics");

	vi.mocked(useAccountsAnalytics).mockReturnValue(buildAccountsAnalytics());
	vi.mocked(usePeriodAnalytics).mockImplementation((_userId, query) => {
		if (!query?.currency) return undefined;
		return buildAnalytics(query.interval === "quarterly" ? "quarterly" : "monthly", empty);
	});
	mocks.useAnalyticsMonthSummaries.mockImplementation((_userId, query) =>
		periodSummaries(query, empty)
	);
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
		useFilterStore.setState({
			activeCurrency: "",
			includeFutureDatedBalances: true,
			showArchivedAccounts: false,
			accountId: null,
		});
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

	it("passes the shared future-dated balance basis to dashboard account analytics by default", async () => {
		const { useAccountsAnalytics } = await import("@/hooks/useAccountsAnalytics");

		render(<DashboardPageClient userId={USER_ID} />);

		expect(screen.getAllByText((text) => text.includes("97,218.91")).length).toBeGreaterThan(0);
		const accountQuery = vi.mocked(useAccountsAnalytics).mock.calls.at(-1)?.[1];
		expect(accountQuery).toEqual(
			expect.objectContaining({
				asOf: NOW,
				includeFutureDatedBalances: true,
			})
		);
		expect(screen.getByText("Net worth (including future)")).toBeInTheDocument();
		expect(screen.getAllByText("Incl. future").length).toBeGreaterThan(0);
	});

	it("updates the dashboard net-worth figure when toggling future-dated balances", async () => {
		const { useAccountsAnalytics } = await import("@/hooks/useAccountsAnalytics");
		const currentAnalytics = buildAccountsAnalytics(95000);
		const futureAnalytics = buildAccountsAnalytics(97218.91);
		vi.mocked(useAccountsAnalytics).mockImplementation((_userId, query) =>
			query?.includeFutureDatedBalances ? futureAnalytics : currentAnalytics
		);

		render(<DashboardPageClient userId={USER_ID} />);

		expect(screen.getAllByText((text) => text.includes("97,218.91")).length).toBeGreaterThan(0);
		expect(screen.getByRole("button", { name: "Exclude Future" })).toBeInTheDocument();
		expect(vi.mocked(useAccountsAnalytics).mock.calls.at(-1)?.[1]).toEqual(
			expect.objectContaining({ includeFutureDatedBalances: true })
		);

		fireEvent.click(screen.getByRole("button", { name: "Exclude Future" }));

		expect(screen.getAllByText((text) => text.includes("95,000.00")).length).toBeGreaterThan(0);
		expect(screen.getByRole("button", { name: "Include Future" })).toBeInTheDocument();
		expect(screen.getByText("Net worth (as of today)")).toBeInTheDocument();
		expect(vi.mocked(useAccountsAnalytics).mock.calls.at(-1)?.[1]).toEqual(
			expect.objectContaining({ includeFutureDatedBalances: false })
		);
	});

	it("honours the same shared future-balance store state used by the accounts page", async () => {
		const { useAccountsAnalytics } = await import("@/hooks/useAccountsAnalytics");
		useFilterStore.getState().setIncludeFutureDatedBalances(false);

		render(<DashboardPageClient userId={USER_ID} />);

		expect(screen.getByRole("button", { name: "Include Future" })).toBeInTheDocument();
		expect(screen.getByText("Net worth (as of today)")).toBeInTheDocument();
		expect(vi.mocked(useAccountsAnalytics).mock.calls.at(-1)?.[1]).toEqual(
			expect.objectContaining({ includeFutureDatedBalances: false })
		);
	});

	it("replaces duplicate period movement with the top expense metric", () => {
		render(<DashboardPageClient userId={USER_ID} />);

		const overview = screen.getByLabelText("Financial overview");
		expect(within(overview).queryByText("Period movement")).not.toBeInTheDocument();
		expect(within(overview).getByText("Top expense")).toBeInTheDocument();
		const topExpenseTile = within(overview).getByText("Top expense").closest("div")!;
		expect(within(topExpenseTile).getByText("Food & Drink")).toBeInTheDocument();
		expect(within(topExpenseTile).getByText((text) => text.includes("400.00"))).toBeInTheDocument();
		expect(within(topExpenseTile).getByText(/spent/)).toBeInTheDocument();
	});

	it("keeps period totals and trend charts identical across balance-basis toggles", async () => {
		const { useAccountsAnalytics } = await import("@/hooks/useAccountsAnalytics");
		const currentAnalytics = buildAccountsAnalytics(95000);
		const futureAnalytics = buildAccountsAnalytics(97218.91);
		vi.mocked(useAccountsAnalytics).mockImplementation((_userId, query) =>
			query?.includeFutureDatedBalances ? futureAnalytics : currentAnalytics
		);

		render(<DashboardPageClient userId={USER_ID} />);

		const initialIncomeCount = screen.getAllByText((text) => text.includes("1,000.00")).length;
		const initialExpenseCount = screen.getAllByText((text) => text.includes("600.00")).length;
		const initialCashFlowChart = screen.getByTestId("bar-chart").getAttribute("data-chart");
		const initialSpendingChart = screen.getByTestId("area-chart").getAttribute("data-chart");

		fireEvent.click(screen.getByRole("button", { name: "Exclude Future" }));

		expect(screen.getAllByText((text) => text.includes("1,000.00"))).toHaveLength(
			initialIncomeCount
		);
		expect(screen.getAllByText((text) => text.includes("600.00"))).toHaveLength(
			initialExpenseCount
		);
		expect(screen.getByTestId("bar-chart")).toHaveAttribute("data-chart", initialCashFlowChart);
		expect(screen.getByTestId("area-chart")).toHaveAttribute("data-chart", initialSpendingChart);
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

	it("values balances at the end of a past period instead of today", async () => {
		const { useAccountsAnalytics } = await import("@/hooks/useAccountsAnalytics");
		useFilterStore.setState({ includeFutureDatedBalances: false });

		render(<DashboardPageClient userId={USER_ID} />);

		// Current month: balances are still valued as of today.
		expect(vi.mocked(useAccountsAnalytics).mock.calls.at(-1)?.[1]).toEqual(
			expect.objectContaining({ asOf: NOW })
		);
		expect(screen.getByText("Net worth (as of today)")).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Previous month" }));

		// August 2026 has ended, so balances are valued at its close, not today.
		const asOf = vi.mocked(useAccountsAnalytics).mock.calls.at(-1)?.[1]?.asOf;
		expect(asOf).toBeInstanceOf(Date);
		expect(asOf!.getTime()).toBeLessThan(NOW.getTime());
		// Last local millisecond of August, whatever the runner's timezone.
		expect(asOf!.getMonth()).toBe(7);
		expect(asOf!.getDate()).toBe(31);
		expect(asOf!.getHours()).toBe(23);
		expect(asOf!.getMinutes()).toBe(59);
		expect(asOf!.getMilliseconds()).toBe(999);
		// The caption switches from "as of today" to the period's close. The exact
		// label comes from the mocked analytics, so match the shape, not the month.
		expect(screen.getByText(/^Net worth \(end of .+\)$/)).toBeInTheDocument();
		expect(screen.getAllByText(/^End .+/).length).toBeGreaterThan(0);
		expect(screen.queryByText("Net worth (as of today)")).not.toBeInTheDocument();
	});

	it("keeps balances including future dated transactions when that basis is on", async () => {
		const { useAccountsAnalytics } = await import("@/hooks/useAccountsAnalytics");
		useFilterStore.setState({ includeFutureDatedBalances: true });

		render(<DashboardPageClient userId={USER_ID} />);
		fireEvent.click(screen.getByRole("button", { name: "Previous month" }));

		expect(vi.mocked(useAccountsAnalytics).mock.calls.at(-1)?.[1]).toEqual(
			expect.objectContaining({ includeFutureDatedBalances: true })
		);
		expect(screen.getByText("Net worth (including future)")).toBeInTheDocument();
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

describe("dashboard interval propagation", () => {
	beforeEach(async () => {
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		useFilterStore.setState({
			activeCurrency: "",
			includeFutureDatedBalances: true,
			showArchivedAccounts: false,
			accountId: null,
		});
		await mockHooks();
		mockMatchMedia(false);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it("keeps monthly trend buckets and month navigation unchanged", () => {
		render(<DashboardPageClient userId={USER_ID} />);

		expect(chartBuckets("bar-chart")).toEqual([
			"Feb 26",
			"Mar 26",
			"Apr 26",
			"May 26",
			"Jun 26",
			"Jul 26",
			"Aug 26",
			"Sep 26",
		]);
		expect(chartBuckets("area-chart")).toEqual(chartBuckets("bar-chart"));
		expect(screen.getByText("Last 8 months in the selected currency")).toBeInTheDocument();
		expect(screen.getByLabelText("Select dashboard month")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Sep 2026, selected" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();

		fireEvent.click(screen.getByRole("button", { name: "Previous month" }));

		expect(screen.getByRole("button", { name: "Aug 2026, selected" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Next month" })).toBeEnabled();
		expect(chartBuckets("bar-chart").at(-1)).toBe("Aug 26");
	});

	it("rebuckets the trend charts when the interval changes", () => {
		render(<DashboardPageClient userId={USER_ID} />);

		const monthlyBuckets = chartBuckets("bar-chart");

		applyInterval("Quarterly");

		const quarterlyBuckets = chartBuckets("bar-chart");
		expect(quarterlyBuckets).not.toEqual(monthlyBuckets);
		expect(quarterlyBuckets).toEqual([
			"Q4 24",
			"Q1 25",
			"Q2 25",
			"Q3 25",
			"Q4 25",
			"Q1 26",
			"Q2 26",
			"Q3 26",
		]);
		expect(chartBuckets("area-chart")).toEqual(quarterlyBuckets);
		expect(screen.getByText("Last 8 quarters in the selected currency")).toBeInTheDocument();
		expect(screen.getByText("Highest quarter")).toBeInTheDocument();

		applyInterval("Half yearly");

		expect(chartBuckets("bar-chart")).toEqual([
			"H1 23",
			"H2 23",
			"H1 24",
			"H2 24",
			"H1 25",
			"H2 25",
			"H1 26",
			"H2 26",
		]);
		expect(screen.getByText("Last 8 half-years in the selected currency")).toBeInTheDocument();

		applyInterval("Yearly");

		expect(chartBuckets("bar-chart")).toEqual([
			"2019",
			"2020",
			"2021",
			"2022",
			"2023",
			"2024",
			"2025",
			"2026",
		]);
		expect(screen.getByText("Last 8 years in the selected currency")).toBeInTheDocument();

		applyInterval("All Time");

		expect(chartBuckets("bar-chart")).toEqual([
			"2019",
			"2020",
			"2021",
			"2022",
			"2023",
			"2024",
			"2025",
			"2026",
		]);
	});

	it("requests interval-aware summaries for the strip and the trend charts", async () => {
		const { useAnalyticsMonthSummaries } = await import("@/hooks/useAnalyticsMonthSummaries");

		render(<DashboardPageClient userId={USER_ID} />);
		applyInterval("Quarterly");

		const queries = vi.mocked(useAnalyticsMonthSummaries).mock.calls.map(([, query]) => query);
		expect(queries).toContainEqual(
			expect.objectContaining({ currency: "AED", months: 8, mode: "ending", interval: "quarterly" })
		);
		expect(queries).toContainEqual(
			expect.objectContaining({ currency: "AED", months: 5, mode: "around", interval: "quarterly" })
		);
	});

	it("renders the strip in the selected unit and navigates by that unit", () => {
		render(<DashboardPageClient userId={USER_ID} />);
		applyInterval("Quarterly");

		expect(screen.getByLabelText("Select dashboard quarter")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Q3 2026, selected" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Q1 2026" })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "Sep 2026, selected" })).not.toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Next quarter" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Q4 2026" })).toBeDisabled();

		fireEvent.click(screen.getByRole("button", { name: "Previous quarter" }));

		expect(screen.getByRole("button", { name: "Q2 2026, selected" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Next quarter" })).toBeEnabled();
		expect(chartBuckets("bar-chart").at(-1)).toBe("Q2 26");

		fireEvent.click(screen.getByRole("button", { name: "Next quarter" }));

		expect(screen.getByRole("button", { name: "Q3 2026, selected" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Next quarter" })).toBeDisabled();

		fireEvent.click(screen.getByRole("button", { name: "Q1 2026" }));

		expect(screen.getByRole("button", { name: "Q1 2026, selected" })).toBeInTheDocument();
		expect(chartBuckets("bar-chart").at(-1)).toBe("Q1 26");
	});

	it("labels the strip with halves and years for the wider intervals", () => {
		render(<DashboardPageClient userId={USER_ID} />);

		applyInterval("Half yearly");

		expect(screen.getByLabelText("Select dashboard half-year")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "H2 2026, selected" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "H1 2026" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Next half-year" })).toBeDisabled();

		fireEvent.click(screen.getByRole("button", { name: "Previous half-year" }));
		expect(screen.getByRole("button", { name: "H1 2026, selected" })).toBeInTheDocument();

		applyInterval("Yearly");

		expect(screen.getByLabelText("Select dashboard year")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "2026, selected" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "2024" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Next year" })).toBeDisabled();

		fireEvent.click(screen.getByRole("button", { name: "Previous year" }));
		expect(screen.getByRole("button", { name: "2025, selected" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Next year" })).toBeEnabled();
	});

	it("keeps budget progress on the monthly period when a wider interval is chosen", async () => {
		const { usePeriodAnalytics } = await import("@/hooks/usePeriodAnalytics");

		render(<DashboardPageClient userId={USER_ID} />);
		applyInterval("Quarterly");

		expect(screen.getByText("Budget progress")).toBeInTheDocument();
		expect(screen.getByText("Sep 2026")).toBeInTheDocument();
		expect(vi.mocked(usePeriodAnalytics).mock.calls.map(([, query]) => query)).toContainEqual(
			expect.objectContaining({ interval: "monthly" })
		);
	});
});
