/**
 * Excel export for the zakat year, rebuilt to mirror the owner's `Zakat - All.xlsx`.
 *
 * The workbook is a live model, not a printout: every derived cell carries a real
 * formula (`.f`), so editing a month-end balance, a gold or silver price or a payment
 * inside Excel re-flows TOTAL → MINIMUM/MAXIMUM → GOLD/SILVER → ZAKAT → Total To Pay →
 * Balance/Excess exactly as the owner's hand-built sheets do. Cached values are
 * written alongside the formulas so viewers that do not recalculate still show the
 * same numbers MizanTrack shows.
 *
 * Nothing here converts currency and nothing here is a tax calculation: one sheet is
 * one zakat year in one currency, carried through exactly as recorded.
 */
import { format } from "date-fns";
import * as XLSX from "xlsx";

import { visibleZakatAccounts } from "@/lib/zakatAccountVisibility";
import { formatZakatMonthRange } from "@/lib/zakatEngine";

import type { ZakatBasis, ZakatYearGrid } from "@/lib/zakatEngine";

type CellValue = string | number | null;
type SheetRow = CellValue[];

interface FormulaCell {
	row: number;
	column: number;
	formula: string;
	value: number;
	numberFormat?: string;
}

/** One payment row; Person and Location are the owner's own payment columns. */
export interface ZakatExportPayment {
	amount: number;
	person?: string;
	location?: string;
	date?: number | Date;
	currency?: string;
	notes?: string;
}

/** Gold is priced per karat, with grams and price kept as separate editable inputs. */
export interface ZakatExportGoldRow {
	title?: string;
	purity: string;
	grams: number;
	pricePerGram: number;
}

/**
 * Silver is ONE weight at ONE price per gram — the single line the owner keeps — with
 * both kept as editable inputs so the sheet's value formula stays live.
 */
export interface ZakatExportSilver {
	grams?: number;
	pricePerGram?: number;
}

export interface ZakatExportYear {
	grid: ZakatYearGrid;
	/** The single currency this sheet is expressed in. Never converted. */
	currency: string;
	/** Which monthly total feeds the calculation. The workbook uses the minimum. */
	basis: ZakatBasis;
	/** Editable percentage, 2.5 by default; written to the sheet as a fraction. */
	ratePercent: number;
	goldRows?: ZakatExportGoldRow[];
	/** The year's silver. An empty block still reserves its row to type into. */
	silver?: ZakatExportSilver;
	/** Date the per-gram prices were taken on, typically 1 Ramaḍān. */
	goldPriceDate?: number | Date;
	/** Balance carried in from earlier years. Visible and editable in the sheet. */
	pastRemaining?: number;
	payments?: ZakatExportPayment[];
}

export interface ZakatExportParams {
	years: ZakatExportYear[];
}

const MONTH_COUNT = 12;
const FIRST_MONTH_COLUMN = 1; // B
const LAST_MONTH_COLUMN = FIRST_MONTH_COLUMN + MONTH_COUNT - 1; // M
const ACCOUNT_CURRENCY_COLUMN = 13; // N
const MINIMUM_COLUMN = 14; // O
const MAXIMUM_COLUMN = 15; // P
const GOLD_COLUMN = 16; // Q
const SILVER_COLUMN = 17; // R
const RATE_COLUMN = 18; // S
const TOTAL_COLUMN = 19; // T
const ZAKAT_COLUMN = 20; // U
const PER_MONTH_COLUMN = 21; // V

const TITLE_ROW = 0;
const ISLAMIC_YEAR_ROW = 1;
const RANGE_ROW = 2;
const HEADER_ROW = 3;
const FIRST_ACCOUNT_ROW = 4;

const GOLD_VALUE_COLUMN = 4; // E
const SILVER_VALUE_COLUMN = 4; // E — the silver block mirrors the gold block's columns
const PAYMENT_AMOUNT_COLUMN = 3; // D
const SUMMARY_VALUE_COLUMN = 1; // B

