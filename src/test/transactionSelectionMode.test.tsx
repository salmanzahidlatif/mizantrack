/**
 * Selection mode on the transactions list. A row that selects instead of opening is the
 * entry point to bulk editing, so the swap between the two behaviours is pinned here.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TransactionRow } from "@/components/transactions/TransactionRow";
import { useUIStore } from "@/store/ui-store";

import type { Account, Transaction } from "@/types";

const USER_ID = "transaction-selection-user";

const ACCOUNTS: Account[] = [
	{
		id: "selection-account",
		userId: USER_ID,
		title: "Main",
		openingBalance: 0,
		currency: "AED",
		isArchived: false,
		updatedAt: Date.now(),
	},
];

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
	return {
		id: "selection-txn",
		userId: USER_ID,
		type: "Expense",
		date: Date.now(),
		amount: 5000,
		accountId: "selection-account",
		description: "Monthly rent",
		updatedAt: Date.now(),
		...overrides,
	};
}

afterEach(() => {
	cleanup();
	useUIStore.setState({ isTransactionDrawerOpen: false, editTransactionId: null });
});

describe("transaction row selection mode", () => {
	it("opens the edit drawer when selection mode is off", () => {
		render(<TransactionRow transaction={makeTransaction()} accounts={ACCOUNTS} categories={[]} />);

		fireEvent.click(screen.getByRole("button"));

		expect(useUIStore.getState().isTransactionDrawerOpen).toBe(true);
		expect(useUIStore.getState().editTransactionId).toBe("selection-txn");
	});

	it("toggles selection instead of opening the drawer when selection mode is on", () => {
		const onToggleSelect = vi.fn();
		render(
			<TransactionRow
				transaction={makeTransaction()}
				accounts={ACCOUNTS}
				categories={[]}
				selectionMode
				selected={false}
				onToggleSelect={onToggleSelect}
			/>
		);

		const row = screen.getByRole("button", { name: /select monthly rent/i });
		expect(row).toHaveAttribute("aria-pressed", "false");

		fireEvent.click(row);

		expect(onToggleSelect).toHaveBeenCalledWith("selection-txn");
		expect(useUIStore.getState().isTransactionDrawerOpen).toBe(false);
	});

	it("announces a selected row as pressed and offers to deselect it", () => {
		render(
			<TransactionRow
				transaction={makeTransaction()}
				accounts={ACCOUNTS}
				categories={[]}
				selectionMode
				selected
				onToggleSelect={vi.fn()}
			/>
		);

		const row = screen.getByRole("button", { name: /deselect monthly rent/i });
		expect(row).toHaveAttribute("aria-pressed", "true");
	});

	it("marks a row that belongs to a repeating series", () => {
		render(
			<TransactionRow
				transaction={makeTransaction({ recurrenceId: "series-a" })}
				accounts={ACCOUNTS}
				categories={[]}
			/>
		);

		expect(screen.getByLabelText("Part of a repeating series")).toBeInTheDocument();
	});

	it("leaves a one-off transaction unmarked", () => {
		render(<TransactionRow transaction={makeTransaction()} accounts={ACCOUNTS} categories={[]} />);

		expect(screen.queryByLabelText("Part of a repeating series")).not.toBeInTheDocument();
	});
});
