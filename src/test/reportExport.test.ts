/**
 * Excel export for the rebuilt Reports feature. Mirrors the user's two-sheet
 * Details.xlsx layout; the workbook builder is pure so it is asserted directly.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { buildFiscalReportFileName, buildFiscalReportWorkbook } from "@/lib/reports/reportExport";

import type {
	FiscalReportSummary,
	ReportManualEntry,
	ReportMonthlySalaryRow,
	ReportProjectGroup,
} from "@/types";

const USER_ID = "report-export-user";
const FY_FROM_MS = Date.UTC(2023, 6, 1, 0, 0, 0, 0);
const FY_TO_MS = Date.UTC(2024, 5, 30, 23, 59, 59, 999);

const BANKS_SHEET = "Banks & Salaries";
const PLOTS_SHEET = "Plot Payments";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeSummary(overrides: Partial<FiscalReportSummary> = {}): FiscalReportSummary {
	return {
		rangeKey: "FY-2023-2024",
		rangeLabel: "2023 - 2024",
		fromMs: FY_FROM_MS,
		toMs: FY_TO_MS,
		currency: "",
		accountBalances: [],
		remittances: [],
		remittanceTotal: 0,
		incomes: [],
		incomeTotal: 0,
		projectGroups: [],
		projectGrandTotal: 0,
		manualEntries: [],
		monthlySalaryRows: [],
		warnings: [],
		...overrides,
	};
}

function makeSalaryRow(
	overrides: Partial<ReportMonthlySalaryRow> & Pick<ReportMonthlySalaryRow, "id" | "monthKey">
): ReportMonthlySalaryRow {
	return {
		userId: USER_ID,
		fiscalYearKey: "FY-2023-2024",
		updatedAt: 0,
		...overrides,
	};
}

function makeManualEntry(
	overrides: Partial<ReportManualEntry> & Pick<ReportManualEntry, "id" | "label" | "section">
): ReportManualEntry {
	return {
		userId: USER_ID,
		amount: 0,
		currency: "PKR",
		updatedAt: 0,
		...overrides,
	};
}

function makeProjectGroup(
	title: string,
	payments: ReportProjectGroup["payments"],
	overrides: Partial<ReportProjectGroup> = {}
): ReportProjectGroup {
	return {
		project: { id: title, userId: USER_ID, title, updatedAt: 0 },
		payments,
		total: payments.reduce((sum, payment) => sum + payment.amount, 0),
		currency: payments[0]?.currency ?? "",
		...overrides,
	};
}

function sheetRows(workbook: XLSX.WorkBook, sheetName: string): unknown[][] {
	const sheet = workbook.Sheets[sheetName];
	expect(sheet, `Expected a "${sheetName}" sheet`).toBeDefined();
	return XLSX.utils.sheet_to_json<unknown[]>(sheet!, { header: 1, blankrows: true });
}

function rowAt(rows: unknown[][], index: number): unknown[] {
	return rows[index] ?? [];
}

function findRow(rows: unknown[][], label: string): unknown[] {
	const row = rows.find((candidate) => candidate[0] === label);
	expect(row, `Expected a row labelled "${label}"`).toBeDefined();
	return row ?? [];
}

// ─── Workbook shape ──────────────────────────────────────────────────────────

describe("buildFiscalReportWorkbook", () => {
	it("produces exactly the two expected sheets", () => {
		const workbook = buildFiscalReportWorkbook(makeSummary());
		expect(workbook.SheetNames).toEqual([BANKS_SHEET, PLOTS_SHEET]);
	});

	it("does not throw and still yields both sheets for an empty summary", () => {
		const workbook = buildFiscalReportWorkbook(makeSummary());
		expect(workbook.SheetNames).toHaveLength(2);
		expect(sheetRows(workbook, BANKS_SHEET).length).toBeGreaterThan(0);
		expect(workbook.Sheets[PLOTS_SHEET]).toBeDefined();
	});

	// ─── Sheet 1 ───────────────────────────────────────────────────────────────

	it("writes account closing balances as numeric cells under a labelled block", () => {
		const workbook = buildFiscalReportWorkbook(
			makeSummary({
				accountBalances: [
					{
						accountId: "aed-bank",
						title: "ADCB",
						currency: "AED",
						closingBalance: 12500.5,
						isArchived: false,
					},
					{
						accountId: "pkr-bank",
						title: "Meezan",
						currency: "PKR",
						closingBalance: 840000,
						isArchived: true,
					},
				],
			})
		);

		const rows = sheetRows(workbook, BANKS_SHEET);
		expect(rowAt(rows, 0)).toEqual(["Closing Balances"]);
		expect(rowAt(rows, 1)).toEqual(["Account", "Closing Balance", "Currency"]);
		expect(rowAt(rows, 2)).toEqual(["ADCB", 12500.5, "AED"]);
		expect(rowAt(rows, 3)).toEqual(["Meezan (Closed)", 840000, "PKR"]);
		expect(typeof rowAt(rows, 2)[1]).toBe("number");
	});

	it("writes remittances with DD/MM/YYYY dates and a total row", () => {
		const workbook = buildFiscalReportWorkbook(
			makeSummary({
				remittances: [
					{
						transactionId: "t1",
						date: Date.UTC(2023, 7, 9, 12),
						amount: 5000,
						currency: "AED",
						title: "Home transfer",
					},
					{
						transactionId: "t2",
						date: Date.UTC(2024, 0, 15, 12),
						amount: 7500,
						currency: "AED",
						title: "Family support",
					},
				],
				remittanceTotal: 12500,
			})
		);

		const rows = sheetRows(workbook, BANKS_SHEET);
		expect(findRow(rows, "Remittances")).toEqual(["Remittances"]);
		expect(findRow(rows, "Date")).toEqual(["Date", "Title", "Amount", "Currency"]);
		expect(rows).toContainEqual(["09/08/2023", "Home transfer", 5000, "AED"]);
		expect(rows).toContainEqual(["15/01/2024", "Family support", 7500, "AED"]);
		expect(findRow(rows, "Total")).toEqual(["Total", undefined, 12500, "AED"]);
	});

	it("writes tagged incomes as their own block with a total row", () => {
		const workbook = buildFiscalReportWorkbook(
			makeSummary({
				currency: "PKR",
				incomes: [
					{
						transactionId: "i1",
						date: Date.UTC(2023, 7, 9, 12),
						amount: 400000,
						currency: "PKR",
						title: "Meezan credit",
					},
					{
						transactionId: "i2",
						date: Date.UTC(2024, 0, 15, 12),
						amount: 250000,
						currency: "PKR",
						title: "Bridge settlement",
					},
				],
				incomeTotal: 650000,
			})
		);

		const rows = sheetRows(workbook, BANKS_SHEET);
		expect(findRow(rows, "Incomes")).toEqual(["Incomes"]);
		expect(rows).toContainEqual(["09/08/2023", "Meezan credit", 400000, "PKR"]);
		expect(rows).toContainEqual(["15/01/2024", "Bridge settlement", 250000, "PKR"]);

		const incomeIndex = rows.findIndex((row) => row[0] === "Incomes");
		const totalAfterIncomes = rows
			.slice(incomeIndex)
			.find((row) => row[0] === "Total") as unknown[];
		expect(totalAfterIncomes).toEqual(["Total", undefined, 650000, "PKR"]);
	});

	it("keeps the incomes block after the remittances block", () => {
		const workbook = buildFiscalReportWorkbook(makeSummary());
		const rows = sheetRows(workbook, BANKS_SHEET);

		const remittanceIndex = rows.findIndex((row) => row[0] === "Remittances");
		const incomeIndex = rows.findIndex((row) => row[0] === "Incomes");
		expect(remittanceIndex).toBeGreaterThanOrEqual(0);
		expect(incomeIndex).toBeGreaterThan(remittanceIndex);
	});

	it("renders the monthly salary grid in fiscal order with 12 month columns", () => {
		const workbook = buildFiscalReportWorkbook(
			makeSummary({
				monthlySalaryRows: [
					makeSalaryRow({
						id: "s1",
						monthKey: "2023-07",
						company: "Acme FZE",
						salaryPkr: 450000,
						salaryUsd: 1600,
						taxablePkr: 410000,
						providentFundRefund: 12000,
					}),
					makeSalaryRow({
						id: "s2",
						monthKey: "2024-06",
						company: "Acme FZE",
						salaryPkr: 480000,
					}),
				],
			})
		);

		const rows = sheetRows(workbook, BANKS_SHEET);
		const header = rowAt(rows, 0);
		expect(header[0]).toBe("Category / Month");
		expect(header).toHaveLength(13);
		expect(header[1]).toBe("Jul 2023");
		expect(header[12]).toBe("Jun 2024");

		expect(rowAt(rows, 1)[0]).toBe("Company");
		expect(rowAt(rows, 1)[1]).toBe("Acme FZE");
		expect(rowAt(rows, 2)).toEqual(["Salary (PKR)", 450000, ...Array(10).fill(undefined), 480000]);
		expect(findRow(rows, "Salary (USD)")[1]).toBe(1600);
		expect(findRow(rows, "Taxable (PKR)")[1]).toBe(410000);
		expect(findRow(rows, "Provident Fund Refund")[1]).toBe(12000);
	});

	it("omits the salary grid entirely when there are no salary rows", () => {
		const rows = sheetRows(buildFiscalReportWorkbook(makeSummary()), BANKS_SHEET);
		expect(rows.some((row) => row[0] === "Category / Month")).toBe(false);
	});

	it("includes banks and other manual entries on sheet one, never plots entries", () => {
		const workbook = buildFiscalReportWorkbook(
			makeSummary({
				manualEntries: [
					makeManualEntry({
						id: "m1",
						label: "Nayatel tax",
						section: "banks",
						amount: 4285,
						date: Date.UTC(2024, 2, 3, 12),
						note: "Typed by hand",
					}),
					makeManualEntry({ id: "m2", label: "Misc", section: "other", amount: 100 }),
					makeManualEntry({ id: "m3", label: "Plot fee", section: "plots", amount: 999 }),
				],
			})
		);

		const rows = sheetRows(workbook, BANKS_SHEET);
		expect(findRow(rows, "Label")).toEqual(["Label", "Amount", "Currency", "Date", "Note"]);
		expect(rows).toContainEqual(["Nayatel tax", 4285, "PKR", "03/03/2024", "Typed by hand"]);
		expect(rows.some((row) => row[0] === "Misc")).toBe(true);
		expect(rows.some((row) => row[0] === "Plot fee")).toBe(false);
	});

	it("appends a warnings block when the engine reported warnings", () => {
		const workbook = buildFiscalReportWorkbook(
			makeSummary({ warnings: ["Projects mix currencies (AED, PKR)."] })
		);

		const rows = sheetRows(workbook, BANKS_SHEET);
		const warningIndex = rows.findIndex((row) => row[0] === "Warnings");
		expect(warningIndex).toBeGreaterThan(-1);
		expect(rows[warningIndex + 1]).toEqual(["Projects mix currencies (AED, PKR)."]);
	});

	// ─── Sheet 2 ───────────────────────────────────────────────────────────────

	it("renders each project as header, payments, TOTAL and a grand All Total", () => {
		const bwc = makeProjectGroup("BWC 7 Marla", [
			{
				transactionId: "p1",
				date: Date.UTC(2023, 8, 1, 12),
				amount: 250000,
				currency: "PKR",
				title: "Instalment 1",
			},
			{
				transactionId: "p2",
				date: Date.UTC(2023, 11, 1, 12),
				amount: 150000,
				currency: "PKR",
				title: "Instalment 2",
				note: "Late fee waived",
			},
		]);
		const dha = makeProjectGroup("DHA Phase 5", [
			{
				transactionId: "p3",
				date: Date.UTC(2024, 1, 10, 12),
				amount: 100000,
				currency: "PKR",
				title: "Booking",
			},
		]);

		bwc.project.note = "Overseas Block";

		const workbook = buildFiscalReportWorkbook(
			makeSummary({
				projectGroups: [bwc, dha],
				projectGrandTotal: bwc.total + dha.total,
			})
		);

		const rows = sheetRows(workbook, PLOTS_SHEET);
		expect(rows[0]).toEqual(["BWC 7 Marla", "Overseas Block"]);
		expect(rows[1]).toEqual(["01/09/2023", 250000, "PKR"]);
		expect(rows[2]).toEqual(["01/12/2023", 150000, "PKR", "Late fee waived"]);
		expect(rows[3]).toEqual(["TOTAL", 400000, "PKR"]);
		expect(rows[4]).toEqual([]);
		expect(rows[5]).toEqual(["DHA Phase 5"]);
		expect(rows[6]).toEqual(["10/02/2024", 100000, "PKR"]);
		expect(rows[7]).toEqual(["TOTAL", 100000, "PKR"]);
		expect(findRow(rows, "All Total")).toEqual(["All Total", 500000]);
	});

	it("keeps each payment's own currency when a project mixes currencies", () => {
		const mixed = makeProjectGroup(
			"Mixed Project",
			[
				{
					transactionId: "p1",
					date: Date.UTC(2023, 8, 1, 12),
					amount: 1000,
					currency: "AED",
					title: "Advance",
				},
				{
					transactionId: "p2",
					date: Date.UTC(2023, 9, 1, 12),
					amount: 200000,
					currency: "PKR",
					title: "Instalment",
				},
			],
			{ total: 200000, currency: "PKR" }
		);

		const rows = sheetRows(
			buildFiscalReportWorkbook(makeSummary({ projectGroups: [mixed], projectGrandTotal: 200000 })),
			PLOTS_SHEET
		);

		expect(rows[1]).toEqual(["01/09/2023", 1000, "AED"]);
		expect(rows[2]).toEqual(["01/10/2023", 200000, "PKR"]);
		expect(rows[3]).toEqual(["TOTAL", 200000, "PKR"]);
	});

	it("appends plots manual entries to sheet two", () => {
		const rows = sheetRows(
			buildFiscalReportWorkbook(
				makeSummary({
					manualEntries: [
						makeManualEntry({ id: "m1", label: "Transfer fee", section: "plots", amount: 35000 }),
						makeManualEntry({ id: "m2", label: "Bank charge", section: "banks", amount: 500 }),
					],
				})
			),
			PLOTS_SHEET
		);

		expect(rows).toContainEqual(["Transfer fee", 35000, "PKR"]);
		expect(rows.some((row) => row[0] === "Bank charge")).toBe(false);
	});
});

// ─── Filename ────────────────────────────────────────────────────────────────

describe("buildFiscalReportFileName", () => {
	it("derives the filename from the range label", () => {
		expect(buildFiscalReportFileName(makeSummary())).toBe("MizanTrack-Report-2023-2024.xlsx");
	});

	it("sanitizes filesystem-hostile characters", () => {
		expect(buildFiscalReportFileName(makeSummary({ rangeLabel: "FY 2024/2025 *draft*" }))).toBe(
			"MizanTrack-Report-FY-2024-2025-draft.xlsx"
		);
	});

	it("falls back when the range label has no usable characters", () => {
		expect(buildFiscalReportFileName(makeSummary({ rangeLabel: "   " }))).toBe(
			"MizanTrack-Report-Report.xlsx"
		);
	});
});
