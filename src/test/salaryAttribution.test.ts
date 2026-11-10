import { describe, expect, it } from "vitest";

import {
	attributeSalaryPayments,
	getMonthIndex,
	parseDescribedMonthIndex,
} from "@/lib/analytics/salaryAttribution";

import type { Transaction } from "@/types";

const GST_OFFSET_MINUTES = 4 * 60;
const MS_PER_MINUTE = 60 * 1000;
const OPTIONS = {
	nowMs: Date.UTC(2026, 10, 10, 8),
	timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
};

function at(year: number, monthIndex: number, day: number): number {
	return Date.UTC(year, monthIndex, day, 12) - GST_OFFSET_MINUTES * MS_PER_MINUTE;
}

function monthOf(year: number, monthIndex: number): number {
	return year * 12 + monthIndex;
}

function salary(
	id: string,
	date: number,
	amount = 10_000,
	extra: Partial<Transaction> = {}
): Transaction {
	return {
		id,
		userId: "user",
		type: "Income",
		date,
		amount,
		accountId: "acc",
		categoryId: "cat-salary",
		updatedAt: 1,
		...extra,
	};
}

/** End-of-month salary for each month in [fromMonth, toMonth] of `year`. */
function endOfMonthSalaries(year: number, fromMonth: number, toMonth: number): Transaction[] {
	const rows: Transaction[] = [];
	for (let month = fromMonth; month <= toMonth; month++) {
		rows.push(salary(`s-${year}-${month}`, at(year, month, 27)));
	}
	return rows;
}

function attributedMonths(transactions: Transaction[]): Record<string, number> {
	const result = attributeSalaryPayments(transactions, OPTIONS);
	return Object.fromEntries([...result.values()].map((a) => [a.transactionId, a.monthIndex]));
}

