/**
 * Silver belongs to a zakat year, as ONE weight at ONE price per gram.
 *
 * The owner keeps silver as a single line he retypes each year — no pieces, no purity,
 * no lineage — so it rides on the same `zakatGoldYears` row that already carries that
 * year's gold prices and the date they were taken on.
 *
 * The figure that matters most here is the one that must NOT move: every year settled
 * before silver existed holds none, and a year that holds none has to come out exactly
 * as it did — `docs/zakat-requirements-2026-10.md` section 8 pins 2024 at 3,213,671.076
 * of gold on a 2,628,184.68 minimum, and silver may not disturb a paisa of it.
 *
 * Nothing here computes tax. Zakat is a religious obligation; this file only proves the
 * owner's own figures reproduce once silver is part of them.
 */
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/local";
import {
	calculateSilverValue,
	calculateZakatAssessment,
	getZakatYearDefinitionByIslamicYear,
} from "@/lib/zakatEngine";
import { buildZakatWorkbook } from "@/lib/zakatExport";
import {
	clearZakatGoldYear,
	getZakatYearSilver,
	getZakatYearSilverGrams,
	getZakatYearSilverValue,
	saveZakatGoldYearPrices,
} from "@/lib/zakatGoldYearRepository";
import { auditZakatSnapshot, toZakatSnapshotFigures } from "@/lib/zakatSnapshotAudit";
import {
	buildZakatYearAssessment,
	prepareZakatYearAssessmentContext,
} from "@/lib/zakatYearAssessment";

import type { ZakatAssessmentInput } from "@/lib/zakatEngine";
import type { ZakatYearAssessmentSource } from "@/lib/zakatYearAssessment";
import type { Account, GoldItem, Transaction, ZakatCalculation, ZakatGoldYear } from "@/types";
import type * as XLSX from "xlsx";

const USER_ID = "zakat-silver-user";
const CURRENCY = "PKR";

// ─── The 2024 sheet, verbatim from spec section 8 ────────────────────────────

const MONTHLY_TOTALS_2024 = [
	2_896_066.15, 2_825_829.58, 2_628_184.68, 3_088_959.26, 3_370_369.84, 3_313_488.09, 3_308_746.12,
	3_017_848.84, 3_042_484.54, 3_048_899.44, 2_957_655.34, 2_788_758.33,
];

const GOLD_VALUE_2024 = 3_213_671.076;
const TOTAL_ZAKATABLE_2024 = 5_841_855.756;
const ZAKAT_OBLIGATION_2024 = 146_046.3939;

function assessmentInput(overrides: Partial<ZakatAssessmentInput> = {}): ZakatAssessmentInput {
	return {
		monthlyTotals: MONTHLY_TOTALS_2024,
		basis: "minimum",
		goldItems: [{ weight: 170.52, purity: "21k" }],
		goldPrices: { priceDate: "2023-03-24", pricesByPurity: { "21k": 18_846.3 } },
		ratePercent: 2.5,
		pastRemaining: 0,
		payments: [],
		...overrides,
	};
}

describe("a year with no silver is numerically unchanged", () => {
	it("leaves the 2024 workbook figures exactly where they were", () => {
		const assessment = calculateZakatAssessment(assessmentInput());

		expect(assessment.silverValue).toBe(0);
		expect(assessment.goldValue).toBeCloseTo(GOLD_VALUE_2024, 6);
		expect(assessment.totalZakatable).toBeCloseTo(TOTAL_ZAKATABLE_2024, 4);
		expect(assessment.zakatObligation).toBeCloseTo(ZAKAT_OBLIGATION_2024, 4);
		// Not merely close: the same double, bit for bit, as basis + gold alone.
		expect(assessment.totalZakatable).toBe(assessment.basisAmount + assessment.goldValue);
	});

	it("treats absent, zero, negative and NaN silver as the same nothing", () => {
		const baseline = calculateZakatAssessment(assessmentInput());

		for (const silver of [
			undefined,
			{},
			{ grams: 500 },
			{ pricePerGram: 210 },
			{ grams: 0, pricePerGram: 210 },
			{ grams: 500, pricePerGram: 0 },
			{ grams: -500, pricePerGram: 210 },
			{ grams: 500, pricePerGram: Number.NaN },
		]) {
			const assessment = calculateZakatAssessment(assessmentInput({ silver }));
			expect(calculateSilverValue(silver)).toBe(0);
			expect(assessment.silverValue).toBe(0);
			expect(assessment.totalZakatable).toBe(baseline.totalZakatable);
			expect(assessment.zakatObligation).toBe(baseline.zakatObligation);
			expect(assessment.balanceOrExcess).toBe(baseline.balanceOrExcess);
		}
	});
});

