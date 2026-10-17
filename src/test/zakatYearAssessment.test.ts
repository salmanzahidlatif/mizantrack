/**
 * One assembly for a zakat year, shared by every screen that quotes one.
 *
 * Ground truth is `docs/zakat-requirements-2026-10.md` — section 4 for the formula,
 * section 7 for the owner's history. A year is not just the engine's arithmetic: it is
 * the accounts chosen for THAT year, the closed-accounts rule it was settled under, its
 * own grams at its own price per gram, and its own payments. Those decisions used to live
 * inside the calculator screen, which is how the saved History snapshots and the live
 * carry-forward figures were able to drift apart.
 *
 * These tests pin the extracted assembly to exactly what the calculator produces, so the
 * two cannot be changed independently again.
 *
 * Nothing here computes tax. Zakat is a religious obligation; this file only proves the
 * same figures come out of one place.
 */
import { format } from "date-fns";
import { describe, expect, it } from "vitest";

import {
	calculateZakatAssessment,
	computeZakatYearGrid,
	getZakatYearDefinitionByIslamicYear,
} from "@/lib/zakatEngine";
import { getZakatGoldGramsByPurity, toZakatGoldItems } from "@/lib/zakatGoldYearRepository";
import {
	buildZakatYearAssessment,
	buildZakatYearAssessments,
	getZakatCarryForwardYearRange,
	prepareZakatYearAssessmentContext,
} from "@/lib/zakatYearAssessment";

import type { ZakatYearAssessmentSource } from "@/lib/zakatYearAssessment";
import type {
	Account,
	GoldItem,
	Transaction,
	ZakatGoldYear,
	ZakatPayment,
	ZakatYearOverride,
} from "@/types";

const USER_ID = "zakat-year-assessment-user";
const CURRENCY = "PKR";
const YEAR = getZakatYearDefinitionByIslamicYear(1444);
const PREVIOUS_YEAR = getZakatYearDefinitionByIslamicYear(1443);

/** The owner's 21k price per gram for AH1444, verbatim from the history table. */
const PRICE_PER_GRAM_1444 = 18_846.3;

function account(id: string, overrides: Partial<Account> = {}): Account {
	return {
		id,
		userId: USER_ID,
		title: id,
		openingBalance: 0,
		currency: CURRENCY,
		isArchived: false,
		accountType: "asset",
		updatedAt: 1_000,
		...overrides,
	};
}

const MEEZAN = account("meezan");
const ALFALAH = account("alfalah", { title: "Alfalah", isArchived: true });
const DUBAI = account("dubai", { title: "Dubai", currency: "AED" });
const ACCOUNTS = [MEEZAN, ALFALAH, DUBAI];

/**
 * A balance in place before any of the years under test opens, so every month of every
 * one of them shows it. An account only counts once it has actually been used, so a
 * transaction dated inside AH1444 would leave AH1443 reading zero.
 */
const FIRST_ACTIVITY_MS =
	getZakatYearDefinitionByIslamicYear(1442).months[0]!.startDate.getTime() - 86_400_000;

function income(accountId: string, amount: number): Transaction {
	return {
		id: `${accountId}-opening`,
		userId: USER_ID,
		type: "Income",
		date: FIRST_ACTIVITY_MS,
		amount,
		accountId,
		updatedAt: 1_000,
	};
}

