/**
 * Reconciliation against the owner's trusted zakat workbook (`docs/Zakat - All.xlsx`).
 *
 * Ground truth is `docs/zakat-requirements-2026-10.md` — section 8 for the 2024 worked
 * target and section 7 for the 2020 - 2024 history table. Every expected figure below is
 * copied verbatim from that spec; nothing here is rounded to make a test pass.
 *
 * Nothing in this suite computes tax. Zakat is a religious obligation the owner already
 * calculates by hand; this file only proves the engine reproduces those numbers.
 *
 * The twelve monthly totals are fed in as INPUT, exactly as the spec supplies them, so the
 * assessment maths is pinned independently of any Islamic-calendar boundary decision.
 */
import { describe, expect, it } from "vitest";

import { calculateGoldValue, calculateZakatAssessment } from "@/lib/zakatEngine";

import type { ZakatBasis } from "@/lib/zakatEngine";
import type { GoldItem, GoldPurity } from "@/types";

const PURITY_21K: GoldPurity = "21k";
const DEFAULT_RATE_PERCENT = 2.5;

// ─── 2024 sheet (AH1444 → AH1445) ────────────────────────────────────────────

/** Ramaḍān → Shaʿbān, in spreadsheet order. Spec section 8. */
const MONTHLY_TOTALS_2024 = [
	2_896_066.15, // Ramaḍān
	2_825_829.58, // Shawwāl
	2_628_184.68, // Zū al-Qaʿdah
	3_088_959.26, // Zū al-Ḥijjah
	3_370_369.84, // al-Muḥarram
	3_313_488.09, // Ṣafar
	3_308_746.12, // Rabīʿ al-ʾAwwal
	3_017_848.84, // Rabīʿ ath-Thānī
	3_042_484.54, // Jumādā al-ʾAwwal
	3_048_899.44, // Jumādā ath-Thāniya
	2_957_655.34, // Rajab
	2_788_758.33, // Shaʿbān
];

const EXPECTED_2024 = {
	minimum: 2_628_184.68,
	maximum: 3_370_369.84,
	goldValue: 3_213_671.076,
	totalZakatable: 5_841_855.756,
	zakatObligation: 146_046.3939,
	perMonth: 12_170.53283,
	pastRemaining: 88_058,
	totalToPay: 234_104.3939,
	paid: 285_500,
	balanceOrExcess: -51_395.6061,
};

const GOLD_ITEMS_2024: Pick<GoldItem, "weight" | "purity">[] = [
	{ weight: 170.52, purity: PURITY_21K },
];

/** Priced at 1 Ramaḍān AH1444 — 24 Mar 2023, per the spec's month-range table. */
const GOLD_PRICES_2024 = {
	priceDate: "2023-03-24",
	pricesByPurity: { [PURITY_21K]: 18_846.3 } as Partial<Record<GoldPurity, number>>,
};

const PAYMENTS_2024 = [
	{ amount: 100_000 },
	{ amount: 85_500 },
	{ amount: 100_000 }, // sums to the workbook's 285,500 total paid
];

function assess2024(basis: ZakatBasis = "minimum") {
	return calculateZakatAssessment({
		monthlyTotals: MONTHLY_TOTALS_2024,
		basis,
		goldItems: GOLD_ITEMS_2024,
		goldPrices: GOLD_PRICES_2024,
		ratePercent: DEFAULT_RATE_PERCENT,
		pastRemaining: EXPECTED_2024.pastRemaining,
		payments: PAYMENTS_2024,
	});
}

