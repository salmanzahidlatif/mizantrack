import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardPageClient } from "@/components/dashboard/DashboardPageClient";
import {
	AccountsLoadingSkeleton,
	CategoriesLoadingSkeleton,
	DashboardLoadingSkeleton,
	ReportsLoadingSkeleton,
	SettingsLoadingSkeleton,
	TransactionsLoadingSkeleton,
	ZakatLoadingSkeleton,
} from "@/components/shared/RouteLoadingSkeletons";

import type { AccountsAnalytics, PeriodAnalytics } from "@/lib/analytics/periodAnalytics";
import type { ReactNode } from "react";

const USER_ID = "nav-performance-user";
const NOW = new Date("2026-09-29T12:00:00.000Z");

const mocks = vi.hoisted(() => ({
	useAccountsAnalytics: vi.fn(),
	usePeriodAnalytics: vi.fn(),
}));

vi.mock("next/dynamic", () => ({
	default: (_loader: unknown, options?: { loading?: () => ReactNode }) => () =>
		options?.loading ? <>{options.loading()}</> : null,
}));

vi.mock("next/link", () => ({
	default: ({ href, children, ...props }: { href: string; children?: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

vi.mock("@/hooks/useAccountsAnalytics", () => ({
	useAccountsAnalytics: mocks.useAccountsAnalytics,
}));

vi.mock("@/hooks/useAnalyticsMonthSummaries", () => ({
	useAnalyticsMonthSummaries: () => undefined,
}));

vi.mock("@/hooks/useDbConfig", () => ({
	useDbConfig: () => ({ currency: "AED", fiscalYearStartMonth: 1 }),
}));

vi.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({
		light: vi.fn(),
		selection: vi.fn(),
	}),
}));

vi.mock("@/hooks/usePeriodAnalytics", () => ({
	usePeriodAnalytics: mocks.usePeriodAnalytics,
}));

vi.mock("@/store/filter-store", () => ({
	useFilterStore: () => ({ activeCurrency: "" }),
}));

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
		incomeBreakdown: [],
		expenseBreakdown: [],
		transactionCount: 4,
	};
}

function buildAccountsAnalytics(): AccountsAnalytics {
	return {
		userId: USER_ID,
		currency: "AED",
		asOf: NOW,
		period: buildPeriodAnalytics().period,
		netWorth: 12000,
		inflow: 1000,
		outflow: 600,
		netFlow: 400,
		accounts: [
			{
				accountId: "zero",
				title: "Zero Balance",
				currency: "AED",
				isArchived: false,
				accountType: undefined,
				balance: 0,
			},
			{
				accountId: "tie-first",
				title: "Tie First",
				currency: "AED",
				isArchived: false,
				accountType: undefined,
				balance: 5000,
			},
			{
				accountId: "archived-large",
				title: "Archived Large",
				currency: "AED",
				isArchived: true,
				accountType: undefined,
				balance: 500000,
			},
			{
				accountId: "largest",
				title: "Largest",
				currency: "AED",
				isArchived: false,
				accountType: undefined,
				balance: 8000,
			},
			{
				accountId: "negative",
				title: "Credit Card",
				currency: "AED",
				isArchived: false,
				accountType: "liability",
				balance: -35799,
			},
			{
				accountId: "tie-second",
				title: "Tie Second",
				currency: "AED",
				isArchived: false,
				accountType: undefined,
				balance: 5000,
			},
		],
		allAccounts: [
			{
				accountId: "zero",
				title: "Zero Balance",
				currency: "AED",
				isArchived: false,
				accountType: undefined,
				balance: 0,
			},
			{
				accountId: "tie-first",
				title: "Tie First",
				currency: "AED",
				isArchived: false,
				accountType: undefined,
				balance: 5000,
			},
			{
				accountId: "archived-large",
				title: "Archived Large",
				currency: "AED",
				isArchived: true,
				accountType: undefined,
				balance: 500000,
			},
			{
				accountId: "largest",
				title: "Largest",
				currency: "AED",
				isArchived: false,
				accountType: undefined,
				balance: 8000,
			},
			{
				accountId: "negative",
				title: "Credit Card",
				currency: "AED",
				isArchived: false,
				accountType: "liability",
				balance: -35799,
			},
			{
				accountId: "tie-second",
				title: "Tie Second",
				currency: "AED",
				isArchived: false,
				accountType: undefined,
				balance: 5000,
			},
		],
		unscopedAccounts: [],
		warnings: [],
	};
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	mocks.useAccountsAnalytics.mockReturnValue(undefined);
	mocks.usePeriodAnalytics.mockReturnValue(undefined);
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
	cleanup();
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("route loading shells", () => {
	const routes = [
		["Dashboard", DashboardLoadingSkeleton, "dashboard-route-loading"],
		["Transactions", TransactionsLoadingSkeleton, "transactions-route-loading"],
		["Accounts", AccountsLoadingSkeleton, "accounts-route-loading"],
		["Categories", CategoriesLoadingSkeleton, "categories-route-loading"],
		["Reports", ReportsLoadingSkeleton, "reports-route-loading"],
		["Zakat", ZakatLoadingSkeleton, "zakat-route-loading"],
		["Settings", SettingsLoadingSkeleton, "settings-route-loading"],
	] as const;

	it.each(routes)("renders the %s shell and skeleton immediately", (name, Component, testId) => {
		const { container } = render(<Component />);

		expect(screen.getByTestId(testId)).toHaveAttribute("aria-busy", "true");
		expect(screen.getByRole("status")).toHaveTextContent(`Loading ${name}`);
		expect(container.querySelector(".shimmer")).not.toBeNull();
	});
});

describe("dashboard pending analytics shell", () => {
	it("keeps the dashboard controls visible and reserves the account tile layout", () => {
		const { container } = render(<DashboardPageClient userId={USER_ID} />);

		expect(screen.getByText(/monthly view/i)).toBeInTheDocument();
		expect(screen.getByLabelText("Select dashboard month")).toHaveAttribute(
			"data-swipe-navigation-ignore"
		);
		const skeleton = screen.getByTestId("what-you-have-skeleton");
		const reservedTiles = Array.from(skeleton.querySelectorAll("div")).filter((element) =>
			element.className.includes("min-h-[72px]")
		);

		expect(skeleton).toHaveAttribute("aria-busy", "true");
		expect(reservedTiles).toHaveLength(6);
		expect(container.querySelector(".shimmer")).not.toBeNull();
	});
});

describe("dashboard account tile ordering", () => {
	it("sorts non-archived account tiles by balance descending with stable ties and zero last", () => {
		mocks.useAccountsAnalytics.mockReturnValue(buildAccountsAnalytics());
		mocks.usePeriodAnalytics.mockReturnValue(buildPeriodAnalytics());

		render(<DashboardPageClient userId={USER_ID} />);

		const accountIds = screen
			.getAllByTestId("dashboard-account-tile")
			.map((element) => element.getAttribute("data-account-id"));

		expect(accountIds).toEqual(["largest", "tie-first", "tie-second", "negative", "zero"]);
		expect(accountIds).not.toContain("archived-large");
		for (const tile of screen.getAllByTestId("dashboard-account-tile")) {
			expect(tile.className).toContain("min-h-[72px]");
		}
		expect(screen.getByRole("button", { name: /add account/i }).className).toContain(
			"min-h-[72px]"
		);
	});
});
