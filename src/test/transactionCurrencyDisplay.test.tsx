import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { TransactionRow } from "@/components/transactions/TransactionRow";

import type { Account, Transaction } from "@/types";

afterEach(() => {
	cleanup();
});

describe("transaction currency display", () => {
	it("renders the AED Dirham glyph before the numerals in DOM order", () => {
		const { container } = render(<CurrencyAmount amount={1234.5} currency="AED" />);
		const amount = container.querySelector("[data-currency-amount]");
		const glyph = screen.getByTestId("dirham-sign");
		const numerals = screen.getByText("1,234.50");

		expect(amount).toHaveAttribute("dir", "ltr");
		expect(glyph.tagName.toLowerCase()).toBe("svg");
		expect(glyph.compareDocumentPosition(numerals) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
	});

	it("renders a transfer source currency when the source account is outside the active currency", () => {
		const accounts: Account[] = [
			{
				id: "display-pkr-account",
				userId: "transaction-currency-display-user",
				title: "PKR Cash",
				openingBalance: 50000,
				currency: "PKR",
				isArchived: false,
				updatedAt: Date.now(),
			},
			{
				id: "display-aed-account",
				userId: "transaction-currency-display-user",
				title: "AED Wallet",
				openingBalance: 0,
				currency: "AED",
				isArchived: false,
				updatedAt: Date.now(),
			},
		];
		const transaction: Transaction = {
			id: "display-cross-transfer",
			userId: "transaction-currency-display-user",
			type: "Transfer",
			date: Date.now(),
			amount: 50000,
			accountId: "display-pkr-account",
			toAccountId: "display-aed-account",
			description: "FX transfer",
			updatedAt: Date.now(),
		};

		render(<TransactionRow transaction={transaction} accounts={accounts} categories={[]} />);

		expect(screen.getByText("FX transfer")).toBeInTheDocument();
		expect(screen.getByText("PKR Cash (PKR) → AED Wallet (AED)")).toBeInTheDocument();
		expect(screen.getByText("₨ 50,000.00")).toBeInTheDocument();
	});

	it("uses an explicit unknown-currency fallback instead of rendering a bare amount", () => {
		const transaction: Transaction = {
			id: "display-missing-account",
			userId: "transaction-currency-display-user",
			type: "Income",
			date: Date.now(),
			amount: 50000,
			accountId: "missing-account",
			description: "Imported legacy income",
			updatedAt: Date.now(),
		};

		render(<TransactionRow transaction={transaction} accounts={[]} categories={[]} />);

		expect(screen.getByText("Imported legacy income")).toBeInTheDocument();
		expect(screen.getByText("Unknown account")).toBeInTheDocument();
		expect(screen.getByText("XXX 50,000.00")).toBeInTheDocument();
	});

	it("resolves archived account labels and currencies instead of falling back to unknowns", () => {
		const accounts: Account[] = [
			{
				id: "archived-pkr-wallet",
				userId: "transaction-currency-display-user",
				title: "Archived PKR Wallet",
				openingBalance: 0,
				currency: "PKR",
				isArchived: true,
				updatedAt: Date.now(),
			},
		];
		const transaction: Transaction = {
			id: "archived-account-transaction",
			userId: "transaction-currency-display-user",
			type: "Expense",
			date: Date.now(),
			amount: 4000,
			accountId: "archived-pkr-wallet",
			description: "Archived account spending",
			updatedAt: Date.now(),
		};

		render(<TransactionRow transaction={transaction} accounts={accounts} categories={[]} />);

		expect(screen.getByText("Archived PKR Wallet")).toBeInTheDocument();
		expect(screen.queryByText("Unknown account")).not.toBeInTheDocument();
		expect(screen.getByText("₨ -4,000.00")).toBeInTheDocument();
		expect(screen.queryByText("XXX -4,000.00")).not.toBeInTheDocument();
		expect(screen.getByText("Archived")).toBeInTheDocument();
		expect(screen.getByText("Archived PKR Wallet is archived")).toHaveClass("sr-only");
	});

	it("does not show the archived indicator for active accounts", () => {
		const accounts: Account[] = [
			{
				id: "active-pkr-wallet",
				userId: "transaction-currency-display-user",
				title: "Active PKR Wallet",
				openingBalance: 0,
				currency: "PKR",
				isArchived: false,
				updatedAt: Date.now(),
			},
		];
		const transaction: Transaction = {
			id: "active-account-transaction",
			userId: "transaction-currency-display-user",
			type: "Income",
			date: Date.now(),
			amount: 4000,
			accountId: "active-pkr-wallet",
			description: "Active account income",
			updatedAt: Date.now(),
		};

		render(<TransactionRow transaction={transaction} accounts={accounts} categories={[]} />);

		expect(screen.getByText("Active PKR Wallet")).toBeInTheDocument();
		expect(screen.queryByText("Archived")).not.toBeInTheDocument();
	});

	it("resolves transfer account titles when one leg is archived", () => {
		const accounts: Account[] = [
			{
				id: "archived-transfer-source",
				userId: "transaction-currency-display-user",
				title: "Archived Transfer Source",
				openingBalance: 0,
				currency: "PKR",
				isArchived: true,
				updatedAt: Date.now(),
			},
			{
				id: "active-transfer-destination",
				userId: "transaction-currency-display-user",
				title: "Active Transfer Destination",
				openingBalance: 0,
				currency: "PKR",
				isArchived: false,
				updatedAt: Date.now(),
			},
		];
		const transaction: Transaction = {
			id: "archived-transfer",
			userId: "transaction-currency-display-user",
			type: "Transfer",
			date: Date.now(),
			amount: 4000,
			accountId: "archived-transfer-source",
			toAccountId: "active-transfer-destination",
			description: "Move from archived account",
			updatedAt: Date.now(),
		};

		render(<TransactionRow transaction={transaction} accounts={accounts} categories={[]} />);

		expect(
			screen.getByText("Archived Transfer Source → Active Transfer Destination")
		).toBeInTheDocument();
		expect(screen.queryByText("Unknown account")).not.toBeInTheDocument();
		expect(screen.getByText("Archived")).toBeInTheDocument();
	});
});
