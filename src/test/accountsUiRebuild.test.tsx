import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountList } from "@/components/accounts/AccountList";
import { AccountsPageClient } from "@/components/accounts/AccountsPageClient";
import { useFilterStore } from "@/store/filter-store";

import type { AccountsAnalytics } from "@/lib/analytics/periodAnalytics";
import type { Account, DbConfig } from "@/types";

const mocks = vi.hoisted(() => ({
	push: vi.fn(),
	useAccounts: vi.fn(),
	useAccountsAnalytics: vi.fn(),
	useDbConfig: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => ({
		push: mocks.push,
	}),
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

vi.mock("@/hooks/useDbConfig", () => ({
	useDbConfig: mocks.useDbConfig,
}));

const userId = "accounts-ui-user";

const activeAccount: Account = {
	id: "active-account",
	userId,
	title: "FAB Current",
	openingBalance: 1000,
	currency: "AED",
	isArchived: false,
	updatedAt: 10,
};

const archivedAccount: Account = {
	id: "archived-account",
	userId,
	title: "Old Wallet",
	openingBalance: 0,
	currency: "AED",
	isArchived: true,
	updatedAt: 5,
};

const negativeAccount: Account = {
	id: "negative-account",
	userId,
	title: "Credit Card",
	openingBalance: -1497.1,
	currency: "AED",
	isArchived: false,
	accountType: "liability",
	updatedAt: 8,
};

const config: DbConfig = {
	id: userId,
	firebaseConfig: "{}",
	enabled: false,
	currency: "AED",
	fiscalYearStartMonth: 7,
	enabledCurrencies: ["AED"],
};

const analytics: AccountsAnalytics = {
	userId,
	currency: "AED",
	asOf: new Date("2026-09-29T12:00:00.000Z"),
	period: {
		interval: "all-time",
		key: "all-time",
		label: "All Time",
		from: new Date(0),
		to: new Date(8640000000000000),
		fromMs: 0,
		toMs: 8640000000000000,
	},
	netWorth: 97371.12,
	inflow: 2434770.56,
	outflow: 2133900.5,
	netFlow: 300870.06,
	accounts: [
		{
			accountId: activeAccount.id,
			title: activeAccount.title,
			currency: activeAccount.currency,
			isArchived: activeAccount.isArchived,
			accountType: activeAccount.accountType,
			balance: 98768.22,
		},
		{
			accountId: negativeAccount.id,
			title: negativeAccount.title,
			currency: negativeAccount.currency,
			isArchived: negativeAccount.isArchived,
			accountType: negativeAccount.accountType,
			balance: -1497.1,
		},
		{
			accountId: archivedAccount.id,
			title: archivedAccount.title,
			currency: archivedAccount.currency,
			isArchived: archivedAccount.isArchived,
			accountType: archivedAccount.accountType,
			balance: 0,
		},
	],
	warnings: [],
};

beforeEach(() => {
	useFilterStore.setState({
		activeCurrency: "AED",
		showArchivedAccounts: true,
		accountId: null,
	});
	mocks.useDbConfig.mockReturnValue(config);
	mocks.useAccountsAnalytics.mockReturnValue(analytics);
	mocks.useAccounts.mockImplementation((_id: string, filters?: { showArchived?: boolean }) =>
		filters?.showArchived ? [activeAccount, archivedAccount, negativeAccount] : [activeAccount]
	);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("accounts UI rebuild", () => {
	it("shows net worth, inflow, and outflow from the accounts analytics hook", () => {
		render(<AccountsPageClient userId={userId} />);

		expect(mocks.useAccountsAnalytics).toHaveBeenCalledWith(
			userId,
			expect.objectContaining({
				currency: "AED",
				period: { interval: "all-time" },
			})
		);

		const summary = screen.getByRole("region", { name: /accounts summary/i });

		expect(within(summary).getByText("Net worth (as of today)")).toBeInTheDocument();
		expect(summary).toHaveTextContent("97,371.12");
		expect(within(summary).getByText(/inflow/i)).toBeInTheDocument();
		expect(summary).toHaveTextContent("2,434,770.56");
		expect(within(summary).getByText(/outflow/i)).toBeInTheDocument();
		expect(summary).toHaveTextContent("2,133,900.50");
	});

	it("falls back to the default database currency when the active currency is empty", () => {
		useFilterStore.setState({ activeCurrency: "" });

		render(<AccountsPageClient userId={userId} />);

		expect(mocks.useAccountsAnalytics).toHaveBeenCalledWith(
			userId,
			expect.objectContaining({ currency: "AED" })
		);
		expect(screen.getByRole("region", { name: /accounts summary/i })).toHaveTextContent("AED");
	});

	it("renders archived accounts with an inactive text label", () => {
		render(
			<AccountList
				accounts={[activeAccount, archivedAccount]}
				analytics={analytics}
				showArchived
				sortBy="title-asc"
				userId={userId}
				onSelectAccount={vi.fn()}
			/>
		);

		expect(screen.getByText("(Inactive)")).toBeInTheDocument();
	});

	it("renders negative balances with the negative currency treatment", () => {
		render(
			<AccountList
				accounts={[negativeAccount]}
				analytics={analytics}
				showArchived
				sortBy="balance-desc"
				userId={userId}
				onSelectAccount={vi.fn()}
			/>
		);

		const negativeAmount = screen.getByText("-1,497.10").closest("[data-currency-amount]");

		expect(negativeAmount).toHaveClass("text-red-600");
	});
});