describe("silver reaches the figure the rate is taken from", () => {
	it("adds grams × price per gram to TOTAL, and so to the 2.5%", () => {
		const assessment = calculateZakatAssessment(
			assessmentInput({ silver: { grams: 500, pricePerGram: 210 } })
		);

		expect(assessment.silverValue).toBeCloseTo(105_000, 6);
		expect(assessment.totalZakatable).toBeCloseTo(TOTAL_ZAKATABLE_2024 + 105_000, 4);
		expect(assessment.zakatObligation).toBeCloseTo((TOTAL_ZAKATABLE_2024 + 105_000) * 0.025, 4);
		expect(assessment.perMonth).toBe(assessment.zakatObligation / 12);
	});

	it("is counted on the MAXIMUM basis too, not only the minimum", () => {
		const assessment = calculateZakatAssessment(
			assessmentInput({ basis: "maximum", silver: { grams: 500, pricePerGram: 210 } })
		);

		expect(assessment.totalZakatable).toBeCloseTo(3_370_369.84 + GOLD_VALUE_2024 + 105_000, 4);
	});
});

// ─── Persistence, per year ───────────────────────────────────────────────────

describe("silver is saved against ONE year", () => {
	beforeEach(async () => {
		await db.zakatGoldYears.where("userId").equals(USER_ID).delete();
	});

	it("round-trips a weight and a price through Dexie", async () => {
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1445,
			pricesByPurity: { "21k": 20_000 },
			silverGrams: 500,
			silverPricePerGram: 210,
		});

		const stored = await db.zakatGoldYears.get(`${USER_ID}:${CURRENCY}:1445`);
		expect(getZakatYearSilver(stored)).toEqual({ grams: 500, pricePerGram: 210 });
		expect(getZakatYearSilverGrams(stored)).toBe(500);
		expect(getZakatYearSilverValue(stored)).toBeCloseTo(105_000, 6);
	});

	it("refuses an unusable weight or price rather than storing a NaN", async () => {
		const record = await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1445,
			pricesByPurity: { "21k": 20_000 },
			silverGrams: Number.NaN,
			silverPricePerGram: -5,
		});

		expect(Object.prototype.hasOwnProperty.call(record, "silverGrams")).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(record, "silverPricePerGram")).toBe(false);
		expect(getZakatYearSilverValue(record)).toBe(0);
	});

	it("leaves every other year alone", async () => {
		for (const islamicYear of [1444, 1445, 1446]) {
			await saveZakatGoldYearPrices({
				userId: USER_ID,
				currency: CURRENCY,
				islamicYear,
				pricesByPurity: { "21k": 20_000 },
			});
		}

		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1445,
			pricesByPurity: { "21k": 20_000 },
			silverGrams: 500,
			silverPricePerGram: 210,
		});

		const byYear = new Map(
			(await db.zakatGoldYears.where("userId").equals(USER_ID).toArray()).map((record) => [
				record.islamicYear,
				record,
			])
		);
		expect(getZakatYearSilverValue(byYear.get(1444))).toBe(0);
		expect(getZakatYearSilverValue(byYear.get(1445))).toBeCloseTo(105_000, 6);
		expect(getZakatYearSilverValue(byYear.get(1446))).toBe(0);
	});

	it("keeps each currency's silver to itself", async () => {
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1445,
			pricesByPurity: {},
			silverGrams: 500,
			silverPricePerGram: 210,
		});
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: "AED",
			islamicYear: 1445,
			pricesByPurity: {},
		});

		expect(getZakatYearSilverValue(await db.zakatGoldYears.get(`${USER_ID}:AED:1445`))).toBe(0);
		expect(
			getZakatYearSilverValue(await db.zakatGoldYears.get(`${USER_ID}:${CURRENCY}:1445`))
		).toBeCloseTo(105_000, 6);
	});

	it("drops the silver with the rest when the year is reset", async () => {
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1445,
			pricesByPurity: { "21k": 20_000 },
			silverGrams: 500,
			silverPricePerGram: 210,
		});
		await clearZakatGoldYear(USER_ID, CURRENCY, 1445);

		const stored = await db.zakatGoldYears.get(`${USER_ID}:${CURRENCY}:1445`);
		expect(stored?.deletedAt).toBeGreaterThan(0);
	});
});

// ─── The one assembly every screen reads ─────────────────────────────────────

function account(id: string): Account {
	return {
		id,
		userId: USER_ID,
		title: id,
		openingBalance: 0,
		currency: CURRENCY,
		isArchived: false,
		accountType: "asset",
		updatedAt: 1_000,
	};
}

