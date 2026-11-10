import "fake-indexeddb/auto";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardPageClient } from "@/components/dashboard/DashboardPageClient";
import { useFilterStore } from "@/store/filter-store";

import type * as BalanceMathModule from "@/lib/analytics/balanceMath";
import type {
	CategoryComparisonItem,
	ComparisonAnalytics,
	ComparisonAnalyticsQuery,
	ComparisonTotals,
} from "@/lib/analytics/comparisonAnalytics";
import type {
	AccountsAnalytics,
	AnalyticsMonthSummaryItem,
	PeriodAnalytics,
} from "@/lib/analytics/periodAnalytics";
import type {
	SalaryProgressionAnalytics,
	SalaryProgressionPoint,
	SalaryProgressionQuery,
} from "@/lib/analytics/salaryProgression";
import type { ReactNode } from "react";

const USER_ID = "dashboard-savings-salary-user";
const NOW = new Date("2026-09-29T12:00:00.000Z");

const mocks = vi.hoisted(() => ({
	useAnalyticsMonthSummaries: vi.fn(),
	useBudgets: vi.fn(),
	useComparisonAnalytics: vi.fn(),
	useSalaryProgression: vi.fn(),
	useDbConfig: vi.fn(),
	resolveCurrencyCode: vi.fn(),
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
		ReferenceLine: () => <div data-testid="reference-line" />,
		ReferenceDot: () => <div data-testid="reference-dot" />,
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

vi.mock("@/hooks/useComparisonAnalytics", () => ({
	useComparisonAnalytics: mocks.useComparisonAnalytics,
}));

vi.mock("@/hooks/useSalaryProgression", () => ({
	useSalaryProgression: mocks.useSalaryProgression,
}));

vi.mock("@/hooks/useDbConfig", () => ({
	useDbConfig: mocks.useDbConfig,
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

vi.mock("@/lib/analytics/balanceMath", async (importOriginal) => {
	const actual = await importOriginal<typeof BalanceMathModule>();
	return { ...actual, resolveCurrencyCode: mocks.resolveCurrencyCode };
});

vi.mock("@/store/ui-store", () => ({
	useUIStore: (selector: (state: { openAddAccount: () => void }) => unknown) =>
		selector({ openAddAccount: vi.fn() }),
}));

function buildPeriodAnalytics(): PeriodAnalytics {
	return {
		userId: USER_ID,
		currency: "AED",
		period: {
			interval: "monthly",
			key: "2026-09",
			label: "Sep 2026",
			from: new Date("2026-09-01T00:00:00.000Z"),
			to: new Date("2026-09-30T23:59:59.999Z"),
			fromMs: new Date("2026-09-01T00:00:00.000Z").getTime(),
			toMs: new Date("2026-09-30T23:59:59.999Z").getTime(),
		},
		income: 1000,
		expense: 600,
		net: 400,
		incomeBreakdown: [{ categoryId: "salary", title: "Salary", amount: 1000, share: 1 }],
		expenseBreakdown: [{ categoryId: "food", title: "Food & Drink", amount: 600, share: 1 }],
		transactionCount: 3,
	};
}

function buildAccountsAnalytics(): AccountsAnalytics {
	return {
		userId: USER_ID,
		currency: "AED",
		asOf: NOW,
		period: buildPeriodAnalytics().period,
		netWorth: 97218.91,
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
		],
		unscopedAccounts: [],
		warnings: [],
	};
}

function monthSummaries(): AnalyticsMonthSummaryItem[] {
	return [];
}

function buildComparisonItem(
	overrides: Partial<CategoryComparisonItem> = {}
): CategoryComparisonItem {
	const previousAmount = overrides.previousAmount ?? 500;
	const currentAmount = overrides.currentAmount ?? 300;
	const delta = currentAmount - previousAmount;

	return {
		categoryId: "category-home-internet",
		title: "Home Internet",
		currentAmount,
		previousAmount,
		delta,
		savings: -delta,
		changeShare: previousAmount === 0 ? null : delta / previousAmount,
		isNew: false,
		isDropped: false,
		...overrides,
	};
}

function buildComparisonTotals(overrides: Partial<ComparisonTotals> = {}): ComparisonTotals {
	return {
		currentIncome: 10000,
		previousIncome: 9000,
		currentExpense: 4000,
		previousExpense: 4500,
		currentNet: 6000,
		previousNet: 4500,
		incomeDelta: 1000,
		expenseDelta: -500,
		netDelta: 1500,
		expenseSavings: 500,
		incomeGrowth: 1000,
		currentTransactionCount: 24,
		previousTransactionCount: 22,
		totalBenefit: 1500,
		...overrides,
	};
}

function buildComparisonAnalytics(): ComparisonAnalytics {
	const topSavings = [buildComparisonItem()];
	const topIncreases = [
		buildComparisonItem({
			categoryId: "category-mobile-data",
			title: "Mobile Data",
			previousAmount: 100,
			currentAmount: 180,
		}),
	];

	return {
		currency: "AED",
		presetId: "year-vs-last-year",
		current: { fromMs: 0, toMs: 1, label: "2026" },
		previous: { fromMs: -2, toMs: -1, label: "2025" },
		totals: buildComparisonTotals(),
		expenseCategories: [...topSavings, ...topIncreases],
		incomeCategories: [],
		topSavings,
		topIncreases,
	};
}

function buildSalaryPoint(overrides: Partial<SalaryProgressionPoint> = {}) {
	return {
		key: "2024",
		label: "2024",
		fromMs: Date.UTC(2024, 0, 1),
		toMs: Date.UTC(2024, 11, 31),
		total: 120000,
		monthsWithIncome: 12,
		monthsCovered: 12,
		average: 10000,
		transactionCount: 12,
		isPartial: false,
		delta: 0,
		growthShare: null,
		averageDelta: 0,
		averageGrowthShare: null,
		isHike: false,
		...overrides,
	} satisfies SalaryProgressionPoint;
}

function buildSalaryAnalytics(): SalaryProgressionAnalytics {
	return {
		currency: "AED",
		interval: "yearly",
		points: [
			buildSalaryPoint(),
			buildSalaryPoint({
				key: "2025",
				label: "2025",
				fromMs: Date.UTC(2025, 0, 1),
				toMs: Date.UTC(2025, 11, 31),
				total: 144000,
				average: 12000,
				delta: 24000,
				growthShare: 0.2,
				averageDelta: 2000,
				averageGrowthShare: 0.2,
				isHike: true,
			}),
		],
		usedCategoryIds: ["salary"],
		usedFallbackAllIncome: false,
		reattributedPaymentCount: 0,
		firstSalaryMs: Date.UTC(2024, 0, 15),
		lastSalaryMs: Date.UTC(2025, 11, 15),
		totalEarned: 264000,
		startingAverage: 10000,
		latestAverage: 12000,
		overallGrowthShare: 0.2,
		cagr: 0.2,
		hikes: [
			{
				key: "2025",
				label: "2025",
				bucketKey: "2025",
				atMs: Date.UTC(2025, 0, 1),
				fromAverage: 10000,
				toAverage: 12000,
				share: 0.2,
			},
		],
	};
}

function lastComparisonQuery(): ComparisonAnalyticsQuery | undefined {
	return mocks.useComparisonAnalytics.mock.calls.at(-1)?.[1] as
		| ComparisonAnalyticsQuery
		| undefined;
}

function lastSalaryQuery(): SalaryProgressionQuery | undefined {
	return mocks.useSalaryProgression.mock.calls.at(-1)?.[1] as SalaryProgressionQuery | undefined;
}

async function mockBaseHooks() {
	const { useAccountsAnalytics } = await import("@/hooks/useAccountsAnalytics");
	const { usePeriodAnalytics } = await import("@/hooks/usePeriodAnalytics");
	const actualBalanceMath = await vi.importActual<typeof BalanceMathModule>(
		"@/lib/analytics/balanceMath"
	);

	mocks.resolveCurrencyCode.mockImplementation(actualBalanceMath.resolveCurrencyCode);
	vi.mocked(useAccountsAnalytics).mockReturnValue(buildAccountsAnalytics());
	vi.mocked(usePeriodAnalytics).mockImplementation((_userId, query) =>
		query?.currency ? buildPeriodAnalytics() : undefined
	);
	mocks.useAnalyticsMonthSummaries.mockImplementation(() => monthSummaries());
	mocks.useBudgets.mockReturnValue({ budgets: [], categories: [], rows: [] });
	mocks.useDbConfig.mockReturnValue({ currency: "AED", fiscalYearStartMonth: 1 });
	mocks.useComparisonAnalytics.mockReturnValue(buildComparisonAnalytics());
	mocks.useSalaryProgression.mockReturnValue(buildSalaryAnalytics());
}

beforeAll(() => {
	Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: () => {},
	});
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

beforeEach(async () => {
	vi.setSystemTime(NOW);
	useFilterStore.setState({
		activeCurrency: "",
		includeFutureDatedBalances: true,
		showArchivedAccounts: false,
		accountId: null,
	});
	await mockBaseHooks();
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("dashboard savings and salary cards", () => {
	it("renders the savings comparison headline from the comparison hook", async () => {
		render(<DashboardPageClient userId={USER_ID} />);

		expect(await screen.findByText("Savings vs Previous Period")).toBeInTheDocument();
		expect(screen.getByTestId("savings-headline")).toHaveTextContent("1,500.00");
		expect(screen.getByText("better off")).toBeInTheDocument();
		expect(screen.getAllByTestId("savings-row")).toHaveLength(2);
	});

	it("renders the salary progression card from the salary hook", async () => {
		render(<DashboardPageClient userId={USER_ID} />);

		expect(await screen.findByText("Salary Progression")).toBeInTheDocument();
		expect(screen.getByTestId("salary-latest-average")).toHaveTextContent("12,000.00");
		expect(screen.getByTestId("salary-overall-growth")).toHaveTextContent("+20.0%");
		expect(screen.getByTestId("salary-progression-chart")).toBeInTheDocument();
	});

	it("renders loading skeletons for both cards while the hooks return undefined", async () => {
		mocks.useComparisonAnalytics.mockReturnValue(undefined);
		mocks.useSalaryProgression.mockReturnValue(undefined);

		const { container } = render(<DashboardPageClient userId={USER_ID} />);

		await waitFor(() => {
			expect(mocks.useComparisonAnalytics).toHaveBeenCalled();
		});
		expect(container.querySelectorAll(".shimmer").length).toBeGreaterThan(0);
		expect(screen.queryByTestId("savings-headline")).toBeNull();
		expect(screen.queryByText("Salary Progression")).toBeNull();
	});

	it("re-queries comparison analytics with the newly picked preset", async () => {
		render(<DashboardPageClient userId={USER_ID} />);

		await screen.findByText("Savings vs Previous Period");
		expect(lastComparisonQuery()?.presetId).toBe("year-vs-last-year");

		fireEvent.click(screen.getByRole("combobox", { name: "Comparison period" }));
		fireEvent.click(
			await screen.findByRole("option", { name: "Last 6 months vs previous 6 months" })
		);

		await waitFor(() => {
			expect(lastComparisonQuery()?.presetId).toBe("half-vs-prev-half");
		});
	});

	it("re-queries salary progression with the newly picked window as a number", async () => {
		render(<DashboardPageClient userId={USER_ID} />);

		await screen.findByText("Salary Progression");
		expect(lastSalaryQuery()?.years).toBe(0);

		fireEvent.click(screen.getByRole("combobox", { name: "Salary window" }));
		fireEvent.click(await screen.findByRole("option", { name: "Last 5 years" }));

		await waitFor(() => {
			expect(lastSalaryQuery()?.years).toBe(5);
		});
	});

	it("passes the resolved active currency to both hooks", async () => {
		useFilterStore.setState({ activeCurrency: "USD" });

		render(<DashboardPageClient userId={USER_ID} />);

		await screen.findByText("Salary Progression");
		expect(lastComparisonQuery()?.currency).toBe("USD");
		expect(lastSalaryQuery()?.currency).toBe("USD");
		expect(lastSalaryQuery()?.interval).toBe("yearly");
	});

	it("keeps both hooks idle when no currency can be resolved", async () => {
		mocks.resolveCurrencyCode.mockReturnValue("");

		render(<DashboardPageClient userId={USER_ID} />);

		await waitFor(() => {
			expect(mocks.useComparisonAnalytics).toHaveBeenCalled();
		});
		expect(lastComparisonQuery()).toBeUndefined();
		expect(lastSalaryQuery()).toBeUndefined();
	});

	it("keeps the pre-existing dashboard cards rendered alongside the new ones", async () => {
		render(<DashboardPageClient userId={USER_ID} />);

		await screen.findByText("Savings vs Previous Period");
		expect(screen.getByLabelText("Financial overview")).toBeInTheDocument();
		expect(screen.getByText("Budget progress")).toBeInTheDocument();
		expect(screen.getAllByTestId("dashboard-top-card-cell").length).toBeGreaterThan(0);
	});
});