describe("2024 workbook reconciliation", () => {
	it("picks MINIMUM as the lowest monthly total (Zū al-Qaʿdah)", () => {
		const assessment = assess2024();
		expect(assessment.minimum).toBeCloseTo(EXPECTED_2024.minimum, 6);
		expect(assessment.minimum).toBe(MONTHLY_TOTALS_2024[2]);
	});

	it("picks MAXIMUM as the highest monthly total (al-Muḥarram)", () => {
		const assessment = assess2024();
		expect(assessment.maximum).toBeCloseTo(EXPECTED_2024.maximum, 6);
		expect(assessment.maximum).toBe(MONTHLY_TOTALS_2024[4]);
	});

	it("values 170.52 g of 21k gold at 18,846.3 per gram", () => {
		expect(calculateGoldValue(GOLD_ITEMS_2024, GOLD_PRICES_2024.pricesByPurity)).toBeCloseTo(
			EXPECTED_2024.goldValue,
			6
		);
		expect(assess2024().goldValue).toBeCloseTo(EXPECTED_2024.goldValue, 6);
	});

	it("ignores gold karats with no price on the effective date", () => {
		const value = calculateGoldValue(
			[...GOLD_ITEMS_2024, { weight: 50, purity: "22k" }],
			GOLD_PRICES_2024.pricesByPurity
		);
		expect(value).toBeCloseTo(EXPECTED_2024.goldValue, 6);
	});

	it("totals zakatable wealth as MINIMUM + GOLD", () => {
		const assessment = assess2024();
		expect(assessment.basisAmount).toBeCloseTo(EXPECTED_2024.minimum, 6);
		expect(assessment.totalZakatable).toBeCloseTo(EXPECTED_2024.totalZakatable, 4);
		expect(assessment.totalZakatable).toBeCloseTo(assessment.basisAmount + assessment.goldValue, 6);
	});

	it("applies the editable 2.5% rate and divides by twelve", () => {
		const assessment = assess2024();
		expect(assessment.ratePercent).toBe(DEFAULT_RATE_PERCENT);
		expect(assessment.zakatObligation).toBeCloseTo(EXPECTED_2024.zakatObligation, 4);
		expect(assessment.perMonth).toBeCloseTo(EXPECTED_2024.perMonth, 4);
		expect(assessment.perMonth).toBe(assessment.zakatObligation / 12);
	});

	it("adds 88,058 past remaining to reach TOTAL TO PAY", () => {
		const assessment = assess2024();
		expect(assessment.pastRemaining).toBe(EXPECTED_2024.pastRemaining);
		expect(assessment.totalToPay).toBeCloseTo(EXPECTED_2024.totalToPay, 4);
	});

	it("sums payments to the 285,500 the owner recorded", () => {
		expect(assess2024().paid).toBeCloseTo(EXPECTED_2024.paid, 6);
	});

	it("reports the overpayment as a negative BALANCE/EXCESS", () => {
		const assessment = assess2024();
		expect(assessment.balanceOrExcess).toBeCloseTo(EXPECTED_2024.balanceOrExcess, 4);
		expect(assessment.balanceOrExcess).toBeLessThan(0);
		expect(Math.sign(assessment.balanceOrExcess)).toBe(-1);
		expect(assessment.balanceOrExcess).toBeCloseTo(assessment.totalToPay - assessment.paid, 6);
	});

	it("switches the basis to MAXIMUM instead of silently ignoring it", () => {
		const minimumBasis = assess2024("minimum");
		const maximumBasis = assess2024("maximum");

		expect(maximumBasis.basisAmount).toBeCloseTo(EXPECTED_2024.maximum, 6);
		expect(maximumBasis.basisAmount).not.toBeCloseTo(minimumBasis.basisAmount, 2);

		const expectedTotal = EXPECTED_2024.maximum + EXPECTED_2024.goldValue;
		expect(maximumBasis.totalZakatable).toBeCloseTo(expectedTotal, 4);
		expect(maximumBasis.zakatObligation).toBeCloseTo(expectedTotal * 0.025, 4);
		expect(maximumBasis.perMonth).toBeCloseTo((expectedTotal * 0.025) / 12, 4);
		expect(maximumBasis.zakatObligation).toBeGreaterThan(minimumBasis.zakatObligation);

		// The minimum and maximum summary figures are unchanged by the basis switch.
		expect(maximumBasis.minimum).toBeCloseTo(EXPECTED_2024.minimum, 6);
		expect(maximumBasis.maximum).toBeCloseTo(EXPECTED_2024.maximum, 6);
	});
});

// ─── 2020 sheet (AH1440 → AH1441) ────────────────────────────────────────────

const EXPECTED_2020 = {
	minimum: 1_489_451.42,
	goldValue: 1_270_598.4,
	totalZakatable: 2_760_049.82,
	zakatObligation: 69_001.2455,
	perMonth: 5_750.103792,
	paid: 69_000,
	remainder: 1.2455,
};

const GOLD_ITEMS_2020: Pick<GoldItem, "weight" | "purity">[] = [
	{ weight: 163.4, purity: PURITY_21K },
];

/**
 * The spec publishes only the 2020 minimum (`O14 = MIN(B14:M14)`), not the twelve monthly
 * totals, and the sheet has no maximum formula. The trusted minimum is therefore placed in
 * one month and the remaining eleven are deliberately synthetic values held strictly above
 * it, so `MIN` still resolves to the figure the owner recorded.
 */
const MONTHLY_TOTALS_2020 = Array.from(
	{ length: 12 },
	(_, index) => EXPECTED_2020.minimum + index * 10_000
);

describe("2020 workbook reconciliation", () => {
	const assessment = calculateZakatAssessment({
		monthlyTotals: MONTHLY_TOTALS_2020,
		basis: "minimum",
		goldItems: GOLD_ITEMS_2020,
		goldPrices: {
			// 1 Ramaḍān AH1440 — 7 May 2019, per the spec's month-range table.
			priceDate: "2019-05-07",
			pricesByPurity: { [PURITY_21K]: 7_776 } as Partial<Record<GoldPurity, number>>,
		},
		ratePercent: DEFAULT_RATE_PERCENT,
		pastRemaining: 0,
		payments: [{ amount: EXPECTED_2020.paid }],
	});

	it("takes 1,489,451.42 as the minimum", () => {
		expect(assessment.minimum).toBeCloseTo(EXPECTED_2020.minimum, 6);
		expect(assessment.basisAmount).toBeCloseTo(EXPECTED_2020.minimum, 6);
	});

	it("values 163.4 g of 21k gold at 7,776 per gram", () => {
		expect(assessment.goldValue).toBeCloseTo(EXPECTED_2020.goldValue, 4);
	});

	it("reaches 69,001.2455 zakat at 2.5%", () => {
		expect(assessment.totalZakatable).toBeCloseTo(EXPECTED_2020.totalZakatable, 4);
		expect(assessment.zakatObligation).toBeCloseTo(EXPECTED_2020.zakatObligation, 4);
		expect(assessment.perMonth).toBeCloseTo(EXPECTED_2020.perMonth, 4);
	});

	it("leaves 1.2455 still payable after 69,000 paid", () => {
		expect(assessment.paid).toBe(EXPECTED_2020.paid);
		expect(assessment.totalToPay).toBeCloseTo(EXPECTED_2020.zakatObligation, 4);
		expect(assessment.balanceOrExcess).toBeCloseTo(EXPECTED_2020.remainder, 4);
		expect(assessment.balanceOrExcess).toBeGreaterThan(0);
	});
});