describe("attributeSalaryPayments", () => {
	it("moves last month's late salary back when this month holds two salaries", () => {
		// October's salary arrives on 1 Nov and November's on 29 Nov: October would be empty.
		const transactions = [
			...endOfMonthSalaries(2025, 3, 8),
			salary("oct-late", at(2025, 10, 1)),
			salary("nov", at(2025, 10, 29)),
			salary("dec", at(2025, 11, 27)),
		];

		const result = attributeSalaryPayments(transactions, OPTIONS);

		expect(result.get("oct-late")).toMatchObject({
			monthIndex: monthOf(2025, 9),
			creditMonthIndex: monthOf(2025, 10),
			reason: "pay-period",
		});
		expect(result.get("nov")).toMatchObject({ monthIndex: monthOf(2025, 10), reason: "credited" });
		expect(getMonthIndex(result.get("oct-late")!.effectiveMs, GST_OFFSET_MINUTES)).toBe(
			monthOf(2025, 9)
		);
	});

	it("resolves a run of late salaries as a chain", () => {
		// May's salary lands on 1 Jun, June's on 1 Jul, then July's on time on 30 Jul.
		const transactions = [
			...endOfMonthSalaries(2024, 0, 3),
			salary("may", at(2024, 5, 1)),
			salary("jun", at(2024, 6, 1)),
			salary("jul", at(2024, 6, 30)),
			...endOfMonthSalaries(2024, 7, 11),
		];

		expect(attributedMonths(transactions)).toMatchObject({
			may: monthOf(2024, 4),
			jun: monthOf(2024, 5),
			jul: monthOf(2024, 6),
		});
	});

	it("moves an early salary forward into the month it was paid for", () => {
		const transactions = [
			...endOfMonthSalaries(2025, 0, 3),
			salary("may", at(2025, 4, 25)),
			salary("jun-early", at(2025, 4, 29)),
			...endOfMonthSalaries(2025, 6, 9),
		];

		expect(attributedMonths(transactions)["jun-early"]).toBe(monthOf(2025, 5));
	});

	it("uses a month named in the description over the credit date", () => {
		const transactions = [
			...endOfMonthSalaries(2023, 0, 9),
			salary("nov", at(2023, 11, 1), 10_000, { description: "November 2023" }),
			salary("dec", at(2023, 11, 29), 10_000, { description: "December salary" }),
		];

		const result = attributeSalaryPayments(transactions, OPTIONS);

		expect(result.get("nov")).toMatchObject({
			monthIndex: monthOf(2023, 10),
			reason: "description",
		});
		expect(result.get("dec")).toMatchObject({ monthIndex: monthOf(2023, 11), reason: "credited" });
	});

	it("leaves a second job paid alongside the main salary where it was credited", () => {
		// Main job on the 28th and a part-time job on the 5th, every month, same category.
		const transactions: Transaction[] = [];
		for (let month = 0; month < 12; month++) {
			transactions.push(salary(`main-${month}`, at(2025, month, 28), 16_000));
			transactions.push(salary(`side-${month}`, at(2025, month, 5), 11_000));
		}

		const result = attributeSalaryPayments(transactions, OPTIONS);

		for (const attribution of result.values()) {
			expect(attribution.monthIndex).toBe(attribution.creditMonthIndex);
		}
	});

	it("leaves a bonus paid as one large transaction alone", () => {
		const transactions = [
			...endOfMonthSalaries(2024, 0, 11),
			salary("double", at(2025, 0, 27), 20_000),
			...endOfMonthSalaries(2025, 1, 5),
		];

		expect(attributedMonths(transactions).double).toBe(monthOf(2025, 0));
	});

	it("does not move a lone salary on the 1st when nothing collides", () => {
		const transactions = [
			...endOfMonthSalaries(2025, 0, 3),
			salary("may-first", at(2025, 4, 1)),
			...endOfMonthSalaries(2025, 5, 8),
		];

		// April already has its own salary and May has only this one: nothing to fix.
		expect(attributedMonths(transactions)["may-first"]).toBe(monthOf(2025, 4));
	});

	it("does not move a mid-month payment even next to an empty month", () => {
		const transactions = [
			...endOfMonthSalaries(2025, 0, 3),
			salary("mid-month", at(2025, 5, 15)),
			salary("jun", at(2025, 5, 27)),
			...endOfMonthSalaries(2025, 6, 9),
		];

		expect(attributedMonths(transactions)["mid-month"]).toBe(monthOf(2025, 5));
	});

	it("never reconciles an irregular category such as bonuses", () => {
		const transactions = [
			salary("b1", at(2024, 3, 1), 500, { categoryId: "cat-bonus" }),
			salary("b2", at(2024, 3, 28), 500, { categoryId: "cat-bonus" }),
			salary("b3", at(2025, 3, 2), 500, { categoryId: "cat-bonus" }),
		];

		const result = attributeSalaryPayments(transactions, OPTIONS);

		for (const attribution of result.values()) expect(attribution.reason).toBe("credited");
	});

	it("ignores side payments far below the usual salary when resolving collisions", () => {
		// A 300 project payment shares August with the salary; it must not bump the salary.
		const transactions = [
			...endOfMonthSalaries(2025, 0, 6),
			salary("side", at(2025, 7, 18), 300),
			salary("aug", at(2025, 7, 29)),
			...endOfMonthSalaries(2025, 8, 9),
		];

		expect(attributedMonths(transactions)).toMatchObject({
			side: monthOf(2025, 7),
			aug: monthOf(2025, 7),
		});
	});
});

describe("parseDescribedMonthIndex", () => {
	const july2023 = monthOf(2023, 6);

	it("reads a single nearby month in any common spelling", () => {
		expect(parseDescribedMonthIndex("June 2023 COMO", july2023)).toBe(monthOf(2023, 5));
		expect(parseDescribedMonthIndex("may salary 50 usd", july2023)).toBe(monthOf(2023, 4));
		expect(parseDescribedMonthIndex("Salary for Sept", monthOf(2023, 9))).toBe(monthOf(2023, 8));
		expect(parseDescribedMonthIndex("December", monthOf(2024, 0))).toBe(monthOf(2023, 11));
	});

	it("ignores descriptions that name several months or none", () => {
		expect(parseDescribedMonthIndex("April and June salary remaining", july2023)).toBeUndefined();
		expect(parseDescribedMonthIndex("salary + parking", july2023)).toBeUndefined();
		expect(parseDescribedMonthIndex(undefined, july2023)).toBeUndefined();
	});

	it("ignores a named month too far from the credit date", () => {
		expect(parseDescribedMonthIndex("January bonus", july2023)).toBeUndefined();
		expect(parseDescribedMonthIndex("June 2021", july2023)).toBeUndefined();
	});
});
