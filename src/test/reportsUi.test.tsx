/**
 * Reports UI: the auto-detect → confirm → report workflow.
 * Nothing here is persisted as a report: every figure is recomputed from Dexie.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FiscalReportPanel } from "@/components/reports/FiscalReportPanel";
import { db } from "@/lib/db/local";

import type { Account, DbConfig, Transaction } from "@/types";

const USER_ID = "reports-ui-user";

const config: DbConfig = {
	id: USER_ID,
	firebaseConfig: "{}",
	enabled: false,
	currency: "AED",
	fiscalYearStartMonth: 7,
	enabledCurrencies: ["AED"],
};

vi.mock("@/hooks/useDbConfig", () => ({
	useDbConfig: () => config,
}));

const account: Account = {
	id: "aed-bank",
	userId: USER_ID,
	title: "FAB Current",
	openingBalance: 5000,
	currency: "AED",
	isArchived: false,
	updatedAt: 1,
};

const remittance: Transaction = {
	id: "remittance-1",
	userId: USER_ID,
	type: "Transfer",
	amount: 2500,
	accountId: account.id,
	toAccountId: "pkr-bank",
	description: "Remittance to HBL",
	date: Date.now() - 24 * 60 * 60 * 1000,
	updatedAt: 1,
};

async function clearReportTables() {
	await Promise.all([
		db.accounts.clear(),
		db.transactions.clear(),
		db.reportAccountTags.clear(),
		db.reportProjects.clear(),
		db.reportTransactionTags.clear(),
		db.reportManualEntries.clear(),
		db.reportMonthlySalaryRows.clear(),
	]);
}

describe("Reports fiscal panel", () => {
	beforeEach(async () => {
		await clearReportTables();
		await db.accounts.put(account);
		await db.transactions.put(remittance);
	});

	afterEach(async () => {
		cleanup();
		await clearReportTables();
	});

	it("keeps suggestions out of the report until the user confirms them", async () => {
		render(<FiscalReportPanel userId={USER_ID} />);

		const pendingCount = await screen.findByTestId("report-pending-count");
		expect(pendingCount).toHaveTextContent("1 pending review");
		expect(await screen.findByText("Suggested")).toBeInTheDocument();

		const remittancesSection = screen
			.getByRole("heading", { name: "Remittances" })
			.closest("section");
		expect(
			within(remittancesSection!).getByText(/No confirmed remittances yet/)
		).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));

		await waitFor(() => {
			expect(screen.getByTestId("report-pending-count")).toHaveTextContent("0 pending review");
		});
		expect(within(remittancesSection!).getByText("Remittance to HBL")).toBeInTheDocument();

		const storedTags = await db.reportTransactionTags.toArray();
		expect(storedTags).toHaveLength(1);
		expect(storedTags[0]).toMatchObject({ role: "remittance", confirmed: true });
	});

	it("untags a confirmed transaction and returns it to review", async () => {
		render(<FiscalReportPanel userId={USER_ID} />);

		fireEvent.click(await screen.findByRole("button", { name: /Confirm/ }));
		await waitFor(() => {
			expect(screen.getByTestId("report-pending-count")).toHaveTextContent("0 pending review");
		});

		fireEvent.click(screen.getByRole("button", { name: /Untag/ }));

		await waitFor(() => {
			expect(screen.getByTestId("report-pending-count")).toHaveTextContent("1 pending review");
		});
		const remittancesSection = screen
			.getByRole("heading", { name: "Remittances" })
			.closest("section");
		expect(
			within(remittancesSection!).getByText(/No confirmed remittances yet/)
		).toBeInTheDocument();
	});

	it("includes an account only after it is toggled on", async () => {
		render(<FiscalReportPanel userId={USER_ID} />);

		const accountButton = await screen.findByRole("button", { name: /FAB Current/ });
		expect(accountButton).toHaveAttribute("aria-pressed", "false");

		fireEvent.click(accountButton);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /FAB Current/ })).toHaveAttribute(
				"aria-pressed",
				"true"
			);
		});
		const tags = await db.reportAccountTags.toArray();
		expect(tags[0]).toMatchObject({ accountId: account.id, includeInReport: true });
	});

	it("offers only accounts in the active currency for selection", async () => {
		await db.accounts.put({
			id: "pkr-bank",
			userId: USER_ID,
			title: "Meezan Savings",
			openingBalance: 100_000,
			currency: "PKR",
			isArchived: false,
			updatedAt: 1,
		});

		render(<FiscalReportPanel userId={USER_ID} />);

		expect(await screen.findByRole("button", { name: /FAB Current/ })).toBeInTheDocument();
		expect(screen.queryByRole("button", { name: /Meezan Savings/ })).not.toBeInTheDocument();
		expect(await screen.findByTestId("report-accounts-summary")).toHaveTextContent(
			"0 of 1 included"
		);
	});

	it("surfaces an income for review and carries it into the report once tagged", async () => {
		await db.transactions.put({
			id: "income-1",
			userId: USER_ID,
			type: "Income",
			amount: 1800,
			accountId: account.id,
			description: "Consulting credit",
			date: Date.now() - 2 * 24 * 60 * 60 * 1000,
			updatedAt: 1,
		});

		render(<FiscalReportPanel userId={USER_ID} />);

		await waitFor(() => {
			expect(screen.getByTestId("report-pending-count")).toHaveTextContent("2 pending review");
		});

		const incomesSection = screen.getByRole("heading", { name: "Incomes" }).closest("section");
		expect(within(incomesSection!).getByText(/No confirmed income yet/)).toBeInTheDocument();

		const incomeRow = screen.getByText("Consulting credit").closest("[data-testid]");
		fireEvent.click(within(incomeRow as HTMLElement).getByRole("button", { name: /Confirm/ }));

		await waitFor(() => {
			expect(within(incomesSection!).getByText("Consulting credit")).toBeInTheDocument();
		});

		const storedTag = await db.reportTransactionTags.get({ transactionId: "income-1" });
		expect(storedTag).toMatchObject({ role: "income", confirmed: true });
	});

	it("never surfaces an expense for review", async () => {
		await db.transactions.put({
			id: "metro-expense",
			userId: USER_ID,
			type: "Expense",
			amount: 7.5,
			accountId: account.id,
			description: "metro city snack",
			date: Date.now() - 2 * 24 * 60 * 60 * 1000,
			updatedAt: 1,
		});

		render(<FiscalReportPanel userId={USER_ID} />);

		await waitFor(() => {
			expect(screen.getByTestId("report-pending-count")).toHaveTextContent("1 pending review");
		});
		expect(screen.queryByText("metro city snack")).not.toBeInTheDocument();
	});
});
