/**
 * Archived accounts in the zakat year grid.
 *
 * A closed account still held wealth during the years it was open — the owner's trusted
 * `2020` sheet includes a row called `Alfalah (Closed)` — so an archived account must be
 * selectable and must reach the grid, the monthly `TOTAL`s, `MINIMUM` and `MAXIMUM` on
 * exactly the same footing as an open one.
 *
 * The guard on the other side matters just as much: an account reports 0 for the months
 * before its first transaction, so a long-closed account does not appear to hold its
 * present-day balance in years it had not been used yet.
 */
import { describe, expect, it } from "vitest";

import { computeZakatYearGrid, getZakatYearDefinitionByIslamicYear } from "@/lib/zakatEngine";

import type { Account, Transaction } from "@/types";

const USER_ID = "zakat-archived-accounts-user";
/** AH1444 opened on 23 March 2023; the `2024` sheet is this year. */
const YEAR = getZakatYearDefinitionByIslamicYear(1444);

function account(id: string, overrides: Partial<Account> = {}): Account {
	return {
		id,
		userId: USER_ID,
		title: id,
		openingBalance: 0,
		currency: "PKR",
		isArchived: false,
		accountType: "asset",
		updatedAt: 1_000,
		...overrides,
	};
}

function income(accountId: string, amount: number, date: Date): Transaction {
	return {
		id: `${accountId}-${date.getTime()}`,
		userId: USER_ID,
		type: "Income",
		date: date.getTime(),
		amount,
		accountId,
		updatedAt: 1_000,
	};
}

function gridFor(accounts: Account[], transactions: Transaction[], selected: string[]) {
	return computeZakatYearGrid({
		userId: USER_ID,
		accounts,
		transactions,
		selectedAccountIds: new Set(selected),
		sheetYear: YEAR.sheetYear,
		yearDefinition: YEAR,
	});
}

/** The day before the zakat year opens, so a balance is in place for every month. */
const BEFORE_THE_YEAR = new Date(YEAR.months[0]!.startDate.getTime() - 86_400_000);

describe("archived accounts in the zakat year", () => {
	const open = account("meezan");
	const closed = account("alfalah", { title: "Alfalah", isArchived: true });
	const transactions = [
		income("meezan", 1_000_000, BEFORE_THE_YEAR),
		income("alfalah", 500_000, BEFORE_THE_YEAR),
	];

	it("contributes to the grid, the monthly totals, MINIMUM and MAXIMUM once selected", () => {
		const withoutClosed = gridFor([open, closed], transactions, ["meezan"]);
		const withClosed = gridFor([open, closed], transactions, ["meezan", "alfalah"]);

		expect(withoutClosed.accounts.map((row) => row.accountId)).toEqual(["meezan"]);
		expect(withoutClosed.minimum).toBe(1_000_000);
		expect(withoutClosed.maximum).toBe(1_000_000);

		expect(withClosed.accounts.map((row) => row.accountId)).toEqual(["meezan", "alfalah"]);
		expect(withClosed.monthlyTotals).toEqual(Array.from({ length: 12 }, () => 1_500_000));
		expect(withClosed.minimum).toBe(1_500_000);
		expect(withClosed.maximum).toBe(1_500_000);
	});

	it("marks the closed row as archived so the grid and the export can say so", () => {
		const grid = gridFor([open, closed], transactions, ["meezan", "alfalah"]);
		const row = grid.accounts.find((candidate) => candidate.accountId === "alfalah");

		expect(row?.isArchived).toBe(true);
		expect(row?.balances).toEqual(Array.from({ length: 12 }, () => 500_000));
		expect(grid.accounts.find((candidate) => candidate.accountId === "meezan")?.isArchived).toBe(
			false
		);
	});

	it("moves MINIMUM and MAXIMUM when the closed account's balance varies", () => {
		const varying = [
			income("meezan", 1_000_000, BEFORE_THE_YEAR),
			income("alfalah", 500_000, BEFORE_THE_YEAR),
			// Mid-year top-up: the closed account lifts the later months only.
			income("alfalah", 250_000, YEAR.months[6]!.startDate),
		];
		const grid = gridFor([open, closed], varying, ["meezan", "alfalah"]);

		expect(grid.minimum).toBe(1_500_000);
		expect(grid.maximum).toBe(1_750_000);
	});

	it("still reports 0 for the months before an account's first transaction", () => {
		// Regression guard for `hasActivityBy`: an opening balance applies from the
		// beginning of time, so without it an account opened mid-year would show its
		// present balance in every earlier month.
		const openedMidYear = account("bridge", {
			isArchived: true,
			openingBalance: 2_000_000,
		});
		const grid = gridFor(
			[open, openedMidYear],
			[
				income("meezan", 1_000_000, BEFORE_THE_YEAR),
				income("bridge", 1, YEAR.months[8]!.startDate),
			],
			["meezan", "bridge"]
		);

		const row = grid.accounts.find((candidate) => candidate.accountId === "bridge");
		expect(row?.balances.slice(0, 8)).toEqual(Array.from({ length: 8 }, () => 0));
		expect(row?.balances[8]).toBe(2_000_001);
		expect(grid.minimum).toBe(1_000_000);
		expect(grid.maximum).toBe(3_000_001);
	});

	it("keeps a closed liability negative inside the same sum", () => {
		const closedLoan = account("papa", {
			title: "Loan <-- (Papa)",
			isArchived: true,
			accountType: "liability",
		});
		const grid = gridFor(
			[open, closedLoan],
			[income("meezan", 1_000_000, BEFORE_THE_YEAR), income("papa", 200_000, BEFORE_THE_YEAR)],
			["meezan", "papa"]
		);

		expect(grid.accounts.find((candidate) => candidate.accountId === "papa")?.balances[0]).toBe(
			-200_000
		);
		expect(grid.minimum).toBe(800_000);
	});
});
