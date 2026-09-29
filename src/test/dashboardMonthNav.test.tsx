import "fake-indexeddb/auto";

import { fireEvent, render, screen } from "@testing-library/react";
import { format, startOfMonth, subMonths } from "date-fns";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardPageClient } from "@/components/dashboard/DashboardPageClient";

import type { DashboardStats } from "@/types";
import type { ReactNode } from "react";

const USER_ID = "dashboard-month-nav-user";

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
		Bar: () => <div data-testid="bar" />,
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

vi.mock("@/components/dashboard/BalanceCards", () => ({
	BalanceCards: () => <div data-testid="balance-cards" />,
}));

vi.mock("@/components/dashboard/RecentTransactions", () => ({
	RecentTransactions: () => <div data-testid="recent-transactions" />,
}));

vi.mock("@/hooks/useCategories", () => ({
	useCategories: () => [],
}));

vi.mock("@/hooks/useDashboardStats", () => ({
	useDashboardStats: vi.fn(),
}));

vi.mock("@/hooks/useDbConfig", () => ({
	useDbConfig: () => ({ currency: "AED" }),
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

vi.mock("@/hooks/useMonthlySummary", () => ({
	useMonthlySummary: () => undefined,
}));

vi.mock("@/lib/analytics/scheduleRecompute", () => ({
	recomputeAnalyticsNow: vi.fn(),
}));

vi.mock("@/lib/db/local", () => ({
	db: {
		dashboardStats: {
			get: vi.fn().mockResolvedValue({ id: "dashboard-month-nav-user" }),
		},
	},
}));

vi.mock("@/store/filter-store", () => ({
	useFilterStore: () => ({ activeCurrency: "AED" }),
}));

async function renderDashboard() {
	render(<DashboardPageClient userId={USER_ID} />);
	await screen.findByText("Your financial overview");
}

function buildStats(): DashboardStats {
	const currentMonth = startOfMonth(new Date());
	const previousMonth = subMonths(currentMonth, 1);
	const trend = Array.from({ length: 6 }, (_, index) => {
		const month = subMonths(currentMonth, 5 - index);
		const label = format(month, "MMM yy");

		if (label === format(currentMonth, "MMM yy")) {
			return { month: label, income: 1000, expense: 400 };
		}

		if (label === format(previousMonth, "MMM yy")) {
			return { month: label, income: 2000, expense: 500 };
		}

		return { month: label, income: 0, expense: 0 };
	});

	return {
		id: USER_ID,
		updatedAt: Date.now(),
		balances: {},
		perCurrency: {
			AED: {
				monthIncome: 1000,
				monthExpense: 400,
				trend,
				categoryBreakdownByMonth: {
					[format(currentMonth, "yyyy-MM")]: [{ name: "Groceries", value: 300 }],
					[format(previousMonth, "yyyy-MM")]: [{ name: "Rent", value: 500 }],
				},
			},
		},
		recent: [],
	} as DashboardStats;
}

function readChartData(testId: string) {
	return JSON.parse(screen.getByTestId(testId).getAttribute("data-chart") ?? "null") as Array<{
		month?: string;
		name?: string;
		income?: number;
		expense?: number;
		value?: number;
	}>;
}

describe("dashboard month navigation", () => {
	beforeEach(async () => {
		const { useDashboardStats } = await import("@/hooks/useDashboardStats");
		vi.mocked(useDashboardStats).mockReturnValue(buildStats());

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

	it("updates cards, trend chart, and category chart when the month changes", async () => {
		await renderDashboard();

		const currentMonth = startOfMonth(new Date());
		const previousMonth = subMonths(currentMonth, 1);
		const previousLabel = format(previousMonth, "MMMM yyyy");
		const previousShortLabel = format(previousMonth, "MMM yy");

		expect(
			screen.getByLabelText(`Income for ${format(currentMonth, "MMMM yyyy")}`)
		).toHaveTextContent("1,000.00");
		expect(readChartData("pie-chart")).toEqual([{ name: "Groceries", value: 300 }]);

		fireEvent.click(screen.getByRole("button", { name: "Previous month" }));

		expect(screen.getByRole("heading", { name: previousLabel })).toBeInTheDocument();
		expect(screen.getByLabelText(`Income for ${previousLabel}`)).toHaveTextContent("2,000.00");
		expect(screen.getByLabelText(`Expenses for ${previousLabel}`)).toHaveTextContent("500.00");
		expect(readChartData("bar-chart").at(-1)).toMatchObject({
			month: previousShortLabel,
			income: 2000,
			expense: 500,
		});
		expect(readChartData("pie-chart")).toEqual([{ name: "Rent", value: 500 }]);
	});

	it("disables next month at the current month", async () => {
		await renderDashboard();

		const nextButton = screen.getByRole("button", { name: "Next month" });
		expect(nextButton).toBeDisabled();

		fireEvent.click(screen.getByRole("button", { name: "Previous month" }));
		expect(nextButton).not.toBeDisabled();
	});

	it("marks the month swipe area so tab swipe navigation ignores it", async () => {
		await renderDashboard();

		expect(screen.getByLabelText("Swipe dashboard month summary")).toHaveAttribute(
			"data-swipe-navigation-ignore"
		);
	});
});