/** Dated before the earliest year under test, so every month of each one shows it. */
const FIRST_ACTIVITY_MS =
	getZakatYearDefinitionByIslamicYear(1442).months[0]!.startDate.getTime() - 86_400_000;

const TRANSACTIONS: Transaction[] = [
	{
		id: "meezan-opening",
		userId: USER_ID,
		type: "Income",
		date: FIRST_ACTIVITY_MS,
		amount: 1_000_000,
		accountId: "meezan",
		updatedAt: 1_000,
	},
];

const GOLD_ITEMS: GoldItem[] = [
	{
		id: "gold-1",
		userId: USER_ID,
		currency: CURRENCY,
		title: "Bangles",
		weight: 170.52,
		purity: "21k",
		updatedAt: 1_000,
	},
];

function goldYear(islamicYear: number, patch: Partial<ZakatGoldYear> = {}): ZakatGoldYear {
	return {
		id: `${USER_ID}:${CURRENCY}:${islamicYear}`,
		userId: USER_ID,
		currency: CURRENCY,
		islamicYear,
		pricesByPurity: { "21k": 18_846.3 },
		priceDate: getZakatYearDefinitionByIslamicYear(islamicYear).months[0]!.startDate.getTime(),
		updatedAt: 1_000,
		...patch,
	};
}

function assessmentSource(goldYears: ZakatGoldYear[]): ZakatYearAssessmentSource {
	return {
		userId: USER_ID,
		referenceCurrency: CURRENCY,
		accounts: [account("meezan")],
		transactions: TRANSACTIONS,
		goldItems: GOLD_ITEMS,
		goldYears,
		yearOverrides: [],
		payments: [],
	};
}

describe("the year assembly carries silver to every screen", () => {
	const YEARS = [1444, 1445, 1446];

	it("values only the year the silver was recorded against", () => {
		const withoutSilver = prepareZakatYearAssessmentContext(
			assessmentSource(YEARS.map((islamicYear) => goldYear(islamicYear)))
		);
		const withSilver = prepareZakatYearAssessmentContext(
			assessmentSource(
				YEARS.map((islamicYear) =>
					islamicYear === 1445
						? goldYear(islamicYear, { silverGrams: 500, silverPricePerGram: 210 })
						: goldYear(islamicYear)
				)
			)
		);

		for (const islamicYear of YEARS) {
			const before = buildZakatYearAssessment(withoutSilver, islamicYear);
			const after = buildZakatYearAssessment(withSilver, islamicYear);

			if (islamicYear === 1445) {
				expect(after.totalSilverWeightGrams).toBe(500);
				expect(after.silverPricePerGram).toBe(210);
				expect(after.assessment.silverValue).toBeCloseTo(105_000, 6);
				expect(after.assessment.totalZakatable).toBe(before.assessment.totalZakatable + 105_000);
				continue;
			}

			// Every other year is untouched, figure for figure.
			expect(after.totalSilverWeightGrams).toBe(0);
			expect(after.assessment).toEqual(before.assessment);
		}
	});

	it("feeds the engine through the input the carry-forward chain and History share", () => {
		const context = prepareZakatYearAssessmentContext(
			assessmentSource([goldYear(1445, { silverGrams: 500, silverPricePerGram: 210 })])
		);
		const assembled = buildZakatYearAssessment(context, 1445);

		expect(assembled.input.silver).toEqual({ grams: 500, pricePerGram: 210 });
		expect(calculateZakatAssessment(assembled.input)).toEqual(assembled.assessment);
	});
});

// ─── History ─────────────────────────────────────────────────────────────────

function snapshot(patch: Partial<ZakatCalculation> = {}): ZakatCalculation {
	return {
		id: "calc-1445",
		userId: USER_ID,
		currency: CURRENCY,
		islamicYear: "1445-1446",
		assessmentDate: 1_000,
		goldPricePerGram: 18_846.3,
		referenceCurrency: CURRENCY,
		basis: "minimum",
		ratePercent: 2.5,
		totalGoldWeightGrams: 170.52,
		totalGoldValue: GOLD_VALUE_2024,
		totalSilverWeightGrams: 500,
		totalSilverValue: 105_000,
		accountBalances: [],
		totalZakatable: TOTAL_ZAKATABLE_2024 + 105_000,
		zakatObligation: (TOTAL_ZAKATABLE_2024 + 105_000) * 0.025,
		createdAt: 1_000,
		updatedAt: 1_000,
		...patch,
	};
}

