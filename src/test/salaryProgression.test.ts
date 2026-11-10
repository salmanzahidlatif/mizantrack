import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import {
	aggregateSalaryProgression,
	aggregateSalaryProgressionChunked,
	getSalaryProgressionCacheKey,
	type SalaryProgressionQuery,
} from "@/lib/analytics/salaryProgression";
import { isSalaryCategoryTitle } from "@/lib/salaryCategories";

import type { Account, Category, Transaction } from "@/types";

const USER_ID = "salary-user";
const OTHER_USER_ID = "other-user";
const GST_OFFSET_MINUTES = 4 * 60;
const MS_PER_MINUTE = 60 * 1000;

function at(year: number, monthIndex: number, day: number, hour = 12): number {
	return Date.UTC(year, monthIndex, day, hour) - GST_OFFSET_MINUTES * MS_PER_MINUTE;
}

function makeAccount(id: string, currency: string, userId = USER_ID): Account {
	return {
		id,
		userId,
		title: `${id} account`,
		openingBalance: 0,
		currency,
		isArchived: false,
		updatedAt: 1,
	};
}

function makeCategory(id: string, title: string, userId = USER_ID): Category {
	return {
		id,
		userId,
		title,
		type: "Income",
		updatedAt: 1,
	};
}

function makeTransaction(
	overrides: Partial<Transaction> & Pick<Transaction, "id" | "date">
): Transaction {
	return {
		userId: USER_ID,
		type: "Income",
		amount: 10_000,
		accountId: "acc-aed",
		categoryId: "cat-salary",
		updatedAt: 1,
		...overrides,
	};
}

/** One salary transaction per month across `year`. */
function monthlySalary(year: number, amount: number, prefix: string): Transaction[] {
	return Array.from({ length: 12 }, (_, monthIndex) =>
		makeTransaction({
			id: `${prefix}-${year}-${monthIndex}`,
			date: at(year, monthIndex, 25),
			amount,
		})
	);
}

const ACCOUNTS: Account[] = [makeAccount("acc-aed", "AED"), makeAccount("acc-usd", "USD")];
const CATEGORIES: Category[] = [
	makeCategory("cat-salary", "Salary"),
	makeCategory("cat-gift", "Gift"),
];

const BASE_QUERY: SalaryProgressionQuery = {
	currency: "AED",
	now: new Date(at(2025, 11, 20)),
	timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
};

