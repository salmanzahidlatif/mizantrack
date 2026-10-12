/**
 * Excel export for the fiscal report. Everything here is derived at runtime from the
 * summary handed in — nothing is persisted, cached or recomputed, and no tax figure is
 * ever calculated: amounts are copied through exactly as the user entered or recorded them.
 * The summary is already scoped to one currency, so the workbook carries that currency only.
 */
import { addMonths, format } from "date-fns";
import * as XLSX from "xlsx";

import type {
	FiscalReportSummary,
	ReportManualEntry,
	ReportMonthlySalaryRow,
	ReportProjectGroup,
} from "@/types";

const BANKS_SHEET_NAME = "Banks & Salaries";
const PLOTS_SHEET_NAME = "Plot Payments";
const FISCAL_MONTH_COUNT = 12;

type CellValue = string | number | null;
type SheetRow = CellValue[];

function formatDate(ms: number | undefined): CellValue {
	if (ms === undefined || !Number.isFinite(ms)) return null;
	return format(new Date(ms), "dd/MM/yyyy");
}

function numericCell(value: number | undefined): CellValue {
	if (value === undefined || !Number.isFinite(value)) return null;
	return value;
}

function textCell(value: string | undefined): CellValue {
	const trimmed = value?.trim();
	if (!trimmed) return null;
	return trimmed;
}

function monthKeyOf(date: Date): string {
	return format(date, "yyyy-MM");
}

/**
 * Fiscal month columns: the 12 months starting at the report range start, plus any
 * stray month present on a salary row but outside that span (never dropped silently).
 */
function resolveMonthKeys(summary: FiscalReportSummary): string[] {
	const keys: string[] = [];
	const seen = new Set<string>();
	const start = new Date(summary.fromMs);

	if (Number.isFinite(summary.fromMs)) {
		for (let index = 0; index < FISCAL_MONTH_COUNT; index += 1) {
			const key = monthKeyOf(addMonths(start, index));
			keys.push(key);
			seen.add(key);
		}
	}

	const extras = summary.monthlySalaryRows
		.map((row) => row.monthKey)
		.filter((key) => Boolean(key) && !seen.has(key));

	for (const key of [...new Set(extras)].sort()) keys.push(key);

	return keys;
}

function monthLabel(monthKey: string): string {
	const [yearPart, monthPart] = monthKey.split("-");
	const year = Number(yearPart);
	const month = Number(monthPart);
	if (!Number.isFinite(year) || !Number.isFinite(month)) return monthKey;
	return format(new Date(year, month - 1, 1), "MMM yyyy");
}

function buildSalaryBlock(summary: FiscalReportSummary): SheetRow[] {
	if (summary.monthlySalaryRows.length === 0) return [];

	const monthKeys = resolveMonthKeys(summary);
	const rowByMonthKey = new Map<string, ReportMonthlySalaryRow>();
	for (const row of summary.monthlySalaryRows) rowByMonthKey.set(row.monthKey, row);

	const valuesFor = (pick: (row: ReportMonthlySalaryRow) => CellValue): SheetRow =>
		monthKeys.map((key) => {
			const row = rowByMonthKey.get(key);
			return row ? pick(row) : null;
		});

	return [
		["Category / Month", ...monthKeys.map(monthLabel)],
		["Company", ...valuesFor((row) => textCell(row.company))],
		["Salary (PKR)", ...valuesFor((row) => numericCell(row.salaryPkr))],
		["Salary (USD)", ...valuesFor((row) => numericCell(row.salaryUsd))],
		["Taxable (PKR)", ...valuesFor((row) => numericCell(row.taxablePkr))],
		["Provident Fund Refund", ...valuesFor((row) => numericCell(row.providentFundRefund))],
	];
}

function buildClosingBalanceBlock(summary: FiscalReportSummary): SheetRow[] {
	const rows: SheetRow[] = [["Closing Balances"], ["Account", "Closing Balance", "Currency"]];

	for (const balance of summary.accountBalances) {
		rows.push([
			balance.isArchived ? `${balance.title} (Closed)` : balance.title,
			numericCell(balance.closingBalance),
			textCell(balance.currency),
		]);
	}

	return rows;
}

/** The engine totals in a single currency only; a mixed set is left blank and warned about. */
function singleCurrency(entries: ReadonlyArray<{ currency: string }>): CellValue {
	const currencies = new Set(entries.map((entry) => entry.currency).filter(Boolean));
	if (currencies.size !== 1) return null;
	const [only] = currencies;
	return only ?? null;
}