const RATE_NUMBER_FORMAT = "0.000%";
const MAX_SHEET_NAME_LENGTH = 31;
/** Excel rejects these in sheet names, and leading/trailing apostrophes. */
const FORBIDDEN_SHEET_NAME_CHARS = /[:\\/?*[\]]/g;

function cellRef(row: number, column: number): string {
	return XLSX.utils.encode_cell({ r: row, c: column });
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

function dateCell(value: number | Date | undefined): CellValue {
	if (value === undefined) return null;
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return format(date, "dd/MM/yyyy");
}

function finite(value: number | undefined): number {
	return value !== undefined && Number.isFinite(value) ? value : 0;
}

function setCell(rows: SheetRow[], row: number, column: number, value: CellValue): void {
	while (rows.length <= row) rows.push([]);
	const target = rows[row]!;
	while (target.length <= column) target.push(null);
	target[column] = value;
}

/**
 * Accounts and gold/payment lists can all be empty. Each block still reserves one row
 * so its `SUM` range stays valid and the owner has a line to type into by hand.
 */
function reservedRowCount(length: number): number {
	return Math.max(length, 1);
}

function accountLabel(account: ZakatYearGrid["accounts"][number]): string {
	return account.isArchived ? `${account.accountTitle} (Closed)` : account.accountTitle;
}

function goldRowLabel(goldRow: ZakatExportGoldRow): CellValue {
	return textCell(goldRow.title) ?? textCell(goldRow.purity ? `Gold ${goldRow.purity}` : undefined);
}

interface SheetLayout {
	lastAccountRow: number;
	totalRow: number;
	goldHeaderRow: number;
	firstGoldRow: number;
	lastGoldRow: number;
	goldTotalRow: number;
	silverHeaderRow: number;
	silverRow: number;
	paymentsTitleRow: number;
	paymentsHeaderRow: number;
	firstPaymentRow: number;
	lastPaymentRow: number;
	summaryTitleRow: number;
	summaryFirstRow: number;
}

function computeLayout(year: ZakatExportYear, accountCount: number): SheetLayout {
	const accountRows = reservedRowCount(accountCount);
	const goldRows = reservedRowCount(year.goldRows?.length ?? 0);
	const paymentRows = reservedRowCount(year.payments?.length ?? 0);

	const lastAccountRow = FIRST_ACCOUNT_ROW + accountRows - 1;
	const totalRow = lastAccountRow + 1;
	const goldHeaderRow = totalRow + 2;
	const firstGoldRow = goldHeaderRow + 1;
	const lastGoldRow = firstGoldRow + goldRows - 1;
	const goldTotalRow = lastGoldRow + 1;
	// Silver is one line, so its block is a header and a single row — reserved even for
	// a year that holds none, exactly as every other block reserves its row.
	const silverHeaderRow = goldTotalRow + 2;
	const silverRow = silverHeaderRow + 1;
	const paymentsTitleRow = silverRow + 2;
	const paymentsHeaderRow = paymentsTitleRow + 1;
	const firstPaymentRow = paymentsHeaderRow + 1;
	const lastPaymentRow = firstPaymentRow + paymentRows - 1;
	const summaryTitleRow = lastPaymentRow + 2;

	return {
		lastAccountRow,
		totalRow,
		goldHeaderRow,
		firstGoldRow,
		lastGoldRow,
		goldTotalRow,
		silverHeaderRow,
		silverRow,
		paymentsTitleRow,
		paymentsHeaderRow,
		firstPaymentRow,
		lastPaymentRow,
		summaryTitleRow,
		summaryFirstRow: summaryTitleRow + 1,
	};
}

/** Per-karat grams × price per gram, each kept as its own editable input cell. */
function buildGoldBlock(
	rows: SheetRow[],
	formulas: FormulaCell[],
	year: ZakatExportYear,
	layout: SheetLayout
): number {
	const goldRows = year.goldRows ?? [];

	setCell(rows, layout.goldHeaderRow, 0, "GOLD");
	setCell(rows, layout.goldHeaderRow, 1, "Karat");
	setCell(rows, layout.goldHeaderRow, 2, "Grams");
	setCell(rows, layout.goldHeaderRow, 3, `Price per gram (${year.currency})`);
	setCell(rows, layout.goldHeaderRow, GOLD_VALUE_COLUMN, "Value");
	setCell(rows, layout.goldHeaderRow, 5, "Priced on");

	let goldValue = 0;

	for (let index = 0; index < reservedRowCount(goldRows.length); index += 1) {
		const row = layout.firstGoldRow + index;
		const goldRow = goldRows[index];
		const grams = finite(goldRow?.grams);
		const pricePerGram = finite(goldRow?.pricePerGram);

		setCell(rows, row, 0, goldRow ? goldRowLabel(goldRow) : null);
		setCell(rows, row, 1, goldRow ? textCell(goldRow.purity) : null);
		setCell(rows, row, 2, grams);
		setCell(rows, row, 3, pricePerGram);
		setCell(rows, row, GOLD_VALUE_COLUMN, null);
		setCell(rows, row, 5, index === 0 ? dateCell(year.goldPriceDate) : null);

		formulas.push({
			row,
			column: GOLD_VALUE_COLUMN,
			formula: `PRODUCT(${cellRef(row, 2)},${cellRef(row, 3)})`,
			value: grams * pricePerGram,
		});

		goldValue += grams * pricePerGram;
	}

	setCell(rows, layout.goldTotalRow, 0, "GOLD TOTAL");
	setCell(rows, layout.goldTotalRow, GOLD_VALUE_COLUMN, null);
	formulas.push({
		row: layout.goldTotalRow,
		column: GOLD_VALUE_COLUMN,
		formula: `SUM(${cellRef(layout.firstGoldRow, GOLD_VALUE_COLUMN)}:${cellRef(layout.lastGoldRow, GOLD_VALUE_COLUMN)})`,
		value: goldValue,
	});

	return goldValue;
}

/**
 * The year's silver: grams and price per gram as editable inputs, value as a formula.
 *
 * The row is written even when the year holds none, so the owner has a line to type into
 * and the TOTAL formula always has a cell to read.
 */
function buildSilverBlock(
	rows: SheetRow[],
	formulas: FormulaCell[],
	year: ZakatExportYear,
	layout: SheetLayout
): number {
	const grams = finite(year.silver?.grams);
	const pricePerGram = finite(year.silver?.pricePerGram);

	setCell(rows, layout.silverHeaderRow, 0, "SILVER");
	setCell(rows, layout.silverHeaderRow, 2, "Grams");
	setCell(rows, layout.silverHeaderRow, 3, `Price per gram (${year.currency})`);
	setCell(rows, layout.silverHeaderRow, SILVER_VALUE_COLUMN, "Value");
	setCell(rows, layout.silverHeaderRow, 5, "Priced on");

	setCell(rows, layout.silverRow, 0, "Silver");
	setCell(rows, layout.silverRow, 2, grams);
	setCell(rows, layout.silverRow, 3, pricePerGram);
	setCell(rows, layout.silverRow, SILVER_VALUE_COLUMN, null);
	// Silver shares the gold block's priced-on date; the year has only the one.
	setCell(rows, layout.silverRow, 5, dateCell(year.goldPriceDate));

	formulas.push({
		row: layout.silverRow,
		column: SILVER_VALUE_COLUMN,
		formula: `PRODUCT(${cellRef(layout.silverRow, 2)},${cellRef(layout.silverRow, 3)})`,
		value: grams * pricePerGram,
	});

	return grams * pricePerGram;
}

/** Payment rows carry Person and Location, the two fields the owner records by hand. */ function buildPaymentsBlock(
	rows: SheetRow[],
	year: ZakatExportYear,
	layout: SheetLayout
): number {
	const payments = year.payments ?? [];

	setCell(rows, layout.paymentsTitleRow, 0, "PAYMENTS");
	setCell(rows, layout.paymentsHeaderRow, 0, "Date");
	setCell(rows, layout.paymentsHeaderRow, 1, "Person");
	setCell(rows, layout.paymentsHeaderRow, 2, "Location");
	setCell(rows, layout.paymentsHeaderRow, PAYMENT_AMOUNT_COLUMN, `Amount (${year.currency})`);
	setCell(rows, layout.paymentsHeaderRow, 4, "Currency");
	setCell(rows, layout.paymentsHeaderRow, 5, "Notes");

	let paid = 0;

	for (let index = 0; index < reservedRowCount(payments.length); index += 1) {
		const row = layout.firstPaymentRow + index;
		const payment = payments[index];

		setCell(rows, row, 0, dateCell(payment?.date));
		setCell(rows, row, 1, textCell(payment?.person));
		setCell(rows, row, 2, textCell(payment?.location));
		setCell(rows, row, PAYMENT_AMOUNT_COLUMN, payment ? finite(payment.amount) : null);
		setCell(rows, row, 4, payment ? (textCell(payment.currency) ?? year.currency) : null);
		setCell(rows, row, 5, textCell(payment?.notes));

		paid += finite(payment?.amount);
	}

	return paid;
}

interface SummaryInput {
	minimum: number;
	maximum: number;
	goldValue: number;
	silverValue: number;
	totalZakatable: number;
	zakatObligation: number;
	paid: number;
}

/**
 * The labelled stack the owner reads: every row points back at the computed cells on
 * the TOTAL row, so the whole chain stays live down to Balance/Excess.
 */
function buildSummaryBlock(
	rows: SheetRow[],
	formulas: FormulaCell[],
	year: ZakatExportYear,
	layout: SheetLayout,
	totals: SummaryInput
): void {
	const totalRow = layout.totalRow;
	const rate = finite(year.ratePercent) / 100;
	const pastRemaining = finite(year.pastRemaining);

	setCell(rows, layout.summaryTitleRow, 0, "SUMMARY");

	const minimumRow = layout.summaryFirstRow;
	const maximumRow = minimumRow + 1;
	const goldRow = maximumRow + 1;
	const silverRow = goldRow + 1;
	const basisRow = silverRow + 1;
	const totalZakatableRow = basisRow + 1;
	const rateRow = totalZakatableRow + 1;
	const zakatRow = rateRow + 1;
	const perMonthRow = zakatRow + 1;
	const pastRemainingRow = perMonthRow + 1;
	const totalToPayRow = pastRemainingRow + 1;
	const paidRow = totalToPayRow + 1;
	const balanceRow = paidRow + 1;

	const mirrored: Array<[number, string, number, number]> = [
		[minimumRow, "MINIMUM", MINIMUM_COLUMN, totals.minimum],
		[maximumRow, "MAXIMUM", MAXIMUM_COLUMN, totals.maximum],
		[goldRow, "GOLD", GOLD_COLUMN, totals.goldValue],
		[silverRow, "SILVER", SILVER_COLUMN, totals.silverValue],
		[totalZakatableRow, "TOTAL", TOTAL_COLUMN, totals.totalZakatable],
		[rateRow, "Rate", RATE_COLUMN, rate],
		[zakatRow, "ZAKAT", ZAKAT_COLUMN, totals.zakatObligation],
		[perMonthRow, "Per Month", PER_MONTH_COLUMN, totals.zakatObligation / MONTH_COUNT],
	];

	for (const [row, label, column, value] of mirrored) {
		setCell(rows, row, 0, label);
		setCell(rows, row, SUMMARY_VALUE_COLUMN, null);
		formulas.push({
			row,
			column: SUMMARY_VALUE_COLUMN,
			formula: cellRef(totalRow, column),
			value,
			numberFormat: column === RATE_COLUMN ? RATE_NUMBER_FORMAT : undefined,
		});
	}

	setCell(rows, basisRow, 0, "Basis");
	setCell(rows, basisRow, SUMMARY_VALUE_COLUMN, year.basis === "maximum" ? "MAXIMUM" : "MINIMUM");

	setCell(rows, pastRemainingRow, 0, "Past Remaining");
	setCell(rows, pastRemainingRow, SUMMARY_VALUE_COLUMN, pastRemaining);

	const totalToPay = totals.zakatObligation + pastRemaining;
	setCell(rows, totalToPayRow, 0, "Total To Pay");
	setCell(rows, totalToPayRow, SUMMARY_VALUE_COLUMN, null);
	formulas.push({
		row: totalToPayRow,
		column: SUMMARY_VALUE_COLUMN,
		formula: `SUM(${cellRef(zakatRow, SUMMARY_VALUE_COLUMN)},${cellRef(pastRemainingRow, SUMMARY_VALUE_COLUMN)})`,
		value: totalToPay,
	});

	setCell(rows, paidRow, 0, "Paid");
	setCell(rows, paidRow, SUMMARY_VALUE_COLUMN, null);
	formulas.push({
		row: paidRow,
		column: SUMMARY_VALUE_COLUMN,
		formula: `SUM(${cellRef(layout.firstPaymentRow, PAYMENT_AMOUNT_COLUMN)}:${cellRef(layout.lastPaymentRow, PAYMENT_AMOUNT_COLUMN)})`,
		value: totals.paid,
	});

	setCell(rows, balanceRow, 0, "Balance/Excess");
	setCell(rows, balanceRow, SUMMARY_VALUE_COLUMN, null);
	formulas.push({
		row: balanceRow,
		column: SUMMARY_VALUE_COLUMN,
		formula: `${cellRef(totalToPayRow, SUMMARY_VALUE_COLUMN)}-${cellRef(paidRow, SUMMARY_VALUE_COLUMN)}`,
		value: totalToPay - totals.paid,
	});
}

function buildYearSheet(year: ZakatExportYear): XLSX.WorkSheet {
	const { grid } = year;
	// The sheet shows the same rows the screen does: an account that was flat at zero all
	// year contributes nothing to the TOTAL SUM, so leaving it out moves no figure.
	const accounts = visibleZakatAccounts(grid.accounts);
	const layout = computeLayout(year, accounts.length);
	const rows: SheetRow[] = [];
	const formulas: FormulaCell[] = [];
	const months = grid.year.months.slice(0, MONTH_COUNT);

	setCell(rows, TITLE_ROW, 0, `Zakat ${grid.year.label}`);
	setCell(rows, TITLE_ROW, 1, "Currency");
	setCell(rows, TITLE_ROW, 2, textCell(year.currency));

	setCell(rows, ISLAMIC_YEAR_ROW, 0, "Islamic Year");
	setCell(rows, RANGE_ROW, 0, "Gregorian Range");
	setCell(rows, HEADER_ROW, 0, "Account");
	setCell(rows, HEADER_ROW, ACCOUNT_CURRENCY_COLUMN, "Currency");

	for (let index = 0; index < MONTH_COUNT; index += 1) {
		const column = FIRST_MONTH_COLUMN + index;
		const month = months[index];
		setCell(rows, ISLAMIC_YEAR_ROW, column, month ? month.islamicYear : null);
		setCell(rows, RANGE_ROW, column, month ? formatZakatMonthRange(month) : null);
		setCell(rows, HEADER_ROW, column, month ? month.month : null);
	}

	const summaryHeaders: Array<[number, string]> = [
		[MINIMUM_COLUMN, "MINIMUM"],
		[MAXIMUM_COLUMN, "MAXIMUM"],
		[GOLD_COLUMN, "GOLD"],
		[SILVER_COLUMN, "SILVER"],
		[RATE_COLUMN, "RATE"],
		[TOTAL_COLUMN, "TOTAL"],
		[ZAKAT_COLUMN, "ZAKAT"],
		[PER_MONTH_COLUMN, "Per Month"],
	];
	for (const [column, label] of summaryHeaders) setCell(rows, HEADER_ROW, column, label);

	for (let index = 0; index < reservedRowCount(accounts.length); index += 1) {
		const row = FIRST_ACCOUNT_ROW + index;
		const account = accounts[index];

		setCell(rows, row, 0, account ? accountLabel(account) : null);
		for (let monthIndex = 0; monthIndex < MONTH_COUNT; monthIndex += 1) {
			setCell(
				rows,
				row,
				FIRST_MONTH_COLUMN + monthIndex,
				numericCell(account?.balances[monthIndex])
			);
		}
		setCell(rows, row, ACCOUNT_CURRENCY_COLUMN, account ? textCell(account.currency) : null);
	}

	// TOTAL row: a plain sum of the account rows, liabilities included as negatives.
	const totalRow = layout.totalRow;
	setCell(rows, totalRow, 0, "TOTAL");
	const monthlyTotals: number[] = [];
	for (let index = 0; index < MONTH_COUNT; index += 1) {
		const column = FIRST_MONTH_COLUMN + index;
		const value = finite(grid.monthlyTotals[index]);
		monthlyTotals.push(value);
		setCell(rows, totalRow, column, null);
		formulas.push({
			row: totalRow,
			column,
			formula: `SUM(${cellRef(FIRST_ACCOUNT_ROW, column)}:${cellRef(layout.lastAccountRow, column)})`,
			value,
		});
	}

	const monthlyRange = `${cellRef(totalRow, FIRST_MONTH_COLUMN)}:${cellRef(totalRow, LAST_MONTH_COLUMN)}`;
	const minimum = Math.min(...monthlyTotals);
	const maximum = Math.max(...monthlyTotals);

	setCell(rows, totalRow, MINIMUM_COLUMN, null);
	formulas.push({
		row: totalRow,
		column: MINIMUM_COLUMN,
		formula: `MIN(${monthlyRange})`,
		value: minimum,
	});
	setCell(rows, totalRow, MAXIMUM_COLUMN, null);
	formulas.push({
		row: totalRow,
		column: MAXIMUM_COLUMN,
		formula: `MAX(${monthlyRange})`,
		value: maximum,
	});

	const goldValue = buildGoldBlock(rows, formulas, year, layout);
	setCell(rows, totalRow, GOLD_COLUMN, null);
	formulas.push({
		row: totalRow,
		column: GOLD_COLUMN,
		formula: cellRef(layout.goldTotalRow, GOLD_VALUE_COLUMN),
		value: goldValue,
	});

	const silverValue = buildSilverBlock(rows, formulas, year, layout);
	setCell(rows, totalRow, SILVER_COLUMN, null);
	formulas.push({
		row: totalRow,
		column: SILVER_COLUMN,
		formula: cellRef(layout.silverRow, SILVER_VALUE_COLUMN),
		value: silverValue,
	});

	const rate = finite(year.ratePercent) / 100;
	setCell(rows, totalRow, RATE_COLUMN, rate);

	const basisColumn = year.basis === "maximum" ? MAXIMUM_COLUMN : MINIMUM_COLUMN;
	const basisAmount = year.basis === "maximum" ? maximum : minimum;
	const totalZakatable = basisAmount + goldValue + silverValue;
	setCell(rows, totalRow, TOTAL_COLUMN, null);
	formulas.push({
		row: totalRow,
		column: TOTAL_COLUMN,
		formula: `SUM(${cellRef(totalRow, basisColumn)},${cellRef(totalRow, GOLD_COLUMN)},${cellRef(totalRow, SILVER_COLUMN)})`,
		value: totalZakatable,
	});

	const zakatObligation = totalZakatable * rate;
	setCell(rows, totalRow, ZAKAT_COLUMN, null);
	formulas.push({
		row: totalRow,
		column: ZAKAT_COLUMN,
		formula: `PRODUCT(${cellRef(totalRow, TOTAL_COLUMN)},${cellRef(totalRow, RATE_COLUMN)})`,
		value: zakatObligation,
	});

	setCell(rows, totalRow, PER_MONTH_COLUMN, null);
	formulas.push({
		row: totalRow,
		column: PER_MONTH_COLUMN,
		formula: `${cellRef(totalRow, ZAKAT_COLUMN)}/${MONTH_COUNT}`,
		value: zakatObligation / MONTH_COUNT,
	});

	const paid = buildPaymentsBlock(rows, year, layout);

	buildSummaryBlock(rows, formulas, year, layout, {
		minimum,
		maximum,
		goldValue,
		silverValue,
		totalZakatable,
		zakatObligation,
		paid,
	});

	const sheet = XLSX.utils.aoa_to_sheet(rows);

	let lastRow = rows.length - 1;
	let lastColumn = 0;
	for (const row of rows) lastColumn = Math.max(lastColumn, row.length - 1);

	for (const cell of formulas) {
		sheet[cellRef(cell.row, cell.column)] = {
			t: "n",
			v: cell.value,
			f: cell.formula,
			...(cell.numberFormat ? { z: cell.numberFormat } : {}),
		};
		lastRow = Math.max(lastRow, cell.row);
		lastColumn = Math.max(lastColumn, cell.column);
	}

	sheet["!ref"] = XLSX.utils.encode_range({
		s: { r: 0, c: 0 },
		e: { r: Math.max(lastRow, 0), c: Math.max(lastColumn, 0) },
	});

	return sheet;
}

/** Excel sheet names: no `:\/?*[]`, 31 characters at most, and unique per workbook. */
function sheetNameFor(year: ZakatExportYear, used: Set<string>): string {
	const cleaned = year.grid.year.label
		.replace(FORBIDDEN_SHEET_NAME_CHARS, "-")
		.replace(/^'+|'+$/g, "")
		.trim();
	const base = (cleaned || String(year.grid.year.sheetYear) || "Zakat").slice(
		0,
		MAX_SHEET_NAME_LENGTH
	);

	let candidate = base;
	let suffix = 2;
	while (used.has(candidate)) {
		const tag = ` (${suffix})`;
		candidate = `${base.slice(0, MAX_SHEET_NAME_LENGTH - tag.length)}${tag}`;
		suffix += 1;
	}

	used.add(candidate);
	return candidate;
}

/**
 * Pure and DOM-free: one sheet per Ramaḍān year, accounts as rows, Islamic months in
 * `B:M`, and every derived cell carrying a formula.
 */
export function buildZakatWorkbook(params: ZakatExportParams): XLSX.WorkBook {
	const workbook = XLSX.utils.book_new();
	const used = new Set<string>();
	const years = params.years ?? [];

	if (years.length === 0) {
		XLSX.utils.book_append_sheet(
			workbook,
			XLSX.utils.aoa_to_sheet([["No zakat years selected"]]),
			"Zakat"
		);
		return workbook;
	}

	for (const year of years) {
		XLSX.utils.book_append_sheet(workbook, buildYearSheet(year), sheetNameFor(year, used));
	}

	return workbook;
}

/** Pure and DOM-free: e.g. one year → "MizanTrack-Zakat-2024.xlsx". */
export function buildZakatFileName(params: ZakatExportParams): string {
	const sheetYears = (params.years ?? [])
		.map((year) => year.grid.year.sheetYear)
		.filter((sheetYear) => Number.isFinite(sheetYear))
		.sort((first, second) => first - second);

	if (sheetYears.length === 0) return "MizanTrack-Zakat.xlsx";

	const first = sheetYears[0];
	const last = sheetYears[sheetYears.length - 1];

	return first === last
		? `MizanTrack-Zakat-${first}.xlsx`
		: `MizanTrack-Zakat-${first}-${last}.xlsx`;
}

/** Browser-only: builds the workbook fresh and triggers the download. Persists nothing. */
export function exportZakat(params: ZakatExportParams): void {
	XLSX.writeFile(buildZakatWorkbook(params), buildZakatFileName(params));
}
