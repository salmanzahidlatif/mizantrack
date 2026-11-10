import "fake-indexeddb/auto";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { SalaryProgressionChart } from "@/components/charts/SalaryProgressionChart";

import type {
	SalaryHike,
	SalaryProgressionAnalytics,
	SalaryProgressionPoint,
} from "@/lib/analytics/salaryProgression";
import type { ComponentProps, ReactNode } from "react";

vi.mock("recharts", () => ({
	ResponsiveContainer: ({ children }: { children?: ReactNode }) => (
		<div data-testid="responsive-container">{children}</div>
	),
	AreaChart: ({ data, children }: { data?: unknown; children?: ReactNode }) => (
		<div data-testid="area-chart" data-chart={JSON.stringify(data ?? null)}>
			{children}
		</div>
	),
	Area: () => <div data-testid="area" />,
	XAxis: () => <div data-testid="x-axis" />,
	YAxis: () => <div data-testid="y-axis" />,
	CartesianGrid: () => <div data-testid="cartesian-grid" />,
	Tooltip: () => <div data-testid="tooltip" />,
	ReferenceDot: ({ x, y }: { x?: unknown; y?: unknown }) => (
		<div data-testid="reference-dot" data-x={String(x)} data-y={String(y)} />
	),
}));

function buildPoint(overrides: Partial<SalaryProgressionPoint> = {}): SalaryProgressionPoint {
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
	};
}

