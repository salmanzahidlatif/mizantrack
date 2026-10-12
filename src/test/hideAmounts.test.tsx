import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountsPageClient } from "@/components/accounts/AccountsPageClient";
import { DashboardPageClient } from "@/components/dashboard/DashboardPageClient";
import { AMOUNT_MASK, CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { useSyncHideAmounts } from "@/hooks/useHideAmounts";
import { db } from "@/lib/db/local";
import { usePrivacyStore } from "@/store/privacy-store";

import type { AccountsAnalytics, PeriodAnalytics } from "@/lib/analytics/periodAnalytics";
import type { Account, DbConfig } from "@/types";
import type { ReactNode } from "react";

const USER_ID = "hide-amounts-user";
const NOW = new Date("2026-09-29T12:00:00.000Z");

const mocks = vi.hoisted(() => ({
	push: vi.fn(),
	useAccounts: vi.fn(),
	useAccountsAnalytics: vi.fn(),
	usePeriodAnalytics: vi.fn(),
	setAccountId: vi.fn(),
	setShowArchivedAccounts: vi.fn(),
	setIncludeFutureDatedBalances: vi.fn(),
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

vi.mock("@/hooks/useBudgets", () => ({
	useBudgets: () => undefined,
}));

vi.mock("@/hooks/useDbConfig", () => ({
	useDbConfig: () => ({
		id: USER_ID,
		firebaseConfig: "{}",
		enabled: false,
		currency: "AED",
		fiscalYearStartMonth: 7,
		enabledCurrencies: ["AED"],
	}),
}));

vi.mock("@/hooks/usePeriodAnalytics", () => ({
	usePeriodAnalytics: mocks.usePeriodAnalytics,
}));

vi.mock("@/store/filter-store", () => ({
	useFilterStore: () => ({
		activeCurrency: "AED",
		showArchivedAccounts: false,
		includeFutureDatedBalances: true,
		setAccountId: mocks.setAccountId,
		setShowArchivedAccounts: mocks.setShowArchivedAccounts,
		setIncludeFutureDatedBalances: mocks.setIncludeFutureDatedBalances,
	}),
}));

vi.mock("@/store/ui-store", () => ({
	useUIStore: (selector: (state: { openAddAccount: () => void }) => unknown) =>
		selector({ openAddAccount: vi.fn() }),
}));

const wallet: Account = {
	id: "aed-wallet",
	userId: USER_ID,
	title: "AED Wallet",
	openingBalance: 1234.5,
	currency: "AED",
	isArchived: false,
	updatedAt: NOW.getTime(),
};

const accountsAnalytics: AccountsAnalytics = {
	userId: USER_ID,
	currency: "AED",
	asOf: NOW,
	period: {
		interval: "all-time",
		key: "all-time",
		label: "All Time",
		from: new Date(0),
		to: new Date(8640000000000000),
		fromMs: 0,
		toMs: 8640000000000000,
	},
	netWorth: 1234.5,
	inflow: 0,
	outflow: 0,
	netFlow: 0,
	accounts: [
		{
			accountId: wallet.id,
			title: wallet.title,
			currency: wallet.currency,
			isArchived: false,
			accountType: undefined,
			balance: 1234.5,
		},
	],
	allAccounts: [
		{
			accountId: wallet.id,
			title: wallet.title,
			currency: wallet.currency,
			isArchived: false,
			accountType: undefined,
			balance: 1234.5,
		},
	],
	unscopedAccounts: [],
	warnings: [],
};

const periodAnalytics: PeriodAnalytics = {
	userId: USER_ID,
	currency: "AED",
	period: {
		interval: "monthly",
		key: "2026-09",
		label: "Sep 2026",
		from: new Date("2026-08-31T20:00:00.000Z"),
		to: new Date("2026-09-30T19:59:59.999Z"),
		fromMs: new Date("2026-08-31T20:00:00.000Z").getTime(),
		toMs: new Date("2026-09-30T19:59:59.999Z").getTime(),
	},
	income: 0,
	expense: 0,
	net: 0,
	incomeBreakdown: [],
	expenseBreakdown: [],
	transactionCount: 0,
};

function amountTexts() {
	return Array.from(document.querySelectorAll("[data-currency-amount]")).map(
		(node) => node.textContent ?? ""
	);
}

function SyncProbe({ config }: { config: DbConfig | undefined }) {
	useSyncHideAmounts(config);
	return null;
}

beforeEach(async () => {
	if (!db.isOpen()) await db.open();
	await db.dbConfig.clear();
	localStorage.clear();
	usePrivacyStore.setState({ hideAmounts: false });
	mocks.useAccounts.mockReturnValue([wallet]);
	mocks.useAccountsAnalytics.mockReturnValue(accountsAnalytics);
	mocks.usePeriodAnalytics.mockReturnValue(periodAnalytics);
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("CurrencyAmount masking", () => {
	it("renders the real value when hiding is off", () => {
		render(<CurrencyAmount amount={1234.5} currency="PKR" />);

		const node = document.querySelector("[data-currency-amount]");
		expect(node?.textContent).toContain("1,234.50");
		expect(node?.textContent).not.toContain(AMOUNT_MASK);
		expect(node?.getAttribute("aria-label")).toBeNull();
	});

	it("masks the digits but keeps the currency symbol when hiding is on", () => {
		usePrivacyStore.setState({ hideAmounts: true });
		render(<CurrencyAmount amount={1234.5} currency="PKR" />);

		const node = document.querySelector("[data-currency-amount]");
		expect(node?.textContent).toContain(AMOUNT_MASK);
		expect(node?.textContent).not.toContain("1,234.50");
		expect(node?.textContent).toContain("₨");
		expect(node?.getAttribute("aria-label")).toBe("Amount hidden");
		expect(node?.getAttribute("data-amount-hidden")).toBe("true");
		expect(screen.getByText("Amount hidden")).toBeInTheDocument();
	});

	it("never leaks the sign of a masked negative amount", () => {
		usePrivacyStore.setState({ hideAmounts: true });
		render(<CurrencyAmount amount={-980.25} currency="PKR" showNegativeSign colorized />);

		const node = document.querySelector("[data-currency-amount]");
		expect(node?.textContent).toContain(AMOUNT_MASK);
		expect(node?.textContent).not.toContain("980.25");
		expect(node?.textContent).not.toContain("-");
	});
});

describe("hide amounts persistence", () => {
	it("writes the flag to dbConfig and rehydrates it on reload", async () => {
		render(<AccountsPageClient userId={USER_ID} />);

		fireEvent.click(screen.getByTestId("hide-amounts-toggle"));

		await waitFor(async () => {
			expect((await db.dbConfig.get(USER_ID))?.hideAmounts).toBe(true);
		});

		cleanup();
		// Simulate a reload: the store starts fresh and is rehydrated from dbConfig.
		usePrivacyStore.setState({ hideAmounts: false });
		const saved = await db.dbConfig.get(USER_ID);
		render(<SyncProbe config={saved} />);

		await waitFor(() => {
			expect(usePrivacyStore.getState().hideAmounts).toBe(true);
		});
	});

	it("leaves amounts visible when no config row exists yet", () => {
		render(<SyncProbe config={undefined} />);

		expect(usePrivacyStore.getState().hideAmounts).toBe(false);
	});
});

describe("hide amounts toggle", () => {
	it("is keyboard accessible and exposes its pressed state", () => {
		render(<AccountsPageClient userId={USER_ID} />);

		const toggle = screen.getByTestId("hide-amounts-toggle");
		expect(toggle.tagName).toBe("BUTTON");
		expect(toggle).toHaveAttribute("aria-pressed", "false");
		expect(toggle).toHaveAccessibleName("Hide amounts");

		fireEvent.click(toggle);

		expect(toggle).toHaveAttribute("aria-pressed", "true");
		expect(toggle).toHaveAccessibleName("Show amounts");
	});

	it("shares one setting between the dashboard and the accounts page", () => {
		render(
			<div>
				<DashboardPageClient userId={USER_ID} />
				<AccountsPageClient userId={USER_ID} />
			</div>
		);

		const toggles = screen.getAllByTestId("hide-amounts-toggle");
		expect(toggles).toHaveLength(2);
		const [dashboardToggle, accountsToggle] = toggles as [HTMLElement, HTMLElement];
		expect(amountTexts().some((text) => text.includes("1,234.50"))).toBe(true);

		// Toggling on the dashboard masks the accounts page too.
		fireEvent.click(dashboardToggle);

		expect(amountTexts().every((text) => text.includes(AMOUNT_MASK))).toBe(true);
		expect(amountTexts().some((text) => text.includes("1,234.50"))).toBe(false);
		expect(accountsToggle).toHaveAttribute("aria-pressed", "true");

		// Toggling back on the accounts page reveals both again.
		fireEvent.click(accountsToggle);

		expect(amountTexts().some((text) => text.includes("1,234.50"))).toBe(true);
		expect(amountTexts().every((text) => !text.includes(AMOUNT_MASK))).toBe(true);
		expect(dashboardToggle).toHaveAttribute("aria-pressed", "false");
	});
});