describe("aggregateSalaryProgression", () => {
	it("tracks a raise from 10,000 to 12,000 across two years", () => {
		const transactions = [...monthlySalary(2024, 10_000, "a"), ...monthlySalary(2025, 12_000, "b")];

		const result = aggregateSalaryProgression(
			USER_ID,
			ACCOUNTS,
			CATEGORIES,
			transactions,
			BASE_QUERY
		);

		expect(result.points.map((point) => point.key)).toEqual(["2024", "2025"]);
		expect(result.points.map((point) => point.label)).toEqual(["2024", "2025"]);
		expect(result.points[0]).toMatchObject({
			total: 120_000,
			monthsWithIncome: 12,
			monthsCovered: 12,
			average: 10_000,
			transactionCount: 12,
			delta: 0,
			growthShare: null,
			averageGrowthShare: null,
			isHike: false,
			isPartial: false,
		});
		expect(result.points[1]).toMatchObject({
			total: 144_000,
			monthsWithIncome: 12,
			monthsCovered: 12,
			average: 12_000,
			delta: 24_000,
			isHike: true,
		});
		expect(result.points[1]?.growthShare).toBeCloseTo(0.2, 6);
		expect(result.points[1]?.averageGrowthShare).toBeCloseTo(0.2, 6);

		expect(result.hikes).toHaveLength(1);
		expect(result.hikes[0]).toMatchObject({
			key: "2025",
			fromAverage: 10_000,
			toAverage: 12_000,
		});
		expect(result.hikes[0]?.share).toBeCloseTo(0.2, 6);

		expect(result.totalEarned).toBe(264_000);
		expect(result.startingAverage).toBe(10_000);
		expect(result.latestAverage).toBe(12_000);
		expect(result.overallGrowthShare).toBeCloseTo(0.2, 6);
		expect(result.cagr).toBeCloseTo(0.2, 2);
		expect(result.firstSalaryMs).toBe(at(2024, 0, 25));
		expect(result.lastSalaryMs).toBe(at(2025, 11, 25));
	});

	it("does not fake a raise when one month holds two salary payments", () => {
		// The June 2025 salary lands early, on 29 May 2025. May then holds two payments and
		// June holds none: 2025 has 12 payments spread over 11 calendar months.
		const transactions = [
			...monthlySalary(2024, 10_000, "a"),
			...monthlySalary(2025, 10_000, "b").map((transaction, monthIndex) =>
				monthIndex === 5 ? { ...transaction, date: at(2025, 4, 29) } : transaction
			),
			...monthlySalary(2026, 10_000, "c"),
		];

		const result = aggregateSalaryProgression(USER_ID, ACCOUNTS, CATEGORIES, transactions, {
			...BASE_QUERY,
			now: new Date(at(2026, 11, 20)),
		});

		const year2025 = result.points.find((point) => point.key === "2025");
		expect(year2025).toMatchObject({
			total: 120_000,
			monthsWithIncome: 11,
			monthsCovered: 12,
			average: 10_000,
			transactionCount: 12,
			isHike: false,
		});
		expect(year2025?.averageGrowthShare).toBe(0);

		const year2026 = result.points.find((point) => point.key === "2026");
		expect(year2026?.average).toBe(10_000);
		expect(year2026?.averageGrowthShare).toBe(0);

		expect(result.hikes).toEqual([]);
		expect(result.overallGrowthShare).toBe(0);
	});

	it("does not dilute the first bucket with months before the first salary", () => {
		const transactions = [
			makeTransaction({ id: "jul", date: at(2025, 6, 25), amount: 10_000 }),
			makeTransaction({ id: "aug", date: at(2025, 7, 25), amount: 10_000 }),
			makeTransaction({ id: "sep", date: at(2025, 8, 25), amount: 10_000 }),
			makeTransaction({ id: "oct", date: at(2025, 9, 25), amount: 10_000 }),
			makeTransaction({ id: "nov", date: at(2025, 10, 25), amount: 10_000 }),
			makeTransaction({ id: "dec", date: at(2025, 11, 25), amount: 10_000 }),
		];

		const result = aggregateSalaryProgression(
			USER_ID,
			ACCOUNTS,
			CATEGORIES,
			transactions,
			BASE_QUERY
		);

		expect(result.points).toHaveLength(1);
		// Jul–Dec, not Jan–Dec: the user was not employed for the first half of the year.
		expect(result.points[0]).toMatchObject({ monthsCovered: 6, total: 60_000, average: 10_000 });
	});

	it("marks the in-progress bucket partial and counts only elapsed months", () => {
		const transactions = [
			...monthlySalary(2024, 10_000, "a"),
			makeTransaction({ id: "jan", date: at(2025, 0, 25), amount: 10_000 }),
			makeTransaction({ id: "feb", date: at(2025, 1, 25), amount: 10_000 }),
			makeTransaction({ id: "mar", date: at(2025, 2, 25), amount: 10_000 }),
		];

		const result = aggregateSalaryProgression(USER_ID, ACCOUNTS, CATEGORIES, transactions, {
			...BASE_QUERY,
			now: new Date(at(2025, 2, 28)),
		});

		expect(result.points[0]).toMatchObject({ isPartial: false, monthsCovered: 12 });
		expect(result.points[1]).toMatchObject({
			isPartial: true,
			monthsCovered: 3,
			total: 30_000,
			average: 10_000,
			isHike: false,
		});
		expect(result.points[1]?.averageGrowthShare).toBe(0);
		expect(result.hikes).toEqual([]);
	});

	it("does not treat a one-off bonus month as a permanent raise", () => {
		const transactions = [
			makeTransaction({ id: "jan", date: at(2025, 0, 25), amount: 10_000 }),
			makeTransaction({ id: "feb", date: at(2025, 1, 25), amount: 10_000 }),
			makeTransaction({ id: "mar", date: at(2025, 2, 25), amount: 20_000 }),
			makeTransaction({ id: "apr", date: at(2025, 3, 25), amount: 10_000 }),
			makeTransaction({ id: "may", date: at(2025, 4, 25), amount: 10_000 }),
		];

		const result = aggregateSalaryProgression(USER_ID, ACCOUNTS, CATEGORIES, transactions, {
			...BASE_QUERY,
			interval: "monthly",
			now: new Date(at(2025, 4, 28)),
		});

		expect(result.points[2]?.averageGrowthShare).toBeCloseTo(1, 6);
		expect(result.points.every((point) => point.isHike === false)).toBe(true);
		expect(result.hikes).toEqual([]);
	});

	it("still reports a monthly raise once the new run-rate holds", () => {
		const transactions = [
			makeTransaction({ id: "jan", date: at(2025, 0, 25), amount: 10_000 }),
			makeTransaction({ id: "feb", date: at(2025, 1, 25), amount: 10_000 }),
			makeTransaction({ id: "mar", date: at(2025, 2, 25), amount: 12_000 }),
			makeTransaction({ id: "apr", date: at(2025, 3, 25), amount: 12_000 }),
			makeTransaction({ id: "may", date: at(2025, 4, 25), amount: 12_000 }),
		];

		const result = aggregateSalaryProgression(USER_ID, ACCOUNTS, CATEGORIES, transactions, {
			...BASE_QUERY,
			interval: "monthly",
			now: new Date(at(2025, 4, 28)),
		});

		expect(result.hikes).toHaveLength(1);
		expect(result.hikes[0]).toMatchObject({
			key: "2025-03",
			fromAverage: 10_000,
			toAverage: 12_000,
		});
		expect(result.hikes[0]?.share).toBeCloseTo(0.2, 6);
	});

	it("counts only the salary category when rental income also exists", () => {
		const categories = [
			makeCategory("cat-salary", "Salary"),
			makeCategory("cat-rent", "Rental Income"),
		];
		const transactions = [
			...monthlySalary(2025, 10_000, "s"),
			makeTransaction({
				id: "rent-1",
				date: at(2025, 3, 5),
				amount: 6_000,
				categoryId: "cat-rent",
			}),
			makeTransaction({
				id: "rent-2",
				date: at(2025, 4, 5),
				amount: 6_000,
				categoryId: "cat-rent",
			}),
		];

		const result = aggregateSalaryProgression(
			USER_ID,
			ACCOUNTS,
			categories,
			transactions,
			BASE_QUERY
		);

		expect(result.usedCategoryIds).toEqual(["cat-salary"]);
		expect(result.usedFallbackAllIncome).toBe(false);
		expect(result.totalEarned).toBe(120_000);
		expect(result.latestAverage).toBe(10_000);
	});

	it("auto-detects the Salary category and ignores Gift income", () => {
		const transactions = [
			...monthlySalary(2025, 10_000, "s"),
			makeTransaction({
				id: "gift",
				date: at(2025, 5, 10),
				amount: 99_000,
				categoryId: "cat-gift",
			}),
		];

		const result = aggregateSalaryProgression(
			USER_ID,
			ACCOUNTS,
			CATEGORIES,
			transactions,
			BASE_QUERY
		);

		expect(result.usedCategoryIds).toEqual(["cat-salary"]);
		expect(result.usedFallbackAllIncome).toBe(false);
		expect(result.totalEarned).toBe(120_000);
	});

	it("falls back to all income when no category looks salary-like", () => {
		const categories = [makeCategory("cat-gift", "Gift")];
		const transactions = [
			makeTransaction({
				id: "gift-1",
				date: at(2025, 5, 10),
				amount: 5_000,
				categoryId: "cat-gift",
			}),
			makeTransaction({
				id: "gift-2",
				date: at(2025, 6, 10),
				amount: 7_000,
				categoryId: "cat-gift",
			}),
		];

		const result = aggregateSalaryProgression(
			USER_ID,
			ACCOUNTS,
			categories,
			transactions,
			BASE_QUERY
		);

		expect(result.usedFallbackAllIncome).toBe(true);
		expect(result.usedCategoryIds).toEqual([]);
		expect(result.totalEarned).toBe(12_000);
	});

	it("aggregates every income row when autoDetect is false", () => {
		const transactions = [
			makeTransaction({ id: "sal", date: at(2025, 5, 10), amount: 5_000 }),
			makeTransaction({ id: "gift", date: at(2025, 6, 10), amount: 7_000, categoryId: "cat-gift" }),
			makeTransaction({ id: "none", date: at(2025, 7, 10), amount: 3_000, categoryId: undefined }),
		];

		const result = aggregateSalaryProgression(USER_ID, ACCOUNTS, CATEGORIES, transactions, {
			...BASE_QUERY,
			autoDetect: false,
		});

		expect(result.usedFallbackAllIncome).toBe(false);
		expect(result.usedCategoryIds).toEqual([]);
		expect(result.totalEarned).toBe(15_000);
	});

	it("lets explicit categoryIds override auto-detection", () => {
		const transactions = [
			makeTransaction({ id: "sal", date: at(2025, 5, 10), amount: 5_000 }),
			makeTransaction({ id: "gift", date: at(2025, 6, 10), amount: 7_000, categoryId: "cat-gift" }),
		];

		const result = aggregateSalaryProgression(USER_ID, ACCOUNTS, CATEGORIES, transactions, {
			...BASE_QUERY,
			categoryIds: ["cat-gift"],
		});

		expect(result.usedCategoryIds).toEqual(["cat-gift"]);
		expect(result.usedFallbackAllIncome).toBe(false);
		expect(result.totalEarned).toBe(7_000);
	});

	it("excludes expenses, transfers, deleted rows, and other users", () => {
		const transactions = [
			makeTransaction({ id: "sal", date: at(2025, 5, 10), amount: 5_000 }),
			makeTransaction({ id: "exp", date: at(2025, 5, 11), amount: 1_000, type: "Expense" }),
			makeTransaction({
				id: "xfer",
				date: at(2025, 5, 12),
				amount: 2_000,
				type: "Transfer",
				toAccountId: "acc-usd",
			}),
			makeTransaction({ id: "deleted", date: at(2025, 5, 13), amount: 4_000, deletedAt: 123 }),
			makeTransaction({ id: "other", date: at(2025, 5, 14), amount: 8_000, userId: OTHER_USER_ID }),
		];

		const result = aggregateSalaryProgression(
			USER_ID,
			ACCOUNTS,
			CATEGORIES,
			transactions,
			BASE_QUERY
		);

		expect(result.totalEarned).toBe(5_000);
		expect(result.points.at(-1)?.transactionCount).toBe(1);
	});

	it("never mixes currencies across accounts", () => {
		const transactions = [
			makeTransaction({ id: "aed", date: at(2025, 5, 10), amount: 5_000 }),
			makeTransaction({ id: "usd", date: at(2025, 5, 11), amount: 900, accountId: "acc-usd" }),
		];

		const aed = aggregateSalaryProgression(USER_ID, ACCOUNTS, CATEGORIES, transactions, BASE_QUERY);
		const usd = aggregateSalaryProgression(USER_ID, ACCOUNTS, CATEGORIES, transactions, {
			...BASE_QUERY,
			currency: "USD",
		});

		expect(aed.totalEarned).toBe(5_000);
		expect(usd.totalEarned).toBe(900);
	});

	it("trims to a trailing window and zero-fills gaps contiguously", () => {
		const transactions = [...monthlySalary(2024, 10_000, "a"), ...monthlySalary(2025, 12_000, "b")];

		const result = aggregateSalaryProgression(USER_ID, ACCOUNTS, CATEGORIES, transactions, {
			...BASE_QUERY,
			years: 5,
		});

		expect(result.points.map((point) => point.key)).toEqual([
			"2020",
			"2021",
			"2022",
			"2023",
			"2024",
			"2025",
		]);
		for (const [index, point] of result.points.entries()) {
			if (index === 0) continue;
			expect((result.points[index - 1]?.toMs ?? 0) + 1).toBe(point.fromMs);
		}
		expect(result.points.slice(0, 4).every((point) => point.total === 0)).toBe(true);
		expect(result.points.slice(0, 4).every((point) => point.average === 0)).toBe(true);
		expect(result.points.slice(0, 4).every((point) => point.isHike === false)).toBe(true);
		expect(result.points[4]?.averageGrowthShare).toBeNull();
		expect(result.points[5]?.averageGrowthShare).toBeCloseTo(0.2, 6);
	});

	it("returns null growth metrics instead of NaN or Infinity", () => {
		const single = aggregateSalaryProgression(
			USER_ID,
			ACCOUNTS,
			CATEGORIES,
			monthlySalary(2025, 10_000, "s"),
			BASE_QUERY
		);
		expect(single.points).toHaveLength(1);
		expect(single.cagr).toBeNull();
		expect(single.overallGrowthShare).toBe(0);

		const empty = aggregateSalaryProgression(USER_ID, ACCOUNTS, CATEGORIES, [], {
			...BASE_QUERY,
			years: 3,
		});
		expect(empty.points).toHaveLength(4);
		expect(empty.startingAverage).toBe(0);
		expect(empty.overallGrowthShare).toBeNull();
		expect(empty.cagr).toBeNull();
		expect(empty.firstSalaryMs).toBeUndefined();
	});

	it("does not report a hike after a single month without income", () => {
		const transactions = [
			makeTransaction({ id: "jan", date: at(2025, 0, 25), amount: 10_000 }),
			makeTransaction({ id: "feb", date: at(2025, 1, 25), amount: 10_000 }),
			makeTransaction({ id: "apr", date: at(2025, 3, 25), amount: 10_000 }),
		];

		const result = aggregateSalaryProgression(USER_ID, ACCOUNTS, CATEGORIES, transactions, {
			...BASE_QUERY,
			interval: "monthly",
			now: new Date(at(2025, 3, 28)),
		});

		expect(result.points.map((point) => point.key)).toEqual([
			"2025-01",
			"2025-02",
			"2025-03",
			"2025-04",
		]);
		expect(result.points[2]?.monthsWithIncome).toBe(0);
		expect(result.points[3]?.averageGrowthShare).toBe(0);
		expect(result.hikes).toEqual([]);
	});

	it("refuses to run without an explicit currency", () => {
		expect(() =>
			aggregateSalaryProgression(USER_ID, ACCOUNTS, CATEGORIES, [], {
				...BASE_QUERY,
				currency: "  ",
			})
		).toThrow("Analytics queries require an explicit currency. Refusing to mix currencies.");
	});

	it("produces identical output from the chunked aggregator", async () => {
		const transactions = [...monthlySalary(2024, 10_000, "a"), ...monthlySalary(2025, 12_000, "b")];

		const sync = aggregateSalaryProgression(
			USER_ID,
			ACCOUNTS,
			CATEGORIES,
			transactions,
			BASE_QUERY
		);
		const chunked = await aggregateSalaryProgressionChunked(
			USER_ID,
			ACCOUNTS,
			CATEGORIES,
			transactions,
			BASE_QUERY,
			{ batchSize: 1 }
		);

		expect(chunked).toEqual(sync);
	});

	it("builds a stable cache key regardless of key order", () => {
		const first = getSalaryProgressionCacheKey({ ...BASE_QUERY, interval: "yearly", years: 5 });
		const second = getSalaryProgressionCacheKey({ years: 5, interval: "yearly", ...BASE_QUERY });

		expect(first).toBe(second);
		expect(first).not.toBe(getSalaryProgressionCacheKey({ ...BASE_QUERY, years: 3 }));
	});
});