function buildAnalytics(
	overrides: Partial<SalaryProgressionAnalytics> = {}
): SalaryProgressionAnalytics {
	const points: SalaryProgressionPoint[] = [
		buildPoint(),
		buildPoint({
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
	];
	const hikes: SalaryHike[] = [
		{
			key: "2025",
			label: "2025",
			bucketKey: "2025",
			atMs: Date.UTC(2025, 0, 1),
			fromAverage: 10000,
			toAverage: 12000,
			share: 0.2,
		},
	];

	return {
		currency: "AED",
		interval: "yearly",
		points,
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
		hikes,
		...overrides,
	};
}

function renderChart(props: Partial<ComponentProps<typeof SalaryProgressionChart>> = {}) {
	const onIntervalChange = vi.fn();
	const onYearsChange = vi.fn();
	const utils = render(
		<SalaryProgressionChart
			data={buildAnalytics()}
			currency="AED"
			interval="yearly"
			onIntervalChange={onIntervalChange}
			years={0}
			onYearsChange={onYearsChange}
			{...props}
		/>
	);

	return { ...utils, onIntervalChange, onYearsChange };
}

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

describe("SalaryProgressionChart", () => {
	it("renders the skeleton while loading", () => {
		const { container } = renderChart({ isLoading: true });

		expect(container.querySelector(".shimmer")).not.toBeNull();
		expect(screen.queryByTestId("area-chart")).toBeNull();
	});

	it("plots the monthly run-rate as the primary series", () => {
		renderChart();

		const chart = screen.getByTestId("area-chart");
		const chartData = JSON.parse(chart.getAttribute("data-chart") ?? "null") as
			| (SalaryProgressionPoint & { solidValue: number | null })[]
			| null;

		expect(chartData).toHaveLength(2);
		expect(chartData?.map((row) => row.label)).toEqual(["2024", "2025"]);
		expect(chartData?.map((row) => row.solidValue)).toEqual([10000, 12000]);
		// Totals stay available for the tooltip.
		expect(chartData?.[1]?.total).toBe(144000);
	});

	it("routes the in-progress bucket to the dashed series and notes it", () => {
		renderChart({
			data: buildAnalytics({
				points: [
					buildPoint(),
					buildPoint({
						key: "2025",
						label: "2025",
						total: 30000,
						average: 10000,
						monthsCovered: 3,
						monthsWithIncome: 3,
						isPartial: true,
					}),
				],
				hikes: [],
			}),
		});

		const chart = screen.getByTestId("area-chart");
		const chartData = JSON.parse(chart.getAttribute("data-chart") ?? "null") as
			| { solidValue: number | null; partialValue: number | null }[]
			| null;

		expect(chartData?.map((row) => row.solidValue)).toEqual([10000, null]);
		expect(chartData?.map((row) => row.partialValue)).toEqual([10000, 10000]);
		expect(screen.getByTestId("salary-partial-note")).toBeInTheDocument();
	});

	it("defaults to run-rate and switches the plotted series to totals", () => {
		renderChart();

		const runRate = screen.getByRole("button", { name: "Run-rate" });
		const total = screen.getByRole("button", { name: "Total" });
		expect(runRate).toHaveAttribute("aria-pressed", "true");
		expect(total).toHaveAttribute("aria-pressed", "false");

		fireEvent.click(total);

		const chartData = JSON.parse(
			screen.getByTestId("area-chart").getAttribute("data-chart") ?? "null"
		) as { solidValue: number | null }[] | null;
		expect(chartData?.map((row) => row.solidValue)).toEqual([120000, 144000]);
		expect(total).toHaveAttribute("aria-pressed", "true");
		expect(runRate).toHaveAttribute("aria-pressed", "false");
		// Raise markers follow the plotted metric so they sit on the line.
		expect(screen.getByTestId("reference-dot")).toHaveAttribute("data-y", "144000");
	});

	it("keeps the partial bucket dashed and warns its total is incomplete in totals mode", () => {
		renderChart({
			data: buildAnalytics({
				points: [
					buildPoint(),
					buildPoint({
						key: "2025",
						label: "2025",
						total: 30000,
						average: 10000,
						monthsCovered: 3,
						monthsWithIncome: 3,
						isPartial: true,
					}),
				],
				hikes: [],
			}),
		});

		fireEvent.click(screen.getByRole("button", { name: "Total" }));

		const chartData = JSON.parse(
			screen.getByTestId("area-chart").getAttribute("data-chart") ?? "null"
		) as { solidValue: number | null; partialValue: number | null }[] | null;
		expect(chartData?.map((row) => row.solidValue)).toEqual([120000, null]);
		expect(chartData?.map((row) => row.partialValue)).toEqual([120000, 30000]);
		expect(screen.getByTestId("salary-partial-note")).toHaveTextContent("still accumulating");
	});

	it("does not draw the current period as a drop to zero before payday", () => {
		renderChart({
			data: buildAnalytics({
				points: [
					buildPoint(),
					buildPoint({
						key: "2025",
						label: "2025",
						total: 0,
						average: 0,
						monthsCovered: 0,
						monthsWithIncome: 0,
						transactionCount: 0,
						isPartial: true,
					}),
				],
				hikes: [],
			}),
		});

		const chartData = JSON.parse(
			screen.getByTestId("area-chart").getAttribute("data-chart") ?? "null"
		) as { solidValue: number | null; partialValue: number | null }[] | null;
		expect(chartData?.map((row) => row.solidValue)).toEqual([10000, null]);
		expect(chartData?.map((row) => row.partialValue)).toEqual([null, null]);
		expect(screen.queryByTestId("salary-partial-note")).toBeNull();
	});

	it("explains when payments were counted in the month they were for", () => {
		renderChart({ data: buildAnalytics({ reattributedPaymentCount: 3 }) });

		expect(screen.getByTestId("salary-reattributed-note")).toHaveTextContent(
			"3 payments credited early or late"
		);
	});

	it("hides the reattribution note when nothing was moved", () => {
		renderChart();

		expect(screen.queryByTestId("salary-reattributed-note")).toBeNull();
	});

	it("names the detected salary categories when labels are supplied", () => {
		renderChart({
			data: buildAnalytics({ usedCategoryIds: ["cat-salary", "cat-bonus"] }),
			categoryLabels: { "cat-salary": "Salary", "cat-bonus": "Bonus" },
		});

		expect(screen.getByTestId("salary-detected-categories")).toHaveTextContent(
			"Based on: Salary, Bonus"
		);
	});

	it("falls back to the detected category count when labels are missing", () => {
		renderChart({ data: buildAnalytics({ usedCategoryIds: ["cat-salary", "cat-bonus"] }) });

		expect(screen.getByTestId("salary-detected-categories")).toHaveTextContent(
			"Based on 2 salary categories"
		);
	});

	it("hides the detected categories note when all income was used", () => {
		renderChart({
			data: buildAnalytics({ usedCategoryIds: [], usedFallbackAllIncome: true }),
		});

		expect(screen.queryByTestId("salary-detected-categories")).toBeNull();
		expect(screen.getByTestId("salary-fallback-note")).toBeInTheDocument();
	});

	it("shows the raise story for a 10,000 to 12,000 run-rate", () => {
		renderChart();

		expect(screen.getByTestId("salary-overall-growth")).toHaveTextContent("+20.0%");
		expect(screen.getByTestId("salary-latest-average")).toHaveTextContent("12,000.00");

		expect(screen.getAllByTestId("reference-dot")).toHaveLength(1);

		const hikeRows = screen.getAllByTestId("salary-hike-row");
		expect(hikeRows).toHaveLength(1);
		expect(hikeRows[0]).toHaveAttribute("data-share", "0.2");
		expect(within(hikeRows[0]!).getByText("+20.0%")).toBeInTheDocument();
	});

	it("renders an em dash instead of NaN when growth and CAGR are null", () => {
		const { container } = renderChart({
			data: buildAnalytics({ overallGrowthShare: null, cagr: null }),
		});

		expect(screen.getByTestId("salary-overall-growth")).toHaveTextContent("—");
		expect(screen.getByTestId("salary-cagr")).toHaveTextContent("—");
		expect(container.textContent).not.toContain("NaN");
		expect(container.textContent).not.toContain("Infinity");
	});

	it("shows the fallback note only when all income was used", () => {
		const { rerender, onIntervalChange, onYearsChange } = renderChart({
			data: buildAnalytics({ usedFallbackAllIncome: true }),
		});

		expect(screen.getByTestId("salary-fallback-note")).toBeInTheDocument();

		rerender(
			<SalaryProgressionChart
				data={buildAnalytics({ usedFallbackAllIncome: false })}
				currency="AED"
				interval="yearly"
				onIntervalChange={onIntervalChange}
				years={0}
				onYearsChange={onYearsChange}
			/>
		);

		expect(screen.queryByTestId("salary-fallback-note")).toBeNull();
	});

	it("reports interval changes", async () => {
		const { onIntervalChange } = renderChart();

		fireEvent.click(screen.getByRole("combobox", { name: "Salary interval" }));
		fireEvent.click(await screen.findByRole("option", { name: "Monthly" }));

		await waitFor(() => {
			expect(onIntervalChange).toHaveBeenCalledWith("monthly");
		});
	});

	it("reports window changes as a number", async () => {
		const { onYearsChange } = renderChart();

		fireEvent.click(screen.getByRole("combobox", { name: "Salary window" }));
		fireEvent.click(await screen.findByRole("option", { name: "Last 5 years" }));

		await waitFor(() => {
			expect(onYearsChange).toHaveBeenCalledWith(5);
		});
	});

	it("renders the empty state when there are no points", () => {
		renderChart({ data: buildAnalytics({ points: [], hikes: [] }) });

		expect(screen.getByText("No salary history yet")).toBeInTheDocument();
		expect(screen.queryByTestId("area-chart")).toBeNull();
	});

	it("renders the empty state when every point is zero", () => {
		renderChart({
			data: buildAnalytics({
				points: [
					buildPoint({ total: 0, average: 0, monthsWithIncome: 0, transactionCount: 0 }),
					buildPoint({
						key: "2025",
						label: "2025",
						total: 0,
						average: 0,
						monthsWithIncome: 0,
						transactionCount: 0,
					}),
				],
				hikes: [],
			}),
		});

		expect(screen.getByText("No salary history yet")).toBeInTheDocument();
		expect(screen.queryByTestId("area-chart")).toBeNull();
	});

	it("skips markers for hikes whose point is missing", () => {
		renderChart({
			data: buildAnalytics({
				hikes: [
					{
						key: "2099",
						label: "2099",
						bucketKey: "2099",
						atMs: Date.UTC(2099, 0, 1),
						fromAverage: 10000,
						toAverage: 12000,
						share: 0.2,
					},
				],
			}),
		});

		expect(screen.queryAllByTestId("reference-dot")).toHaveLength(0);
		expect(screen.getAllByTestId("salary-hike-row")).toHaveLength(1);
	});

	it("places a monthly raise marker on the bucket that contains it", () => {
		renderChart({
			data: buildAnalytics({
				hikes: [
					{
						key: "2025-04",
						label: "Apr 25",
						bucketKey: "2025",
						atMs: Date.UTC(2025, 3, 1),
						fromAverage: 10000,
						toAverage: 12000,
						share: 0.2,
					},
				],
			}),
		});

		expect(screen.getByTestId("reference-dot")).toHaveAttribute("data-x", "2025");
		expect(screen.getByTestId("salary-hike-row")).toHaveTextContent("Apr 25");
	});
});
