/**
 * The MINIMUM must come from a month that actually held something.
 *
 * The owner's AED book opens two months before its first transaction. Those months
 * report zero because no account existed yet, not because the money was spent — and a
 * plain `MIN` over the row took that zero as the basis and declared no zakat due on a
 * year holding between 5,565 and 75,653 AED every month after.
 *
 * Nothing here calculates tax. These are the owner's own workbook figures.
 */

import { describe, expect, it } from "vitest";

import { calculateZakatAssessment, minimumMonthlyTotal } from "@/lib/zakatEngine";

/** The 2024 AED year exactly as the Monthly View shows it, Ramaḍān first. */
const AED_2024 = [
	0, // Ramaḍān — no account had any history yet
	0, // Shawwāl — likewise
	5_565.0, // Zū al-Qaʿdah — the first month anything is held
	40_019.38,
	57_820.23,
	59_997.09,
	60_980.01,
	64_027.57,
	69_473.99,
	53_653.74,
	60_815.35,
	75_653.62, // Shaʿbān
];

function assess(monthlyTotals: number[]) {
	return calculateZakatAssessment({
		monthlyTotals,
		basis: "minimum",
		goldItems: [],
		goldPrices: { priceDate: "2024-03-12", pricesByPurity: {} },
		ratePercent: 2.5,
		pastRemaining: 0,
		payments: [],
	});
}

describe("the minimum ignores months that held nothing", () => {
	it("takes 5,565.00 from the AED year rather than the empty opening months", () => {
		expect(minimumMonthlyTotal(AED_2024)).toBeCloseTo(5_565.0, 6);
		expect(assess(AED_2024).basisAmount).toBeCloseTo(5_565.0, 6);
	});

	it("stops reporting no zakat due on a year that plainly held money", () => {
		const assessment = assess(AED_2024);

		expect(assessment.zakatObligation).toBeCloseTo(139.125, 6);
		expect(assessment.zakatObligation).toBeGreaterThan(0);
	});

	it("leaves the maximum alone", () => {
		expect(assess(AED_2024).maximum).toBeCloseTo(75_653.62, 6);
	});

	it("still owes nothing when the year never held anything", () => {
		expect(minimumMonthlyTotal([0, 0, 0])).toBe(0);
		expect(assess([0, 0, 0]).zakatObligation).toBe(0);
	});

	it("treats an overdrawn month as holding nothing", () => {
		expect(minimumMonthlyTotal([-577.5, -3_577.5])).toBe(0);
		expect(minimumMonthlyTotal([-577.5, 1_000])).toBeCloseTo(1_000, 6);
	});

	it("has no opinion about an empty year", () => {
		expect(minimumMonthlyTotal([])).toBe(0);
	});

	/**
	 * Every month in the owner's PKR books holds something, so each one is a candidate
	 * and the answer is identical to the sheet's own `MIN(B14:M14)`. This is what keeps
	 * the 2024 reconciliation exact.
	 */
	it("agrees with a plain MIN whenever every month held something", () => {
		const everyMonthHeld = [2_896_066.15, 2_825_829.58, 2_628_184.68, 3_088_959.26];

		expect(minimumMonthlyTotal(everyMonthHeld)).toBe(Math.min(...everyMonthHeld));
	});
});
