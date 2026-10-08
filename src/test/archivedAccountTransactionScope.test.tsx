import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionFilters } from "@/components/transactions/TransactionFilters";
import { useAccounts, useActiveAccounts } from "@/hooks/useAccounts";
import { db } from "@/lib/db/local";

import type { Account } from "@/types";
import type * as ReactType from "react";

const USER_ID = "archived-account-transaction-scope-user";

const mocks = vi.hoisted(() => ({
	setAccountId: vi.fn(),
	setCategoryId: vi.fn(),
	setPeriod: vi.fn(),
	setSearchQuery: vi.fn(),
	setTransactionType: vi.fn(),
	reset: vi.fn(),
}));

vi.mock("@/components/ui/select", async () => {
	const React = await vi.importActual<typeof ReactType>("react");

	type SelectContextValue = {
		onValueChange?: (value: string) => void;
		value?: string;
	};
	const SelectContext = React.createContext<SelectContextValue>({});

	function Select({
		children,
		onValueChange,
		value,
	}: ReactType.PropsWithChildren<SelectContextValue>) {
		return (
			<SelectContext.Provider value={{ onValueChange, value }}>
				<div data-slot="select">{children}</div>
			</SelectContext.Provider>
		);
	}

	function SelectTrigger({
		children,
		...props
	}: ReactType.PropsWithChildren<ReactType.ButtonHTMLAttributes<HTMLButtonElement>>) {
		return (
			<button type="button" role="combobox" {...props}>
				{children}
			</button>
		);
	}

	function SelectValue({ placeholder }: { placeholder?: string }) {
		const { value } = React.useContext(SelectContext);
		return <span>{value ?? placeholder}</span>;
	}

	function SelectContent({ children }: ReactType.PropsWithChildren) {
		return <div>{children}</div>;
	}

	function SelectItem({ children, value }: ReactType.PropsWithChildren<{ value: string }>) {
		const { onValueChange } = React.useContext(SelectContext);

		return (
			<button type="button" role="option" onClick={() => onValueChange?.(value)}>
				{children}
			</button>
		);
	}

	return { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
});

vi.mock("@/hooks/useCategories", () => ({
	useCategories: () => [],
}));

vi.mock("@/hooks/useDbConfig", () => ({
	useDbConfig: () => ({
		currency: "PKR",
		enabledCurrencies: ["PKR", "AED"],
	}),
}));

vi.mock("@/lib/usageRanking", () => ({
	EMPTY_TRANSACTION_USAGE_RANKING: { accountUsage: {}, categoryUsage: {} },
	loadRecentTransactionUsageRanking: vi.fn(async () => ({
		accountUsage: {},
		categoryUsage: {},
	})),
	sortRecordsByUsage: <T,>(records: T[]) => records,
}));

vi.mock("@/store/filter-store", () => ({
	UNCATEGORIZED_CATEGORY_FILTER: "__uncategorized__",
	useFilterStore: () => ({
		period: "month",
		accountId: null,
		categoryId: null,
		transactionType: "All",
		searchQuery: "",
		activeCurrency: "PKR",
		setPeriod: mocks.setPeriod,
		setAccountId: mocks.setAccountId,
		setCategoryId: mocks.setCategoryId,
		setTransactionType: mocks.setTransactionType,
		setSearchQuery: mocks.setSearchQuery,
		reset: mocks.reset,
	}),
}));

function account(overrides: Partial<Account>): Account {
	return {
		id: overrides.id ?? "account",
		userId: overrides.userId ?? USER_ID,
		title: overrides.title ?? "Account",
		openingBalance: overrides.openingBalance ?? 0,
		currency: overrides.currency ?? "PKR",
		isArchived: overrides.isArchived ?? false,
		updatedAt: overrides.updatedAt ?? Date.now(),
		...overrides,
	};
}

function AccountHookProbe({ showArchived }: { showArchived: boolean }) {
	const accounts = showArchived
		? useAccounts(USER_ID, { showArchived: true })
		: useActiveAccounts(USER_ID);

	return (
		<div data-testid={showArchived ? "all-accounts" : "active-accounts"}>
			<span data-testid={showArchived ? "all-status" : "active-status"}>
				{accounts ? "loaded" : "loading"}
			</span>
			{accounts?.map((item) => (
				<span key={item.id}>{item.title}</span>
			))}
		</div>
	);
}

beforeEach(async () => {
	await db.accounts.where("userId").equals(USER_ID).delete();
	vi.clearAllMocks();
});

afterEach(async () => {
	cleanup();
	await db.accounts.where("userId").equals(USER_ID).delete();
});

describe("archived account transaction display scope", () => {
	it("shows archived accounts in the transaction account filter for the active currency", () => {
		render(
			<TransactionFilters
				userId={USER_ID}
				accounts={[
					account({ id: "active-pkr", title: "Active PKR Wallet" }),
					account({ id: "archived-pkr", title: "Old PKR Wallet", isArchived: true }),
					account({
						id: "archived-aed",
						title: "Old AED Wallet",
						currency: "AED",
						isArchived: true,
					}),
				]}
			/>
		);

		expect(screen.getByText("Active PKR Wallet")).toBeInTheDocument();
		expect(screen.getByText("Old PKR Wallet")).toBeInTheDocument();
		expect(screen.getByText("Archived")).toBeInTheDocument();
		expect(screen.getByText("Old PKR Wallet is archived")).toHaveClass("sr-only");
		expect(screen.queryByText("Old AED Wallet")).not.toBeInTheDocument();
	});

	it("keeps new-transaction account sources active-only while all-account lookups include archived accounts", async () => {
		await db.accounts.bulkPut([
			account({ id: "active-source", title: "Active Source" }),
			account({ id: "archived-source", title: "Archived Source", isArchived: true }),
		]);

		render(
			<>
				<AccountHookProbe showArchived={false} />
				<AccountHookProbe showArchived />
			</>
		);

		await waitFor(() => {
			expect(screen.getByTestId("active-status")).toHaveTextContent("loaded");
			expect(screen.getByTestId("all-status")).toHaveTextContent("loaded");
		});

		const activeAccounts = within(screen.getByTestId("active-accounts"));
		const allAccounts = within(screen.getByTestId("all-accounts"));

		expect(activeAccounts.getByText("Active Source")).toBeInTheDocument();
		expect(activeAccounts.queryByText("Archived Source")).not.toBeInTheDocument();
		expect(allAccounts.getByText("Active Source")).toBeInTheDocument();
		expect(allAccounts.getByText("Archived Source")).toBeInTheDocument();
	});
});
