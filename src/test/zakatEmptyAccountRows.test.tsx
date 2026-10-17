/**
 * Accounts that held nothing all year are noise. The monthly grid and the exported
 * workbook both drop those rows, and they drop exactly the same ones — the single
 * predicate in `src/lib/zakatAccountVisibility.ts` is what keeps them in step.
 *
 * Hiding a row is presentation only: an all-zero account contributes nothing to any
 * monthly total, so TOTAL, MINIMUM and MAXIMUM must come out byte-identical with and
 * without the hidden rows. These tests pin that.
 */
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { ZakatMonthlyBalances } from "@/components/zakat/ZakatMonthlyBalances";
import { hasAnyMonthlyBalance, visibleZakatAccounts } from "@/lib/zakatAccountVisibility";
import { buildZakatWorkbook } from "@/lib/zakatExport";

import type { ZakatYearDefinition } from "@/lib/zakatCalendar";
import type { ZakatAccountMonthBalance, ZakatYearGrid } from "@/lib/zakatEngine";
import type { ZakatExportYear } from "@/lib/zakatExport";
import type { IslamicMonth } from "@/types";

const ISLAMIC_MONTH_NAMES: IslamicMonth[] = [
	"Ramaḍān",
	"Shawwāl",
	"Zū al-Qaʿdah",
	"Zū al-Ḥijjah",
	"al-Muḥarram",
	"Ṣafar",
	"Rabīʿ al-ʾAwwal",
	"Rabīʿ ath-Thānī",
	"Jumādā al-ʾAwwal",
	"Jumādā ath-Thāniyah",
	"Rajab",
	"Shaʿbān",
];

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeYearDefinition(sheetYear = 2024, islamicYear = 1444): ZakatYearDefinition {
	return {
		sheetYear,
		islamicYear,
		zakatYear: `${islamicYear}-${islamicYear + 1}`,
		label: `${sheetYear} (${islamicYear}–${islamicYear + 1})`,
		ramadanSource: "announced",
		months: ISLAMIC_MONTH_NAMES.map((month, index) => ({
			month,
			islamicYear: index < 4 ? islamicYear : islamicYear + 1,
			startDate: new Date(Date.UTC(sheetYear - 1, 2, 24 + index * 29, 12)),
			endDate: new Date(Date.UTC(sheetYear - 1, 2, 24 + index * 29 + 28, 12)),
		})),
	};
}

function twelve(value: number): number[] {
	return Array.from({ length: 12 }, () => value);
}

function makeAccount(
	accountId: string,
	accountTitle: string,
	balances: number[],
	overrides: Partial<ZakatAccountMonthBalance> = {}
): ZakatAccountMonthBalance {
	return {
		accountId,
		accountTitle,
		currency: "PKR",
		accountType: "asset",
		isArchived: false,
		balances,
		...overrides,
	};
}

function makeGrid(accounts: ZakatAccountMonthBalance[]): ZakatYearGrid {
	const monthlyTotals = Array.from({ length: 12 }, (_unused, index) =>
		accounts.reduce((sum, account) => sum + (account.balances[index] ?? 0), 0)
	);

	return {
		year: makeYearDefinition(),
		accounts,
		monthlyTotals,
		minimum: monthlyTotals.length > 0 ? Math.min(...monthlyTotals) : 0,
		maximum: monthlyTotals.length > 0 ? Math.max(...monthlyTotals) : 0,
	};
}

function makeYear(grid: ZakatYearGrid): ZakatExportYear {
	return {
		grid,
		currency: "PKR",
		basis: "minimum",
		ratePercent: 2.5,
		goldRows: [],
		pastRemaining: 0,
		payments: [],
	};
}

const MEEZAN = makeAccount(
	"meezan",
	"Meezan (Default)",
	[100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200]
);
const EMPTY_SAVINGS = makeAccount("savings", "Dormant Savings", twelve(0));
const RESIDUE = makeAccount("residue", "Closed Current", twelve(4e-10));
const LOAN = makeAccount("papa", "Loan <-- (Papa)", twelve(-10), { accountType: "liability" });

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sheetRows(sheet: XLSX.WorkSheet): unknown[][] {
	return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true });
}

function firstSheet(grid: ZakatYearGrid): XLSX.WorkSheet {
	const workbook = buildZakatWorkbook({ years: [makeYear(grid)] });
	const name = workbook.SheetNames[0];
	expect(name, "Expected at least one sheet").toBeDefined();
	return workbook.Sheets[name!]!;
}

