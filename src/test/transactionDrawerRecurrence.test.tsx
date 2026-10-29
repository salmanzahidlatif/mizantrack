/**
 * The repeat controls in the transaction drawer. These cover the wiring between the
 * drawer form and the recurring/series actions — the schedule maths itself is pinned in
 * transactionRecurrenceBulkEdit.test.ts.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	RecurrenceFields,
	toRecurrenceRule,
	DEFAULT_RECURRENCE_DRAFT,
	type RecurrenceDraft,
} from "@/components/transactions/RecurrenceFields";
import { TransactionDrawer } from "@/components/transactions/TransactionDrawer";
import { db } from "@/lib/db/local";

import type { Account, Category } from "@/types";

const accountId = "44444444-4444-4444-8444-444444444444";
const categoryId = "55555555-5555-4555-8555-555555555555";
const seriesTransactionId = "66666666-6666-4666-8666-666666666666";

const mocks = vi.hoisted(() => ({
	accounts: [] as Account[],
	categories: [] as Category[],
	createTransaction: vi.fn(),
	createRecurringTransactions: vi.fn(),
	updateTransaction: vi.fn(),
	updateTransactionSeries: vi.fn(),
	bulkDeleteTransactions: vi.fn(),
	loadRecurrenceSeriesIds: vi.fn(),
	ui: {
		editTransactionId: null as string | null,
		isTransactionDrawerOpen: true,
	},
}));

vi.mock("dexie-react-hooks", () => ({
	useLiveQuery: <T,>(_query: () => T | Promise<T>, _deps?: unknown[], defaultResult?: T) =>
		defaultResult,
}));

vi.mock("@/hooks/useAccounts", () => ({
	useActiveAccounts: () => mocks.accounts,
}));

vi.mock("@/hooks/useCategories", () => ({
	useCategories: () => mocks.categories,
}));

vi.mock("@/hooks/useDbConfig", () => ({
	useDbConfig: () => ({ currency: "PKR" }),
}));

vi.mock("@/lib/actions/transactions", () => ({
	bulkDeleteTransactions: mocks.bulkDeleteTransactions,
	createRecurringTransactions: mocks.createRecurringTransactions,
	createTransaction: mocks.createTransaction,
	deleteTransaction: vi.fn(),
	loadRecurrenceSeriesIds: mocks.loadRecurrenceSeriesIds,
	updateTransaction: mocks.updateTransaction,
	updateTransactionSeries: mocks.updateTransactionSeries,
}));

vi.mock("@/lib/usageRanking", () => ({
	EMPTY_TRANSACTION_USAGE_RANKING: { accountUsage: {}, categoryUsage: {} },
	loadRecentTransactionUsageRanking: vi.fn(),
	sortRecordsByUsage: <T,>(records: T[]) => records,
}));

vi.mock("@/store/filter-store", () => ({
	useFilterStore: () => ({ activeCurrency: "PKR" }),
}));

vi.mock("@/store/ui-store", () => ({
	useUIStore: () => ({
		closeTransactionDrawer: () => {
			mocks.ui.isTransactionDrawerOpen = false;
			mocks.ui.editTransactionId = null;
		},
		editTransactionId: mocks.ui.editTransactionId,
		isTransactionDrawerOpen: mocks.ui.isTransactionDrawerOpen,
	}),
}));

vi.mock("sonner", () => ({
	toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() },
}));

beforeEach(async () => {
	vi.clearAllMocks();
	mocks.ui.editTransactionId = null;
	mocks.ui.isTransactionDrawerOpen = true;
	mocks.accounts = [
		{
			id: accountId,
			userId: "recurrence-user",
			title: "Main",
			openingBalance: 0,
			currency: "PKR",
			isArchived: false,
			updatedAt: Date.now(),
		},
	];
	mocks.categories = [
		{
			id: categoryId,
			userId: "recurrence-user",
			title: "Rent",
			type: "Expense",
			currency: "PKR",
			updatedAt: Date.now(),
		},
	];
	mocks.createRecurringTransactions.mockResolvedValue({
		recurrenceId: "series-a",
		transactionIds: Array.from({ length: 12 }, (_, index) => `txn-${index}`),
	});
	mocks.loadRecurrenceSeriesIds.mockResolvedValue([seriesTransactionId, "sibling"]);
	mocks.updateTransactionSeries.mockResolvedValue(2);
	mocks.bulkDeleteTransactions.mockResolvedValue(2);

	await db.transactions.clear();
});

afterEach(() => {
	cleanup();
});

function fillRequiredFields() {
	fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "5000" } });
	fireEvent.click(screen.getByRole("radio", { name: "Main (PKR)" }));
}

describe("recurrence fields", () => {
	it("previews how many transactions a monthly repeat creates", () => {
		const draft: RecurrenceDraft = {
			...DEFAULT_RECURRENCE_DRAFT,
			enabled: true,
			frequency: "monthly",
			count: 12,
		};

		render(<RecurrenceFields startDate={new Date(2026, 0, 15)} value={draft} onChange={vi.fn()} />);

		const status = screen.getByRole("status");
		expect(status).toHaveTextContent("12");
		expect(status).toHaveTextContent("15 Dec 2026");
	});

	it("asks the owner to finish an unfinished end date before previewing", () => {
		const draft: RecurrenceDraft = {
			...DEFAULT_RECURRENCE_DRAFT,
			enabled: true,
			endMode: "until",
			until: undefined,
		};

		render(<RecurrenceFields startDate={new Date(2026, 0, 15)} value={draft} onChange={vi.fn()} />);

		expect(screen.getByRole("status")).toHaveTextContent(/choose how the repeat ends/i);
		expect(toRecurrenceRule(draft)).toBeNull();
	});
});

describe("TransactionDrawer repeat", () => {
	it("records a one-off transaction when repeat stays off", async () => {
		render(<TransactionDrawer userId="recurrence-user" />);
		fillRequiredFields();

		fireEvent.click(screen.getByRole("button", { name: "Record" }));

		await waitFor(() => {
			expect(mocks.createTransaction).toHaveBeenCalledTimes(1);
		});
		expect(mocks.createRecurringTransactions).not.toHaveBeenCalled();
	});

	it("creates a whole series once repeat is switched on", async () => {
		render(<TransactionDrawer userId="recurrence-user" />);
		fillRequiredFields();

		fireEvent.click(screen.getByRole("switch", { name: /repeat this transaction/i }));
		// The default draft is monthly for 12, so the button must state the real count.
		const submit = await screen.findByRole("button", { name: /record 12 transactions/i });
		fireEvent.click(submit);

		await waitFor(() => {
			expect(mocks.createRecurringTransactions).toHaveBeenCalledTimes(1);
		});
		const [, , rule] = mocks.createRecurringTransactions.mock.calls[0]!;
		expect(rule).toMatchObject({ frequency: "monthly", interval: 1, endMode: "count", count: 12 });
		expect(mocks.createTransaction).not.toHaveBeenCalled();
	});

	it("offers no repeat controls when editing an existing transaction", async () => {
		mocks.ui.editTransactionId = seriesTransactionId;
		await db.transactions.put({
			id: seriesTransactionId,
			userId: "recurrence-user",
			type: "Expense",
			amount: 5000,
			date: Date.now(),
			accountId,
			updatedAt: Date.now(),
		});

		render(<TransactionDrawer userId="recurrence-user" />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Save Changes" })).toBeInTheDocument();
		});
		expect(
			screen.queryByRole("switch", { name: /repeat this transaction/i })
		).not.toBeInTheDocument();
	});

	it("edits only the opened occurrence of a series by default", async () => {
		mocks.ui.editTransactionId = seriesTransactionId;
		await db.transactions.put({
			id: seriesTransactionId,
			userId: "recurrence-user",
			type: "Expense",
			amount: 5000,
			date: Date.now(),
			accountId,
			recurrenceId: "series-a",
			updatedAt: Date.now(),
		});

		render(<TransactionDrawer userId="recurrence-user" />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Only this" })).toHaveAttribute(
				"aria-pressed",
				"true"
			);
		});

		fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

		await waitFor(() => {
			expect(mocks.updateTransaction).toHaveBeenCalledTimes(1);
		});
		expect(mocks.updateTransactionSeries).not.toHaveBeenCalled();
	});

	it("edits the whole series when that scope is chosen", async () => {
		mocks.ui.editTransactionId = seriesTransactionId;
		await db.transactions.put({
			id: seriesTransactionId,
			userId: "recurrence-user",
			type: "Expense",
			amount: 5000,
			date: Date.now(),
			accountId,
			recurrenceId: "series-a",
			updatedAt: Date.now(),
		});

		render(<TransactionDrawer userId="recurrence-user" />);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
		});
		fireEvent.click(screen.getByRole("button", { name: "All" }));
		fireEvent.click(screen.getByRole("button", { name: "Save Series" }));

		await waitFor(() => {
			expect(mocks.updateTransactionSeries).toHaveBeenCalledTimes(1);
		});
		expect(mocks.loadRecurrenceSeriesIds).toHaveBeenCalledWith(
			"recurrence-user",
			seriesTransactionId,
			"series"
		);
		// The opened occurrence must lead so it is the one that takes the new date.
		const [, ids] = mocks.updateTransactionSeries.mock.calls[0]!;
		expect((ids as string[])[0]).toBe(seriesTransactionId);
		expect(mocks.updateTransaction).not.toHaveBeenCalled();
	});
});
