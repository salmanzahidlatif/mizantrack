import "fake-indexeddb/auto";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { SavingsComparisonCard } from "@/components/charts/SavingsComparisonCard";

import type {
	CategoryComparisonItem,
	ComparisonAnalytics,
	ComparisonTotals,
} from "@/lib/analytics/comparisonAnalytics";
import type { ReactNode } from "react";

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
		ReferenceLine: () => <div data-testid="reference-line" />,
		Tooltip: () => <div data-testid="tooltip" />,
		Bar: ({ children }: { children?: ReactNode }) => <div data-testid="bar">{children}</div>,
		Cell: () => <div data-testid="cell" />,
	};
});

beforeAll(() => {
	Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: () => {},
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const CUSTOM_RANGE = {
	from: new Date(Date.UTC(2026, 3, 1, 12)),
	to: new Date(Date.UTC(2026, 4, 31, 12)),
};

function buildItem(overrides: Partial<CategoryComparisonItem> = {}): CategoryComparisonItem {
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

function buildTotals(overrides: Partial<ComparisonTotals> = {}): ComparisonTotals {
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

function buildAnalytics(overrides: Partial<ComparisonAnalytics> = {}): ComparisonAnalytics {
	const topSavings = overrides.topSavings ?? [buildItem()];
	const topIncreases = overrides.topIncreases ?? [];

	return {
		currency: "AED",
		presetId: "half-vs-prev-half",
		current: { fromMs: 0, toMs: 1, label: "Apr 2026 – Sep 2026" },
		previous: { fromMs: -2, toMs: -1, label: "Oct 2025 – Mar 2026" },
		totals: buildTotals(overrides.totals),
		expenseCategories: [...topSavings, ...topIncreases],
		incomeCategories: [],
		...overrides,
		topSavings,
		topIncreases,
	};
}

function renderCard(props: Partial<Parameters<typeof SavingsComparisonCard>[0]> = {}) {
	const onPresetChange = vi.fn();
	const result = render(
		<SavingsComparisonCard
			data={buildAnalytics()}
			currency="AED"
			presetId="half-vs-prev-half"
			onPresetChange={onPresetChange}
			{...props}
		/>
	);

	return { ...result, onPresetChange };
}

describe("SavingsComparisonCard", () => {
	it("renders a skeleton while loading", () => {
		const { container } = renderCard({ isLoading: true });

		expect(container.querySelector(".shimmer")).not.toBeNull();
		expect(screen.queryByTestId("savings-headline")).toBeNull();
	});

	it("shows the better-off headline when the total benefit is positive", () => {
		renderCard();

		expect(screen.getByText("better off")).toBeInTheDocument();
		expect(screen.getByTestId("savings-headline")).toHaveTextContent("1,500.00");
	});

	it("shows the down headline with an absolute amount when the total benefit is negative", () => {
		renderCard({
			data: buildAnalytics({ totals: buildTotals({ totalBenefit: -750, netDelta: -750 }) }),
		});

		expect(screen.getByText("down")).toBeInTheDocument();
		const headline = screen.getByTestId("savings-headline");
		expect(headline).toHaveTextContent("750.00");
		expect(headline.textContent ?? "").not.toContain("-");
	});

	it("itemises the home internet saving", () => {
		renderCard();

		const rows = screen.getAllByTestId("savings-row");
		expect(rows).toHaveLength(1);
		expect(rows[0]).toHaveAttribute("data-category", "Home Internet");
		expect(rows[0]).toHaveAttribute("data-savings", "200");
		expect(rows[0]).toHaveTextContent("500.00");
		expect(rows[0]).toHaveTextContent("300.00");
	});

	it("itemises an increase as a negative saving", () => {
		renderCard({
			data: buildAnalytics({
				topSavings: [],
				topIncreases: [
					buildItem({
						categoryId: "category-mobile-data",
						title: "Mobile Data",
						previousAmount: 100,
						currentAmount: 180,
					}),
				],
			}),
		});

		const row = screen.getByTestId("savings-row");
		expect(row).toHaveAttribute("data-category", "Mobile Data");
		expect(row).toHaveAttribute("data-savings", "-80");
	});

	it("renders an em dash instead of Infinity or NaN when changeShare is null", () => {
		const { container } = renderCard({
			data: buildAnalytics({
				topSavings: [],
				topIncreases: [
					buildItem({
						categoryId: "category-new-gym",
						title: "Gym",
						previousAmount: 0,
						currentAmount: 250,
						changeShare: null,
						isNew: true,
					}),
				],
			}),
		});

		const row = screen.getByTestId("savings-row");
		expect(row).toHaveTextContent("—");
		expect(row).toHaveTextContent("New");
		expect(container.textContent ?? "").not.toMatch(/Infinity|NaN/);
	});

	it("calls onPresetChange when a new comparison period is picked", async () => {
		const { onPresetChange } = renderCard();

		fireEvent.click(screen.getByRole("combobox", { name: "Comparison period" }));
		fireEvent.click(await screen.findByRole("option", { name: "This year vs last year" }));

		expect(onPresetChange).toHaveBeenCalledWith("year-vs-last-year");
	});

	it("prompts for dates instead of charting a mismatched fallback window", () => {
		renderCard({ presetId: "custom", customRange: null, onCustomRangeChange: vi.fn() });

		expect(screen.getByText("Pick a date range")).toBeInTheDocument();
		expect(screen.queryByTestId("savings-comparison-chart")).toBeNull();
		expect(screen.queryAllByTestId("savings-row")).toHaveLength(0);
	});

	it("does not offer range presets that cannot be compared against", () => {
		renderCard({
			presetId: "custom",
			customRange: CUSTOM_RANGE,
			onCustomRangeChange: vi.fn(),
		});

		expect(screen.queryByRole("button", { name: "All" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Today" })).toBeNull();
		expect(screen.getByRole("button", { name: "Month" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Fiscal Year" })).toBeInTheDocument();
	});

	it("forwards the configured fiscal year start to the range picker", () => {
		const onCustomRangeChange = vi.fn();
		renderCard({
			presetId: "custom",
			customRange: CUSTOM_RANGE,
			onCustomRangeChange,
			fiscalYearStartMonth: 4,
		});

		fireEvent.click(screen.getByRole("button", { name: "Fiscal Year" }));

		const range = onCustomRangeChange.mock.calls.at(-1)?.[0] as { from: Date; to: Date };
		expect(range.from.getMonth()).toBe(3);
		expect(range.from.getDate()).toBe(1);
	});

	it("renders the empty state and no chart when there is nothing to compare", () => {
		renderCard({
			data: buildAnalytics({
				topSavings: [],
				topIncreases: [],
				totals: buildTotals({ totalBenefit: 0 }),
			}),
		});

		expect(screen.getByText("Not enough history to compare yet")).toBeInTheDocument();
		expect(screen.queryByTestId("savings-comparison-chart")).toBeNull();
		expect(screen.queryAllByTestId("savings-row")).toHaveLength(0);
	});

	it("feeds the chart savings first, then increases", () => {
		renderCard({
			data: buildAnalytics({
				topSavings: [
					buildItem(),
					buildItem({
						categoryId: "category-groceries",
						title: "Groceries",
						previousAmount: 900,
						currentAmount: 850,
					}),
				],
				topIncreases: [
					buildItem({
						categoryId: "category-mobile-data",
						title: "Mobile Data",
						previousAmount: 100,
						currentAmount: 180,
					}),
				],
			}),
		});

		expect(screen.getByTestId("savings-comparison-chart")).toBeInTheDocument();
		const payload = JSON.parse(
			screen.getByTestId("bar-chart").getAttribute("data-chart") ?? "null"
		) as CategoryComparisonItem[];

		expect(payload.map((item) => item.title)).toEqual([
			"Home Internet",
			"Groceries",
			"Mobile Data",
		]);
		expect(payload.map((item) => item.savings)).toEqual([200, 50, -80]);
	});
});
