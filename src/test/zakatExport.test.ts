/**
 * Excel export for the zakat year. The workbook must be a live model of the owner's
 * `Zakat - All.xlsx`: every derived cell carries a real formula, so these tests assert
 * on `.f` as well as on the cached values.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { buildZakatFileName, buildZakatWorkbook } from "@/lib/zakatExport";

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

function makeYearDefinition(sheetYear: number, islamicYear: number): ZakatYearDefinition {
	return {
		sheetYear,
		islamicYear,
		zakatYear: `${islamicYear}-${islamicYear + 1}`,
		label: `${sheetYear} (${islamicYear}–${islamicYear + 1})`,
		ramadanSource: "announced",
		months: ISLAMIC_MONTH_NAMES.map((month, index) => ({
			month,
			// The Hijri year rolls over at al-Muḥarram, the fifth column.
			islamicYear: index < 4 ? islamicYear : islamicYear + 1,
			startDate: new Date(Date.UTC(sheetYear - 1, 2, 24 + index * 29, 12)),
			endDate: new Date(Date.UTC(sheetYear - 1, 2, 24 + index * 29 + 28, 12)),
		})),
	};
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

function makeGrid(
	accounts: ZakatAccountMonthBalance[],
	yearDefinition = makeYearDefinition(2024, 1444)
): ZakatYearGrid {
	const monthlyTotals = Array.from({ length: 12 }, (_unused, index) =>
		accounts.reduce((sum, account) => sum + (account.balances[index] ?? 0), 0)
	);

	return {
		year: yearDefinition,
		accounts,
		monthlyTotals,
		minimum: monthlyTotals.length > 0 ? Math.min(...monthlyTotals) : 0,
		maximum: monthlyTotals.length > 0 ? Math.max(...monthlyTotals) : 0,
	};
}

function makeYear(overrides: Partial<ZakatExportYear> = {}): ZakatExportYear {
	return {
		grid: makeGrid([
			makeAccount(
				"meezan",
				"Meezan (Default)",
				[100, 200, 300, 400, 500, 600, 700, 800, 900, 1000, 1100, 1200]
			),
			makeAccount(
				"papa",
				"Loan <-- (Papa)",
				[-10, -10, -10, -10, -10, -10, -10, -10, -10, -10, -10, -10]
			),
		]),
		currency: "PKR",
		basis: "minimum",
		ratePercent: 2.5,
		goldRows: [{ purity: "21k", grams: 170.52, pricePerGram: 18846.3 }],
		pastRemaining: 0,
		payments: [],
		...overrides,
	};
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sheetOf(workbook: XLSX.WorkBook, sheetName: string): XLSX.WorkSheet {
	const sheet = workbook.Sheets[sheetName];
	expect(sheet, `Expected a "${sheetName}" sheet`).toBeDefined();
	return sheet!;
}

function sheetRows(sheet: XLSX.WorkSheet): unknown[][] {
	return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true });
}

function cell(sheet: XLSX.WorkSheet, ref: string): XLSX.CellObject {
	const found = sheet[ref] as XLSX.CellObject | undefined;
	expect(found, `Expected a cell at ${ref}`).toBeDefined();
	return found!;
}

function formulaAt(sheet: XLSX.WorkSheet, ref: string): string {
	const found = cell(sheet, ref);
	expect(found.f, `Expected cell ${ref} to carry a formula`).toBeDefined();
	return found.f ?? "";
}

/** Row index (1-based, as in Excel) of the summary row with the given label. */
function summaryRowNumber(sheet: XLSX.WorkSheet, label: string): number {
	const rows = sheetRows(sheet);
	const summaryStart = rows.findIndex((row) => row[0] === "SUMMARY");
	expect(summaryStart, "Expected a SUMMARY block").toBeGreaterThan(-1);

	const offset = rows.slice(summaryStart).findIndex((row) => row[0] === label);
	expect(offset, `Expected a summary row labelled "${label}"`).toBeGreaterThan(-1);
	return summaryStart + offset + 1;
}