function buildRemittanceBlock(summary: FiscalReportSummary): SheetRow[] {
	const rows: SheetRow[] = [["Remittances"], ["Date", "Title", "Amount", "Currency"]];

	for (const remittance of summary.remittances) {
		rows.push([
			formatDate(remittance.date),
			textCell(remittance.title),
			numericCell(remittance.amount),
			textCell(remittance.currency),
		]);
	}

	rows.push([
		"Total",
		null,
		numericCell(summary.remittanceTotal),
		singleCurrency(summary.remittances),
	]);

	return rows;
}

function buildIncomeBlock(summary: FiscalReportSummary): SheetRow[] {
	const rows: SheetRow[] = [["Incomes"], ["Date", "Title", "Amount", "Currency"]];

	for (const income of summary.incomes) {
		rows.push([
			formatDate(income.date),
			textCell(income.title),
			numericCell(income.amount),
			textCell(income.currency),
		]);
	}

	rows.push(["Total", null, numericCell(summary.incomeTotal), singleCurrency(summary.incomes)]);

	return rows;
}

function buildManualEntryBlock(entries: ReportManualEntry[]): SheetRow[] {
	if (entries.length === 0) return [];

	const rows: SheetRow[] = [["Manual Entries"], ["Label", "Amount", "Currency", "Date", "Note"]];

	for (const entry of entries) {
		rows.push([
			textCell(entry.label),
			numericCell(entry.amount),
			textCell(entry.currency),
			formatDate(entry.date),
			textCell(entry.note),
		]);
	}

	return rows;
}

function buildWarningBlock(summary: FiscalReportSummary): SheetRow[] {
	if (summary.warnings.length === 0) return [];
	return [["Warnings"], ...summary.warnings.map((warning): SheetRow => [warning])];
}

function appendBlock(rows: SheetRow[], block: SheetRow[]): void {
	if (block.length === 0) return;
	if (rows.length > 0) rows.push([]);
	rows.push(...block);
}

function buildBanksSheetRows(summary: FiscalReportSummary): SheetRow[] {
	const manualEntries = summary.manualEntries.filter(
		(entry) => entry.section === "banks" || entry.section === "other"
	);

	const rows: SheetRow[] = [];
	appendBlock(rows, buildSalaryBlock(summary));
	appendBlock(rows, buildClosingBalanceBlock(summary));
	appendBlock(rows, buildRemittanceBlock(summary));
	appendBlock(rows, buildIncomeBlock(summary));
	appendBlock(rows, buildManualEntryBlock(manualEntries));
	appendBlock(rows, buildWarningBlock(summary));

	return rows;
}

function buildProjectBlock(group: ReportProjectGroup): SheetRow[] {
	const rows: SheetRow[] = [[group.project.title, textCell(group.project.note)]];

	for (const payment of group.payments) {
		rows.push([
			formatDate(payment.date),
			numericCell(payment.amount),
			textCell(payment.currency),
			textCell(payment.note),
		]);
	}

	rows.push(["TOTAL", numericCell(group.total), textCell(group.currency)]);

	return rows;
}

function buildPlotsSheetRows(summary: FiscalReportSummary): SheetRow[] {
	const rows: SheetRow[] = [];

	for (const group of summary.projectGroups) appendBlock(rows, buildProjectBlock(group));

	appendBlock(rows, [["All Total", numericCell(summary.projectGrandTotal)]]);
	appendBlock(
		rows,
		buildManualEntryBlock(summary.manualEntries.filter((entry) => entry.section === "plots"))
	);

	return rows;
}

/** Pure and DOM-free: builds the two-sheet workbook mirroring the user's Details.xlsx. */
export function buildFiscalReportWorkbook(summary: FiscalReportSummary): XLSX.WorkBook {
	const workbook = XLSX.utils.book_new();

	XLSX.utils.book_append_sheet(
		workbook,
		XLSX.utils.aoa_to_sheet(buildBanksSheetRows(summary)),
		BANKS_SHEET_NAME
	);
	XLSX.utils.book_append_sheet(
		workbook,
		XLSX.utils.aoa_to_sheet(buildPlotsSheetRows(summary)),
		PLOTS_SHEET_NAME
	);

	return workbook;
}

/** Pure and DOM-free: e.g. "2023 - 2024" → "MizanTrack-Report-2023-2024.xlsx". */
export function buildFiscalReportFileName(summary: FiscalReportSummary): string {
	const sanitized = summary.rangeLabel
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "");

	return `MizanTrack-Report-${sanitized || "Report"}.xlsx`;
}

/** Browser-only: builds the workbook fresh and triggers the download. Persists nothing. */
export function exportFiscalReport(summary: FiscalReportSummary): void {
	XLSX.writeFile(buildFiscalReportWorkbook(summary), buildFiscalReportFileName(summary));
}
