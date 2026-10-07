import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountList } from "@/components/accounts/AccountList";
import { AccountsPageClient } from "@/components/accounts/AccountsPageClient";
import { DashboardPageClient } from "@/components/dashboard/DashboardPageClient";
import { computeAccountBalances } from "@/lib/analytics/balanceMath";
import {
	aggregateAccountsAnalytics,
	type AccountsAnalytics,
	type PeriodAnalytics,
} from "@/lib/analytics/periodAnalytics";

import type { Account, Transaction } from "@/types";
import type { ReactNode } from "react";

const USER_ID = "currency-display-scope-user";
const NOW = new Date("2026-09-30T09:52:55.968+04:00");
const GST_OFFSET_MINUTES = 4 * 60;

const mocks = vi.hoisted(() => ({
	activeCurrency: "AED",
	showArchivedAccounts: false,
	push: vi.fn(),
	setAccountId: vi.fn(),
	setShowArchivedAccounts: vi.fn(),
	useAccounts: vi.fn(),
	useAccountsAnalytics: vi.fn(),
	usePeriodAnalytics: vi.fn(),
}));

vi.mock("next/dynamic", () => ({
	default: () => () => null,
}));

vi.mock("next/link", () => ({
	default: ({ href, children, ...props }: { href: string; children?: ReactNode }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({ push: mocks.push }),
}));

vi.mock("@/components/accounts/AccountDrawer", () => ({
	AccountDrawer: () => null,
}));

vi.mock("@/hooks/useAccounts", () => ({
	useAccounts: mocks.useAccounts,
}));

vi.mock("@/hooks/useAccountsAnalytics", () => ({
	useAccountsAnalytics: mocks.useAccountsAnalytics,
}));

vi.mock("@/hooks/useAnalyticsMonthSummaries", () => ({
	useAnalyticsMonthSummaries: () => undefined,
}));

vi.mock("@/hooks/useDbConfig", () => ({
	useDbConfig: () => ({
		currency: "AED",
		fiscalYearStartMonth: 7,
		enabledCurrencies: ["AED", "PKR"],
	}),
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
	useFilterStore: () => ({
		activeCurrency: mocks.activeCurrency,
		showArchivedAccounts: mocks.showArchivedAccounts,
		setAccountId: mocks.setAccountId,
		setShowArchivedAccounts: mocks.setShowArchivedAccounts,
	}),
}));

vi.mock("@/store/ui-store", () => ({
	useUIStore: (
		selector: (state: { openAddAccount: () => void; openEditAccount: () => void }) => unknown
	) =>
		selector({
			openAddAccount: vi.fn(),
			openEditAccount: vi.fn(),
		}),
}));

function account(overrides: Partial<Account>): Account {
	return {
		id: overrides.id ?? "account",
		userId: USER_ID,
		title: overrides.title ?? "Account",
		openingBalance: overrides.openingBalance ?? 0,
		currency: overrides.currency ?? "AED",
		isArchived: overrides.isArchived ?? false,
		updatedAt: NOW.getTime(),
		...overrides,
	};
}

const accounts: Account[] = [
	account({
		id: "aed-wallet",
		title: "AED Wallet",
		openingBalance: 1000,
		currency: "AED",
	}),
	account({
		id: "enbd-share",
		title: "ENBD - Share",
		openingBalance: 500,
		currency: " aed ",
	}),
	account({
		id: "pkr-wallet",
		title: "PKR Wallet",
		openingBalance: 200000,
		currency: "PKR",
	}),
];

const transactions: Transaction[] = [
	{
		id: "aed-income",
		userId: USER_ID,
		type: "Income",
		date: new Date("2026-09-05T12:00:00.000+04:00").getTime(),
		amount: 250,
		accountId: "aed-wallet",
		updatedAt: NOW.getTime(),
	},
	{
		id: "pkr-expense",
		userId: USER_ID,
		type: "Expense",
		date: new Date("2026-09-06T12:00:00.000+04:00").getTime(),
		amount: 7500,
		accountId: "pkr-wallet",
		updatedAt: NOW.getTime(),
	},
	{
		id: "pkr-to-aed-transfer",
		userId: USER_ID,
		type: "Transfer",
		date: new Date("2026-09-07T12:00:00.000+04:00").getTime(),
		amount: 300,
		accountId: "pkr-wallet",
		toAccountId: "aed-wallet",
		updatedAt: NOW.getTime(),
	},
];

function analyticsFor(currency: string): AccountsAnalytics {
	return aggregateAccountsAnalytics(USER_ID, accounts, transactions, {
		currency,
		enabledCurrencies: ["AED", "PKR"],
		asOf: NOW,
		timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		period: {
			interval: "monthly",
			anchorDate: NOW,
			now: NOW,
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		},
	});
}

function periodAnalytics(currency: string): PeriodAnalytics {
	return {
		userId: USER_ID,
		currency,
		period: {
			interval: "monthly",
			key: "2026-09",
			label: "Sep 2026",
			from: new Date("2026-08-31T20:00:00.000Z"),
			to: new Date("2026-09-30T19:59:59.999Z"),
			fromMs: new Date("2026-08-31T20:00:00.000Z").getTime(),
			toMs: new Date("2026-09-30T19:59:59.999Z").getTime(),
		},
		income: currency === "AED" ? 250 : 0,
		expense: currency === "PKR" ? 7500 : 0,
		net: currency === "AED" ? 250 : -7500,
		incomeBreakdown: [],
		expenseBreakdown: [],
		transactionCount: 1,
	};
}

function renderDashboardWithCurrency(currency: string) {
	mocks.activeCurrency = currency;
	mocks.useAccountsAnalytics.mockImplementation((_userId, query) =>
		query?.currency ? analyticsFor(query.currency) : undefined
	);
	mocks.usePeriodAnalytics.mockImplementation((_userId, query) =>
		query?.currency ? periodAnalytics(query.currency) : undefined
	);

	render(<DashboardPageClient userId={USER_ID} />);
}

function renderAccountsWithCurrency(currency: string) {
	mocks.activeCurrency = currency;
	mocks.useAccounts.mockReturnValue(accounts);
	mocks.useAccountsAnalytics.mockImplementation((_userId, query) =>
		query?.currency ? analyticsFor(query.currency) : undefined
	);

	render(<AccountsPageClient userId={USER_ID} />);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	mocks.activeCurrency = "AED";
	mocks.showArchivedAccounts = false;
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("currency-scoped account display", () => {
	it("shows only AED dashboard tiles when AED is active, including untrimmed AED accounts", () => {
		renderDashboardWithCurrency("AED");

		expect(screen.getByText("AED Wallet")).toBeInTheDocument();
		expect(screen.getByText("ENBD - Share")).toBeInTheDocument();
		expect(screen.queryByText("PKR Wallet")).not.toBeInTheDocument();
		expect(screen.getByText((text) => text.includes("2,050.00"))).toBeInTheDocument();
		expect(screen.queryByText((text) => text.includes("194,250.00"))).not.toBeInTheDocument();
	});

	it("falls back to the default currency when the active currency is empty", () => {
		renderDashboardWithCurrency("");

		expect(screen.getByText("AED Wallet")).toBeInTheDocument();
		expect(screen.getByText("ENBD - Share")).toBeInTheDocument();
		expect(screen.queryByText("PKR Wallet")).not.toBeInTheDocument();
		expect(screen.getByText((text) => text.includes("2,050.00"))).toBeInTheDocument();
	});

	it("shows only PKR dashboard tiles when PKR is active", () => {
		renderDashboardWithCurrency("PKR");

		expect(screen.getByText("PKR Wallet")).toBeInTheDocument();
		expect(screen.queryByText("AED Wallet")).not.toBeInTheDocument();
		expect(screen.queryByText("ENBD - Share")).not.toBeInTheDocument();
		expect(screen.getAllByText("₨ 192,200.00").length).toBeGreaterThan(0);
	});

	it("shows only selected-currency accounts on the accounts screen", () => {
		renderAccountsWithCurrency("AED");

		expect(screen.getByText("AED Wallet")).toBeInTheDocument();
		expect(screen.getByText("ENBD - Share")).toBeInTheDocument();
		expect(screen.queryByText("PKR Wallet")).not.toBeInTheDocument();
		expect(screen.getByRole("region", { name: /accounts summary/i })).toHaveTextContent("2,050.00");

		cleanup();
		renderAccountsWithCurrency("PKR");

		expect(screen.getByText("PKR Wallet")).toBeInTheDocument();
		expect(screen.queryByText("AED Wallet")).not.toBeInTheDocument();
		expect(screen.queryByText("ENBD - Share")).not.toBeInTheDocument();
		expect(screen.getByRole("region", { name: /accounts summary/i })).toHaveTextContent(
			"192,200.00"
		);
	});

	it("never totals AED and PKR balances together", () => {
		const aed = analyticsFor("AED");
		const pkr = analyticsFor("PKR");
		const mixedTotal = aed.allAccounts.reduce((sum, item) => sum + item.balance, 0);

		expect(aed.netWorth).toBe(2050);
		expect(pkr.netWorth).toBe(192200);
		expect(mixedTotal).toBe(194250);
		expect(aed.netWorth).not.toBe(mixedTotal);
		expect(pkr.netWorth).not.toBe(mixedTotal);
	});

	it("renders an account amount with its own currency even while AED is active", () => {
		const pkrAccount = account({
			id: "disabled-pkr",
			title: "Disabled PKR",
			openingBalance: 9876.5,
			currency: "PKR",
		});
		const analytics: AccountsAnalytics = {
			userId: USER_ID,
			currency: "AED",
			asOf: NOW,
			period: periodAnalytics("AED").period,
			netWorth: 0,
			inflow: 0,
			outflow: 0,
			netFlow: 0,
			accounts: [],
			allAccounts: [
				{
					accountId: pkrAccount.id,
					title: pkrAccount.title,
					currency: "PKR",
					isArchived: false,
					accountType: undefined,
					balance: 9876.5,
				},
			],
			unscopedAccounts: [
				{
					accountId: pkrAccount.id,
					title: pkrAccount.title,
					currency: "PKR",
					isArchived: false,
					accountType: undefined,
					balance: 9876.5,
				},
			],
			warnings: [],
		};

		render(
			<AccountList
				accounts={[]}
				unscopedAccounts={[pkrAccount]}
				analytics={analytics}
				showArchived
				sortBy="title-asc"
				userId={USER_ID}
				activeCurrency="AED"
				onSelectAccount={vi.fn()}
			/>
		);

		expect(screen.getByText("Disabled PKR")).toBeInTheDocument();
		expect(screen.getByText("₨ 9,876.50")).toBeInTheDocument();
	});

	it("keeps transfer legs symmetric and conserves money across currencies", () => {
		const { balances } = computeAccountBalances(USER_ID, accounts, transactions, {
			asOfMs: NOW.getTime(),
		});
		const openingTotal = accounts.reduce((sum, item) => sum + item.openingBalance, 0);
		const nonTransferDelta = transactions.reduce((sum, transaction) => {
			if (transaction.type === "Income") return sum + transaction.amount;
			if (transaction.type === "Expense") return sum - transaction.amount;
			return sum;
		}, 0);
		const balanceTotal = [...balances.values()].reduce((sum, balance) => sum + balance, 0);

		expect(balances.get("pkr-wallet")).toBe(192200);
		expect(balances.get("aed-wallet")).toBe(1550);
		expect(balanceTotal).toBe(openingTotal + nonTransferDelta);
	});
});