describe("isSalaryCategoryTitle", () => {
	it("matches salary-like titles", () => {
		expect(isSalaryCategoryTitle("Salary")).toBe(true);
		expect(isSalaryCategoryTitle("Monthly Salary")).toBe(true);
		expect(isSalaryCategoryTitle("Payroll")).toBe(true);
		expect(isSalaryCategoryTitle("Bonus")).toBe(true);
		expect(isSalaryCategoryTitle("Provident Fund")).toBe(true);
	});

	it("does not match investment or other non-salary income", () => {
		expect(isSalaryCategoryTitle("Rental Income")).toBe(false);
		expect(isSalaryCategoryTitle("Interest Income")).toBe(false);
		expect(isSalaryCategoryTitle("Dividend Income")).toBe(false);
		expect(isSalaryCategoryTitle("Other Income")).toBe(false);
		expect(isSalaryCategoryTitle("Income Tax Refund")).toBe(false);
		expect(isSalaryCategoryTitle("Google Pay Cashback")).toBe(false);
		expect(isSalaryCategoryTitle("Allowance from parents")).toBe(false);
	});

	it("rejects disqualified titles even when they contain a salary keyword", () => {
		expect(isSalaryCategoryTitle("Salary Advance Repayment")).toBe(false);
		expect(isSalaryCategoryTitle("Salary Loan")).toBe(false);
		expect(isSalaryCategoryTitle("Bonus Tax")).toBe(false);
	});

	it("does not match unrelated or near-miss titles", () => {
		expect(isSalaryCategoryTitle("Groceries")).toBe(false);
		// "payment"/"paypal" must never be swallowed by a short pay-like stem.
		expect(isSalaryCategoryTitle("Payment Received")).toBe(false);
		expect(isSalaryCategoryTitle("Payment to landlord")).toBe(false);
		expect(isSalaryCategoryTitle("Loan Repayment")).toBe(false);
		expect(isSalaryCategoryTitle("Paypal Refund")).toBe(false);
		expect(isSalaryCategoryTitle("")).toBe(false);
	});
});
