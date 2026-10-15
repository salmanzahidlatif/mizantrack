/**
 * Payments belong to a zakat year.
 *
 * Spec section 4.5: `Paid` is the sum of the payments for ONE zakat year, and that same
 * figure is what the carry-forward chain settles the year on. So the screen, the engine
 * and the carry-forward must all filter payments identically — if they ever disagreed,
 * the owner would read one Balance/Excess and carry another.
 *
 * Decision 3 also applies: the payment date stays optional, nothing is preselected, and
 * a past date is normal. A dated payment and an undated one both count for their year.
 */
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";
import { v4 as uuid } from "uuid";

import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { db } from "@/lib/db/local";
import { buildZakatCarryForwardChain } from "@/lib/zakatCarryForward";
import { calculateZakatAssessment, getZakatYearDefinitionByIslamicYear } from "@/lib/zakatEngine";

import type { ZakatYearSettlement } from "@/lib/zakatCarryForward";
import type { ZakatPayment } from "@/types";

const USER_ID = "zakat-year-payments-user";
const CURRENCY = "PKR";

function zakatYearOf(islamicYear: number): string {
	return getZakatYearDefinitionByIslamicYear(islamicYear).zakatYear;
}

/** Records a payment the way the screen does: against the year currently selected. */
async function recordPayment({
	islamicYear,
	amount,
	date,
	currency = CURRENCY,
}: {
	islamicYear: number;
	amount: number;
	date?: number;
	currency?: string;
}): Promise<ZakatPayment> {
	const payment: ZakatPayment = {
		id: uuid(),
		userId: USER_ID,
		islamicYear: zakatYearOf(islamicYear),
		amount,
		currency,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
	if (date !== undefined) payment.date = date;

	await db.zakatPayments.add(payment);
	return payment;
}

/** The same query the payments list and the calculator run: one year, one currency. */
async function paymentsForYear(islamicYear: number): Promise<ZakatPayment[]> {
	const zakatYear = zakatYearOf(islamicYear);
	return db.zakatPayments
		.where("userId")
		.equals(USER_ID)
		.filter(
			(payment) =>
				!payment.deletedAt &&
				payment.islamicYear === zakatYear &&
				normalizeCurrencyCode(payment.currency) === normalizeCurrencyCode(CURRENCY)
		)
		.sortBy("date");
}

async function assessYear(islamicYear: number, monthlyTotals: number[]) {
	return calculateZakatAssessment({
		monthlyTotals,
		basis: "minimum",
		goldItems: [],
		goldPrices: { priceDate: "2023-03-24", pricesByPurity: {} },
		ratePercent: 2.5,
		pastRemaining: 0,
		payments: await paymentsForYear(islamicYear),
	});
}

beforeEach(async () => {
	await db.zakatPayments.where("userId").equals(USER_ID).delete();
});

describe("payments are attributed to the selected zakat year", () => {
	it("keeps a payment recorded under one year out of every other year", async () => {
		await recordPayment({ islamicYear: 1443, amount: 66_000 });
		await recordPayment({ islamicYear: 1444, amount: 200_000 });
		await recordPayment({ islamicYear: 1444, amount: 85_500 });

		expect((await paymentsForYear(1443)).map((payment) => payment.amount)).toEqual([66_000]);
		expect(
			(await paymentsForYear(1444)).map((payment) => payment.amount).sort((a, b) => a - b)
		).toEqual([85_500, 200_000]);
		expect(await paymentsForYear(1442)).toEqual([]);
	});

	it("shows the year's own Paid total, not an all-time one", async () => {
		await recordPayment({ islamicYear: 1443, amount: 66_000 });
		await recordPayment({ islamicYear: 1444, amount: 285_500 });

		expect((await assessYear(1443, [3_120_855.86])).paid).toBe(66_000);
		expect((await assessYear(1444, [2_628_184.68])).paid).toBe(285_500);
	});

	it("counts an undated payment, recorded after the fact, for its year", async () => {
		// Decision 3: the date is optional and a past date is normal.
		await recordPayment({ islamicYear: 1444, amount: 100_000 });
		await recordPayment({
			islamicYear: 1444,
			amount: 185_500,
			date: new Date(2023, 5, 1).getTime(),
		});

		const payments = await paymentsForYear(1444);
		expect(payments).toHaveLength(2);
		expect(payments.some((payment) => payment.date === undefined)).toBe(true);
		expect((await assessYear(1444, [2_628_184.68])).paid).toBe(285_500);
	});

	it("keeps another currency's payments out of the year", async () => {
		await recordPayment({ islamicYear: 1444, amount: 285_500 });
		await recordPayment({ islamicYear: 1444, amount: 4_000, currency: "AED" });

		expect((await assessYear(1444, [2_628_184.68])).paid).toBe(285_500);
	});
});

describe("Paid on screen is the figure the carry-forward chain settles on", () => {
	it("agrees between the assessment and the chain, and carries the overpayment on", async () => {
		await recordPayment({ islamicYear: 1443, amount: 66_000 });
		await recordPayment({ islamicYear: 1444, amount: 285_500 });

		const assessments = new Map(
			await Promise.all(
				[1443, 1444].map(
					async (islamicYear) =>
						[
							islamicYear,
							await assessYear(
								islamicYear,
								islamicYear === 1443 ? [3_120_855.86] : [2_628_184.68]
							),
						] as const
				)
			)
		);

		const settlements: ZakatYearSettlement[] = [...assessments.entries()].map(
			([islamicYear, assessment]) => ({
				islamicYear,
				zakatObligation: assessment.zakatObligation,
				paid: assessment.paid,
			})
		);

		const chain = buildZakatCarryForwardChain(settlements, { throughIslamicYear: 1444 });

		for (const [islamicYear, assessment] of assessments) {
			expect(chain.get(islamicYear)?.paid).toBe(assessment.paid);
		}

		// The 1443 leftover is what 1444 opens on, so the two views cannot drift apart.
		const carried = chain.get(1443)!.balanceOrExcess;
		expect(chain.get(1444)?.pastRemaining).toBe(carried);

		const onScreen = calculateZakatAssessment({
			monthlyTotals: [2_628_184.68],
			basis: "minimum",
			goldItems: [],
			goldPrices: { priceDate: "2023-03-24", pricesByPurity: {} },
			ratePercent: 2.5,
			pastRemaining: carried,
			payments: await paymentsForYear(1444),
		});

		expect(onScreen.paid).toBe(chain.get(1444)?.paid);
		expect(onScreen.balanceOrExcess).toBeCloseTo(chain.get(1444)!.balanceOrExcess, 6);
	});
});