/** Account labels written into column A, between the header and the TOTAL row. */
function exportedAccountLabels(sheet: XLSX.WorkSheet): unknown[] {
	const rows = sheetRows(sheet);
	const headerIndex = rows.findIndex((row) => row[0] === "Account");
	const totalIndex = rows.findIndex((row) => row[0] === "TOTAL");
	expect(headerIndex).toBeGreaterThan(-1);
	expect(totalIndex).toBeGreaterThan(headerIndex);

	return rows
		.slice(headerIndex + 1, totalIndex)
		.map((row) => row[0])
		.filter((label) => label !== undefined && label !== null && label !== "");
}

function cellValue(sheet: XLSX.WorkSheet, ref: string): unknown {
	const found = sheet[ref] as XLSX.CellObject | undefined;
	expect(found, `Expected a cell at ${ref}`).toBeDefined();
	return found!.v;
}

function formulaAt(sheet: XLSX.WorkSheet, ref: string): string {
	const found = sheet[ref] as XLSX.CellObject | undefined;
	expect(found?.f, `Expected cell ${ref} to carry a formula`).toBeDefined();
	return found?.f ?? "";
}

/** The TOTAL row's twelve cached month totals, read out of the workbook. */
function exportedMonthlyTotals(sheet: XLSX.WorkSheet): unknown[] {
	const rows = sheetRows(sheet);
	const totalIndex = rows.findIndex((row) => row[0] === "TOTAL");
	expect(totalIndex).toBeGreaterThan(-1);
	const rowNumber = totalIndex + 1;

	return Array.from({ length: 12 }, (_unused, index) =>
		cellValue(sheet, `${XLSX.utils.encode_col(1 + index)}${rowNumber}`)
	);
}

function renderGrid(grid: ZakatYearGrid) {
	return render(<ZakatMonthlyBalances grid={grid} currency="PKR" basis="minimum" />);
}

/** Account names in the first column of the rendered grid, excluding the TOTAL row. */
function renderedAccountNames(): string[] {
	return screen
		.getAllByRole("row")
		.slice(1)
		.map((row) => within(row).getAllByRole("cell")[0]?.textContent ?? "")
		.filter((label) => !label.startsWith("TOTAL"));
}

// ─── The predicate itself ────────────────────────────────────────────────────