function summaryValue(sheet: XLSX.WorkSheet, label: string): unknown {
	return cell(sheet, `B${summaryRowNumber(sheet, label)}`).v;
}

// ─── Workbook shape ──────────────────────────────────────────────────────────

describe("buildZakatWorkbook", () => {
	it("writes one sheet per Ramaḍān year, named after the year label", () => {
		const workbook = buildZakatWorkbook({
			years: [
				makeYear(),
				makeYear({
					grid: makeGrid([makeAccount("cash", "Cash", [5])], makeYearDefinition(2023, 1443)),
				}),
			],
		});

		expect(workbook.SheetNames).toEqual(["2024 (1444–1445)", "2023 (1443–1444)"]);
	});

	it("keeps sheet names inside Excel's 31-character limit and strips forbidden characters", () => {
		const definition = makeYearDefinition(2024, 1444);
		definition.label = "2024 [Ramaḍān]/Shaʿbān: a very long sheet label";

		const workbook = buildZakatWorkbook({
			years: [makeYear({ grid: makeGrid([makeAccount("cash", "Cash", [5])], definition) })],
		});

		const [name] = workbook.SheetNames;
		expect(name).toBeDefined();
		expect(name!.length).toBeLessThanOrEqual(31);
		expect(name).not.toMatch(/[:\\/?*[\]]/);
	});

	it("disambiguates sheets that would otherwise share a name", () => {
		const workbook = buildZakatWorkbook({ years: [makeYear(), makeYear()] });

		expect(workbook.SheetNames).toHaveLength(2);
		expect(new Set(workbook.SheetNames).size).toBe(2);
	});

	it("does not throw on an empty year and still produces a usable sheet", () => {
		const workbook = buildZakatWorkbook({
			years: [
				makeYear({
					grid: makeGrid([]),
					goldRows: [],
					payments: [],
				}),
			],
		});

		const sheet = sheetOf(workbook, "2024 (1444–1445)");
		// Zero accounts still reserve one editable row, so the TOTAL SUM stays valid.
		expect(formulaAt(sheet, "B6")).toBe("SUM(B5:B5)");
		expect(summaryValue(sheet, "Balance/Excess")).toBe(0);
	});

	it("does not throw when no years are supplied", () => {
		const workbook = buildZakatWorkbook({ years: [] });
		expect(workbook.SheetNames).toHaveLength(1);
	});

	// ─── Grid layout ───────────────────────────────────────────────────────────

	it("lays the Islamic months across B:M with their Gregorian ranges in the header", () => {
		const workbook = buildZakatWorkbook({ years: [makeYear()] });
		const sheet = sheetOf(workbook, "2024 (1444–1445)");
		const rows = sheetRows(sheet);

		expect(rows[0]?.[0]).toBe("Zakat 2024 (1444–1445)");
		expect(rows[0]?.[2]).toBe("PKR");
		// Hijri year rolls over at al-Muḥarram, the fifth month column.
		expect(rows[1]?.slice(1, 13)).toEqual([
			1444, 1444, 1444, 1444, 1445, 1445, 1445, 1445, 1445, 1445, 1445, 1445,
		]);
		expect(rows[3]?.slice(1, 13)).toEqual(ISLAMIC_MONTH_NAMES);
		expect(cell(sheet, "B3").v).toBe("24 Mar - 21 Apr");
		expect(typeof cell(sheet, "M3").v).toBe("string");
	});

	it("writes accounts as rows with numeric month-end balances", () => {
		const workbook = buildZakatWorkbook({ years: [makeYear()] });
		const sheet = sheetOf(workbook, "2024 (1444–1445)");

		expect(cell(sheet, "A5").v).toBe("Meezan (Default)");
		expect(cell(sheet, "B5").v).toBe(100);
		expect(cell(sheet, "B5").t).toBe("n");
		expect(cell(sheet, "M5").v).toBe(1200);
		expect(cell(sheet, "N5").v).toBe("PKR");

		// Liabilities stay negative and are summed with the assets, as the owner does.
		expect(cell(sheet, "A6").v).toBe("Loan <-- (Papa)");
		expect(cell(sheet, "B6").v).toBe(-10);
	});

	it("marks archived accounts without guessing their sign", () => {
		const workbook = buildZakatWorkbook({
			years: [
				makeYear({
					grid: makeGrid([makeAccount("alfalah", "Alfalah", [1, 2, 3], { isArchived: true })]),
				}),
			],
		});
		const sheet = sheetOf(workbook, "2024 (1444–1445)");

		expect(cell(sheet, "A5").v).toBe("Alfalah (Closed)");
	});

	// ─── Formulas ──────────────────────────────────────────────────────────────

	it("totals each month with a SUM over the account rows", () => {
		const workbook = buildZakatWorkbook({ years: [makeYear()] });
		const sheet = sheetOf(workbook, "2024 (1444–1445)");

		expect(formulaAt(sheet, "B7")).toBe("SUM(B5:B6)");
		expect(formulaAt(sheet, "M7")).toBe("SUM(M5:M6)");
		expect(cell(sheet, "A7").v).toBe("TOTAL");
		expect(cell(sheet, "B7").v).toBe(90);
	});

	it("spans MINIMUM and MAXIMUM over the twelve monthly totals", () => {
		const workbook = buildZakatWorkbook({ years: [makeYear()] });
		const sheet = sheetOf(workbook, "2024 (1444–1445)");

		expect(formulaAt(sheet, "O7")).toBe("MIN(B7:M7)");
		expect(formulaAt(sheet, "P7")).toBe("MAX(B7:M7)");
		expect(cell(sheet, "O7").v).toBe(90);
		expect(cell(sheet, "P7").v).toBe(1190);
	});

	it("values gold from editable grams and per-karat price cells", () => {
		const workbook = buildZakatWorkbook({
			years: [
				makeYear({
					goldRows: [
						{ purity: "21k", grams: 170.52, pricePerGram: 18846.3 },
						{ purity: "22k", grams: 10, pricePerGram: 19000 },
					],
					goldPriceDate: Date.UTC(2024, 2, 24, 12),
				}),
			],
		});
		const sheet = sheetOf(workbook, "2024 (1444–1445)");

		expect(cell(sheet, "A9").v).toBe("GOLD");
		expect(cell(sheet, "C10").v).toBe(170.52);
		expect(cell(sheet, "D10").v).toBe(18846.3);
		expect(cell(sheet, "F10").v).toBe("24/03/2024");
		expect(formulaAt(sheet, "E10")).toBe("PRODUCT(C10,D10)");
		expect(formulaAt(sheet, "E11")).toBe("PRODUCT(C11,D11)");
		expect(formulaAt(sheet, "E12")).toBe("SUM(E10:E11)");
		expect(cell(sheet, "A12").v).toBe("GOLD TOTAL");
		// The TOTAL row's GOLD cell reads the gold block, so editing grams re-flows.
		expect(formulaAt(sheet, "Q7")).toBe("E12");
		expect(cell(sheet, "Q7").v).toBeCloseTo(170.52 * 18846.3 + 190000, 4);
	});

	it("chains TOTAL → ZAKAT → Per Month from the basis, gold and rate cells", () => {
		const workbook = buildZakatWorkbook({ years: [makeYear()] });
		const sheet = sheetOf(workbook, "2024 (1444–1445)");

		expect(cell(sheet, "S7").v).toBe(0.025);
		expect(formulaAt(sheet, "T7")).toBe("SUM(O7,Q7,R7)");
		expect(formulaAt(sheet, "U7")).toBe("PRODUCT(T7,S7)");
		expect(formulaAt(sheet, "V7")).toBe("U7/12");
		expect(cell(sheet, "T7").v).toBeCloseTo(90 + 170.52 * 18846.3, 4);
	});

	it("feeds the maximum into TOTAL when the maximum basis is selected", () => {
		const workbook = buildZakatWorkbook({ years: [makeYear({ basis: "maximum" })] });
		const sheet = sheetOf(workbook, "2024 (1444–1445)");

		expect(formulaAt(sheet, "T7")).toBe("SUM(P7,Q7,R7)");
		expect(summaryValue(sheet, "Basis")).toBe("MAXIMUM");
	});

	it("mirrors every summary field back to the computed cells", () => {
		const workbook = buildZakatWorkbook({ years: [makeYear()] });
		const sheet = sheetOf(workbook, "2024 (1444–1445)");

		expect(formulaAt(sheet, `B${summaryRowNumber(sheet, "MINIMUM")}`)).toBe("O7");
		expect(formulaAt(sheet, `B${summaryRowNumber(sheet, "MAXIMUM")}`)).toBe("P7");
		expect(formulaAt(sheet, `B${summaryRowNumber(sheet, "GOLD")}`)).toBe("Q7");
		expect(formulaAt(sheet, `B${summaryRowNumber(sheet, "Rate")}`)).toBe("S7");
		expect(formulaAt(sheet, `B${summaryRowNumber(sheet, "ZAKAT")}`)).toBe("U7");
		expect(formulaAt(sheet, `B${summaryRowNumber(sheet, "Per Month")}`)).toBe("V7");
	});

	it("chains ZAKAT → Total To Pay → Balance/Excess through real cell references", () => {
		const workbook = buildZakatWorkbook({
			years: [
				makeYear({
					pastRemaining: 88058,
					payments: [{ amount: 100000, person: "Masjid", location: "Lahore" }],
				}),
			],
		});
		const sheet = sheetOf(workbook, "2024 (1444–1445)");

		const zakatRow = summaryRowNumber(sheet, "ZAKAT");
		const pastRow = summaryRowNumber(sheet, "Past Remaining");
		const totalToPayRow = summaryRowNumber(sheet, "Total To Pay");
		const paidRow = summaryRowNumber(sheet, "Paid");
		const balanceRow = summaryRowNumber(sheet, "Balance/Excess");

		expect(cell(sheet, `B${pastRow}`).v).toBe(88058);
		expect(formulaAt(sheet, `B${totalToPayRow}`)).toBe(`SUM(B${zakatRow},B${pastRow})`);
		expect(formulaAt(sheet, `B${paidRow}`)).toMatch(/^SUM\(D\d+:D\d+\)$/);
		expect(formulaAt(sheet, `B${balanceRow}`)).toBe(`B${totalToPayRow}-B${paidRow}`);
		expect(cell(sheet, `B${paidRow}`).v).toBe(100000);
	});

	it("keeps an overpayment negative in Balance/Excess", () => {
		const workbook = buildZakatWorkbook({
			years: [
				makeYear({
					pastRemaining: 1000,
					payments: [{ amount: 500000, person: "Masjid", location: "Lahore" }],
				}),
			],
		});
		const sheet = sheetOf(workbook, "2024 (1444–1445)");

		expect(summaryValue(sheet, "Balance/Excess")).toBeLessThan(0);
	});

	// ─── Payments ──────────────────────────────────────────────────────────────

	it("renders payments with person, location, amount and date", () => {
		const workbook = buildZakatWorkbook({
			years: [
				makeYear({
					payments: [
						{
							amount: 25000,
							person: "Huma Bajo",
							location: "Bahawalpur",
							date: Date.UTC(2024, 0, 15, 12),
							currency: "PKR",
							notes: "First instalment",
						},
						{ amount: 15000, person: "Umer", location: "Lahore" },
					],
				}),
			],
		});
		const sheet = sheetOf(workbook, "2024 (1444–1445)");
		const rows = sheetRows(sheet);
		const headerIndex = rows.findIndex((row) => row[0] === "Date" && row[1] === "Person");

		expect(headerIndex).toBeGreaterThan(-1);
		expect(rows[headerIndex]?.slice(0, 6)).toEqual([
			"Date",
			"Person",
			"Location",
			"Amount (PKR)",
			"Currency",
			"Notes",
		]);
		expect(rows[headerIndex + 1]?.slice(0, 6)).toEqual([
			"15/01/2024",
			"Huma Bajo",
			"Bahawalpur",
			25000,
			"PKR",
			"First instalment",
		]);
		expect(rows[headerIndex + 2]?.[1]).toBe("Umer");
		expect(rows[headerIndex + 2]?.[3]).toBe(15000);
		expect(summaryValue(sheet, "Paid")).toBe(40000);
	});

	it("never converts currency between accounts and payments", () => {
		const workbook = buildZakatWorkbook({
			years: [
				makeYear({
					currency: "AED",
					payments: [{ amount: 100, person: "Masjid", location: "Dubai", currency: "AED" }],
				}),
			],
		});
		const sheet = sheetOf(workbook, "2024 (1444–1445)");
		const rows = sheetRows(sheet);
		const headerIndex = rows.findIndex((row) => row[0] === "Date" && row[1] === "Person");

		expect(cell(sheet, "C1").v).toBe("AED");
		// The account rows keep their own recorded currency, untouched.
		expect(cell(sheet, "N5").v).toBe("PKR");
		expect(rows[headerIndex + 1]?.[4]).toBe("AED");
	});

	// ─── Round trip ────────────────────────────────────────────────────────────

	it("reproduces the owner's 2024 worked example end to end", () => {
		// docs/zakat-requirements-2026-10.md section 8.
		const monthlyTotals = [
			2896066.15, 2825829.58, 2628184.68, 3088959.26, 3370369.84, 3313488.09, 3308746.12,
			3017848.84, 3042484.54, 3048899.44, 2957655.34, 2788758.33,
		];
		const workbook = buildZakatWorkbook({
			years: [
				makeYear({
					grid: makeGrid([makeAccount("meezan", "Meezan (Default)", monthlyTotals)]),
					goldRows: [{ purity: "21k", grams: 170.52, pricePerGram: 18846.3 }],
					pastRemaining: 88058,
					payments: [{ amount: 285500, person: "Masjid", location: "Lahore" }],
				}),
			],
		});
		const sheet = sheetOf(workbook, "2024 (1444–1445)");

		expect(cell(sheet, "O6").v).toBeCloseTo(2628184.68, 2);
		expect(cell(sheet, "P6").v).toBeCloseTo(3370369.84, 2);
		expect(cell(sheet, "Q6").v).toBeCloseTo(3213671.076, 3);
		expect(cell(sheet, "T6").v).toBeCloseTo(5841855.756, 3);
		expect(cell(sheet, "U6").v).toBeCloseTo(146046.3939, 4);
		expect(cell(sheet, "V6").v).toBeCloseTo(12170.53283, 5);
		expect(summaryValue(sheet, "Total To Pay")).toBeCloseTo(234104.3939, 4);
		expect(summaryValue(sheet, "Paid")).toBe(285500);
		expect(summaryValue(sheet, "Balance/Excess")).toBeCloseTo(-51395.6061, 4);
	});

	it("keeps formulas after a write/read round trip", () => {
		const workbook = buildZakatWorkbook({ years: [makeYear()] });
		const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
		const reread = XLSX.read(buffer, { type: "buffer", cellFormula: true });
		const sheet = sheetOf(reread, "2024 (1444–1445)");

		expect(formulaAt(sheet, "B7")).toBe("SUM(B5:B6)");
		expect(formulaAt(sheet, "O7")).toBe("MIN(B7:M7)");
		expect(formulaAt(sheet, "U7")).toBe("PRODUCT(T7,S7)");
	});
});

// ─── File name ───────────────────────────────────────────────────────────────

describe("buildZakatFileName", () => {
	it("names a single-year export after that year", () => {
		expect(buildZakatFileName({ years: [makeYear()] })).toBe("MizanTrack-Zakat-2024.xlsx");
	});

	it("spans the range when several years are exported", () => {
		const fileName = buildZakatFileName({
			years: [
				makeYear(),
				makeYear({
					grid: makeGrid([makeAccount("cash", "Cash", [5])], makeYearDefinition(2021, 1441)),
				}),
			],
		});

		expect(fileName).toBe("MizanTrack-Zakat-2021-2024.xlsx");
	});

	it("falls back to a plain name when there is nothing to export", () => {
		expect(buildZakatFileName({ years: [] })).toBe("MizanTrack-Zakat.xlsx");
	});
});