describe("a saved calculation records the silver it was assessed on", () => {
	it("reads the silver back as a figure the audit compares", () => {
		expect(toZakatSnapshotFigures(snapshot()).silverValue).toBe(105_000);
	});

	it("reads a calculation saved before silver existed as holding none", () => {
		const legacy = snapshot({
			totalSilverWeightGrams: undefined,
			totalSilverValue: undefined,
			// The dropped nisab threshold. It is NOT the silver a year held, and must
			// never be read as one.
			silverPricePerGram: 95.5,
		});

		expect(toZakatSnapshotFigures(legacy).silverValue).toBe(0);
		expect(
			auditZakatSnapshot(legacy, {
				totalZakatable: legacy.totalZakatable,
				zakatObligation: legacy.zakatObligation,
				goldValue: legacy.totalGoldValue,
				silverValue: 0,
			}).status
		).toBe("matches");
	});

	it("flags the record as stale once the year's silver changes", () => {
		const audit = auditZakatSnapshot(snapshot(), {
			totalZakatable: TOTAL_ZAKATABLE_2024 + 126_000,
			zakatObligation: (TOTAL_ZAKATABLE_2024 + 126_000) * 0.025,
			goldValue: GOLD_VALUE_2024,
			silverValue: 126_000,
		});

		expect(audit.status).toBe("diverged");
		expect(audit.differences.map((figure) => figure.key)).toEqual([
			"totalZakatable",
			"zakatObligation",
			"silverValue",
		]);
		expect(audit.figures.find((figure) => figure.key === "silverValue")).toMatchObject({
			label: "Silver value",
			saved: 105_000,
			current: 126_000,
			delta: 21_000,
		});
	});
});

// ─── Export ──────────────────────────────────────────────────────────────────

function cell(sheet: XLSX.WorkSheet, ref: string): XLSX.CellObject {
	const found = sheet[ref] as XLSX.CellObject | undefined;
	expect(found, `Expected a cell at ${ref}`).toBeDefined();
	return found!;
}

function exportedSheet(silver?: { grams?: number; pricePerGram?: number }): XLSX.WorkSheet {
	const definition = getZakatYearDefinitionByIslamicYear(1444);
	const monthlyTotals = Array.from({ length: 12 }, () => 1_000_000);
	const workbook = buildZakatWorkbook({
		years: [
			{
				grid: {
					year: definition,
					accounts: [
						{
							accountId: "meezan",
							accountTitle: "Meezan",
							currency: CURRENCY,
							accountType: "asset",
							isArchived: false,
							balances: monthlyTotals,
						},
					],
					monthlyTotals,
					minimum: 1_000_000,
					maximum: 1_000_000,
				},
				currency: CURRENCY,
				basis: "minimum",
				ratePercent: 2.5,
				goldRows: [{ purity: "21k", grams: 170.52, pricePerGram: 18_846.3 }],
				...(silver ? { silver } : {}),
			},
		],
	});

	return workbook.Sheets[workbook.SheetNames[0]!]!;
}

describe("the workbook carries silver as a live formula", () => {
	it("writes grams and price as editable inputs with the value as a PRODUCT", () => {
		const sheet = exportedSheet({ grams: 500, pricePerGram: 210 });

		expect(cell(sheet, "A12").v).toBe("SILVER");
		expect(cell(sheet, "C13").v).toBe(500);
		expect(cell(sheet, "D13").v).toBe(210);
		expect(cell(sheet, "E13").f).toBe("PRODUCT(C13,D13)");
		expect(cell(sheet, "E13").v).toBeCloseTo(105_000, 6);
	});

	it("feeds the TOTAL formula, which the ZAKAT cell is taken from", () => {
		const sheet = exportedSheet({ grams: 500, pricePerGram: 210 });

		expect(cell(sheet, "R6").f).toBe("E13");
		expect(cell(sheet, "R6").v).toBeCloseTo(105_000, 6);
		expect(cell(sheet, "T6").f).toBe("SUM(O6,Q6,R6)");
		expect(cell(sheet, "T6").v).toBeCloseTo(1_000_000 + GOLD_VALUE_2024 + 105_000, 4);
		expect(cell(sheet, "U6").f).toBe("PRODUCT(T6,S6)");
	});

	it("reserves the silver row for a year that holds none, at zero", () => {
		const sheet = exportedSheet();

		expect(cell(sheet, "A13").v).toBe("Silver");
		expect(cell(sheet, "C13").v).toBe(0);
		expect(cell(sheet, "D13").v).toBe(0);
		expect(cell(sheet, "E13").v).toBe(0);
		expect(cell(sheet, "T6").v).toBeCloseTo(1_000_000 + GOLD_VALUE_2024, 4);
	});
});