describe("hasAnyMonthlyBalance", () => {
	it("treats twelve zero months as empty", () => {
		expect(hasAnyMonthlyBalance(twelve(0))).toBe(false);
	});

	it("treats floating point residue as empty, at either sign", () => {
		expect(hasAnyMonthlyBalance(twelve(4e-10))).toBe(false);
		expect(hasAnyMonthlyBalance(twelve(-4e-10))).toBe(false);
		expect(hasAnyMonthlyBalance(twelve(0.0049))).toBe(false);
	});

	it("keeps a row that held anything in a single month, of either sign", () => {
		expect(hasAnyMonthlyBalance([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.01])).toBe(true);
		expect(hasAnyMonthlyBalance([0, 0, 0, -0.01, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(true);
		expect(hasAnyMonthlyBalance(twelve(-10))).toBe(true);
	});

	it("ignores non-finite balances rather than counting them as a holding", () => {
		expect(hasAnyMonthlyBalance([Number.NaN, 0, 0])).toBe(false);
	});

	it("preserves the engine's row order for the rows it keeps", () => {
		expect(visibleZakatAccounts([MEEZAN, EMPTY_SAVINGS, LOAN]).map((a) => a.accountId)).toEqual([
			"meezan",
			"papa",
		]);
	});
});

// ─── On screen ───────────────────────────────────────────────────────────────

describe("ZakatMonthlyBalances row filtering", () => {
	it("hides an account that was at zero for all twelve months", () => {
		renderGrid(makeGrid([MEEZAN, EMPTY_SAVINGS]));

		expect(screen.getByText("Meezan (Default)")).toBeInTheDocument();
		expect(screen.queryByText("Dormant Savings")).not.toBeInTheDocument();
	});

	it("shows an account with a single non-zero month", () => {
		const blip = makeAccount("blip", "One Month Only", [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 250]);
		renderGrid(makeGrid([blip, EMPTY_SAVINGS]));

		expect(screen.getByText("One Month Only")).toBeInTheDocument();
	});

	it("shows an account whose every month is negative", () => {
		renderGrid(makeGrid([MEEZAN, LOAN]));

		expect(screen.getByText("Loan <-- (Papa)")).toBeInTheDocument();
		expect(screen.getByText("Liability")).toBeInTheDocument();
	});

	it("hides a row of floating point residue", () => {
		renderGrid(makeGrid([MEEZAN, RESIDUE]));

		expect(screen.queryByText("Closed Current")).not.toBeInTheDocument();
	});

	it("keeps the Closed badge on an archived account that did hold a balance", () => {
		const archived = makeAccount("old", "Old Account", twelve(500), { isArchived: true });
		renderGrid(makeGrid([archived, EMPTY_SAVINGS]));

		expect(screen.getByText("Old Account")).toBeInTheDocument();
		expect(screen.getByText("Closed")).toBeInTheDocument();
	});

	it("leaves the monthly totals, MINIMUM and MAXIMUM untouched when rows are hidden", () => {
		const withoutEmpties = makeGrid([MEEZAN, LOAN]);
		const withEmpties = makeGrid([MEEZAN, EMPTY_SAVINGS, LOAN, RESIDUE]);

		const { unmount } = renderGrid(withoutEmpties);
		const baselineRows = screen.getAllByRole("row");
		const baselineTotal = baselineRows[baselineRows.length - 1]?.textContent ?? "";
		const baselineAccounts = renderedAccountNames();
		const baselineMinimum = screen.getByText("MINIMUM").parentElement?.textContent ?? "";
		const baselineMaximum = screen.getByText("MAXIMUM").parentElement?.textContent ?? "";
		unmount();

		renderGrid(withEmpties);
		const rows = screen.getAllByRole("row");

		expect(rows[rows.length - 1]?.textContent).toBe(baselineTotal);
		expect(renderedAccountNames()).toEqual(baselineAccounts);
		expect(screen.getByText("MINIMUM").parentElement?.textContent).toBe(baselineMinimum);
		expect(screen.getByText("MAXIMUM").parentElement?.textContent).toBe(baselineMaximum);
	});

	it("explains itself instead of rendering an empty table when every row is hidden", () => {
		renderGrid(makeGrid([EMPTY_SAVINGS, RESIDUE]));

		expect(screen.getByText("No account held a balance in this year")).toBeInTheDocument();
		expect(screen.queryByRole("table")).not.toBeInTheDocument();
	});
});

// ─── In the workbook ─────────────────────────────────────────────────────────

describe("buildZakatWorkbook row filtering", () => {
	it("leaves an all-zero account out of the sheet", () => {
		const sheet = firstSheet(makeGrid([MEEZAN, EMPTY_SAVINGS, LOAN]));

		expect(exportedAccountLabels(sheet)).toEqual(["Meezan (Default)", "Loan <-- (Papa)"]);
	});

	it("leaves a row of floating point residue out of the sheet", () => {
		const sheet = firstSheet(makeGrid([MEEZAN, RESIDUE]));

		expect(exportedAccountLabels(sheet)).toEqual(["Meezan (Default)"]);
	});

	it("keeps the (Closed) suffix for an archived account that did hold a balance", () => {
		const archived = makeAccount("old", "Old Account", twelve(500), { isArchived: true });
		const sheet = firstSheet(makeGrid([archived, EMPTY_SAVINGS]));

		expect(exportedAccountLabels(sheet)).toEqual(["Old Account (Closed)"]);
	});

	it("writes the same monthly totals, MINIMUM and MAXIMUM whether or not rows are hidden", () => {
		const baseline = firstSheet(makeGrid([MEEZAN, LOAN]));
		const withEmpties = makeGrid([MEEZAN, EMPTY_SAVINGS, LOAN, RESIDUE]);
		const filtered = firstSheet(withEmpties);

		// Filtering moved no figure: the sheet still carries the grid's own totals.
		expect(exportedMonthlyTotals(filtered)).toEqual(withEmpties.monthlyTotals);
		exportedMonthlyTotals(baseline).forEach((total, index) => {
			expect(withEmpties.monthlyTotals[index]).toBeCloseTo(total as number, 2);
		});

		const baselineTotalRow = sheetRows(baseline).findIndex((row) => row[0] === "TOTAL") + 1;
		const filteredTotalRow = sheetRows(filtered).findIndex((row) => row[0] === "TOTAL") + 1;
		expect(filteredTotalRow).toBe(baselineTotalRow);
		expect(cellValue(filtered, `O${filteredTotalRow}`)).toBeCloseTo(
			cellValue(baseline, `O${baselineTotalRow}`) as number,
			2
		);
		expect(cellValue(filtered, `P${filteredTotalRow}`)).toBeCloseTo(
			cellValue(baseline, `P${baselineTotalRow}`) as number,
			2
		);
	});

	it("still produces a valid sheet when every account row is filtered out", () => {
		const grid = makeGrid([EMPTY_SAVINGS, RESIDUE]);
		const sheet = firstSheet(grid);

		// One row is still reserved, so the TOTAL SUM never points at an empty range.
		expect(exportedAccountLabels(sheet)).toEqual([]);
		expect(formulaAt(sheet, "B6")).toBe("SUM(B5:B5)");
		expect(cellValue(sheet, "B6")).toBeCloseTo(0, 2);
		expect(formulaAt(sheet, "O6")).toBe("MIN(B6:M6)");
		expect(formulaAt(sheet, "P6")).toBe("MAX(B6:M6)");
	});
});