const TRANSACTIONS = [
	income("meezan", 1_000_000),
	income("alfalah", 500_000),
	income("dubai", 900_000),
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

const GOLD_YEAR_1444: ZakatGoldYear = {
	id: `${USER_ID}:${CURRENCY}:1444`,
	userId: USER_ID,
	currency: CURRENCY,
	islamicYear: 1444,
	pricesByPurity: { "21k": PRICE_PER_GRAM_1444 },
	priceDate: YEAR.months[0]!.startDate.getTime(),
	updatedAt: 1_000,
};

function yearOverride(
	islamicYear: number,
	overrides: Partial<ZakatYearOverride> = {}
): ZakatYearOverride {
	return {
		id: `${USER_ID}:${islamicYear}`,
		userId: USER_ID,
		islamicYear,
		ramadanStart: getZakatYearDefinitionByIslamicYear(islamicYear).months[0]!.startDate.getTime(),
		source: "announced",
		updatedAt: 1_000,
		...overrides,
	};
}

const PAYMENT: ZakatPayment = {
	id: "payment-1",
	userId: USER_ID,
	currency: CURRENCY,
	islamicYear: YEAR.zakatYear,
	amount: 100_000,
	createdAt: 1_000,
	updatedAt: 1_000,
};

function source(overrides: Partial<ZakatYearAssessmentSource> = {}): ZakatYearAssessmentSource {
	return {
		userId: USER_ID,
		referenceCurrency: CURRENCY,
		accounts: ACCOUNTS,
		transactions: TRANSACTIONS,
		goldItems: GOLD_ITEMS,
		goldYears: [GOLD_YEAR_1444],
		yearOverrides: [yearOverride(1444, { selectedAccountIds: ["meezan", "alfalah"] })],
		payments: [PAYMENT],
		...overrides,
	};
}

describe("the extracted assembly reproduces the calculator", () => {
	it("returns the figures the calculator builds by hand for the same year", () => {
		const context = prepareZakatYearAssessmentContext(source());
		const assembled = buildZakatYearAssessment(context, 1444, { definition: YEAR });

		// The calculator's own pipeline, written out: counted accounts → grid → engine.
		const grid = computeZakatYearGrid({
			userId: USER_ID,
			accounts: ACCOUNTS,
			transactions: TRANSACTIONS,
			selectedAccountIds: new Set(["meezan", "alfalah"]),
			sheetYear: YEAR.sheetYear,
			yearDefinition: YEAR,
		});
		const expected = calculateZakatAssessment({
			monthlyTotals: grid.monthlyTotals,
			basis: "minimum",
			goldItems: toZakatGoldItems(getZakatGoldGramsByPurity(GOLD_ITEMS)),
			goldPrices: {
				priceDate: format(YEAR.months[0]!.startDate, "yyyy-MM-dd"),
				pricesByPurity: { "21k": PRICE_PER_GRAM_1444 },
			},
			ratePercent: 2.5,
			pastRemaining: 0,
			payments: [PAYMENT],
		});

		expect(assembled.grid.monthlyTotals).toEqual(grid.monthlyTotals);
		expect(assembled.assessment).toEqual(expected);
		// 1,500,000 + 170.52 g at 18,846.3 per gram.
		expect(assembled.assessment.totalZakatable).toBeCloseTo(4_713_671.076, 6);
		expect(assembled.assessment.zakatObligation).toBeCloseTo(117_841.7769, 6);
		expect(assembled.assessment.paid).toBe(100_000);
	});

	it("never combines currencies", () => {
		const context = prepareZakatYearAssessmentContext(source());

		expect(context.currencyAccounts.map((a) => a.id)).toEqual(["meezan", "alfalah"]);
		expect(buildZakatYearAssessment(context, 1444).grid.minimum).toBe(1_500_000);
	});

	it("carries nothing into a year unless the caller asks", () => {
		const context = prepareZakatYearAssessmentContext(source());

		expect(buildZakatYearAssessment(context, 1444).assessment.pastRemaining).toBe(0);
		expect(
			buildZakatYearAssessment(context, 1444, { pastRemaining: 88_058 }).assessment.pastRemaining
		).toBe(88_058);
	});
});

describe("each year is assessed on its own inputs", () => {
	it("applies the year's own selection and closed-accounts rule", () => {
		const context = prepareZakatYearAssessmentContext(
			source({
				yearOverrides: [
					yearOverride(1443, {
						selectedAccountIds: ["meezan", "alfalah"],
						showArchivedAccounts: false,
					}),
					yearOverride(1444, { selectedAccountIds: ["meezan", "alfalah"] }),
				],
			})
		);

		// AH1443 stopped counting its closed account; AH1444 still counts it.
		expect(buildZakatYearAssessment(context, 1443).grid.minimum).toBe(1_000_000);
		expect(buildZakatYearAssessment(context, 1444).grid.minimum).toBe(1_500_000);
	});

	it("values a year at its own price, and an unpriced year at none", () => {
		const context = prepareZakatYearAssessmentContext(source());

		expect(buildZakatYearAssessment(context, 1444).assessment.goldValue).toBeCloseTo(
			3_213_671.076,
			6
		);
		// AH1443 was never priced, so it borrows nothing from the year beside it.
		expect(buildZakatYearAssessment(context, 1443).assessment.goldValue).toBe(0);
	});

	it("counts only the payments recorded against the year", () => {
		const context = prepareZakatYearAssessmentContext(source());

		expect(buildZakatYearAssessment(context, 1444).assessment.paid).toBe(100_000);
		expect(
			buildZakatYearAssessment(context, 1443, { definition: PREVIOUS_YEAR }).assessment.paid
		).toBe(0);
	});

	it("gives the owner's basis and rate to one year only", () => {
		const context = prepareZakatYearAssessmentContext(source());
		const assessments = buildZakatYearAssessments(context, [1443, 1444], (islamicYear) =>
			islamicYear === 1444 ? { basis: "maximum", ratePercent: 3 } : {}
		);

		expect(assessments.get(1444)?.input.basis).toBe("maximum");
		expect(assessments.get(1444)?.assessment.ratePercent).toBe(3);
		expect(assessments.get(1443)?.input.basis).toBe("minimum");
		expect(assessments.get(1443)?.assessment.ratePercent).toBe(2.5);
	});

	it("ignores a year override that was reset", () => {
		const context = prepareZakatYearAssessmentContext(
			source({
				yearOverrides: [
					yearOverride(1444, {
						selectedAccountIds: ["meezan", "alfalah"],
						deletedAt: 2_000,
					}),
				],
			})
		);

		// Nothing stored any more, so the year falls back to pre-selecting open assets.
		expect(buildZakatYearAssessment(context, 1444).countedAccountIds).toEqual(new Set(["meezan"]));
	});
});

describe("the carry-forward window stays bounded", () => {
	it("starts at the earliest year the app exposes", () => {
		expect(getZakatCarryForwardYearRange(1442)).toEqual([1440, 1441, 1442]);
	});

	it("never walks back further than the cap", () => {
		const years = getZakatCarryForwardYearRange(1500);

		expect(years).toHaveLength(26);
		expect(years[0]).toBe(1475);
		expect(years.at(-1)).toBe(1500);
	});

	it("returns nothing for an unusable year", () => {
		expect(getZakatCarryForwardYearRange(Number.NaN)).toEqual([]);
	});
});
