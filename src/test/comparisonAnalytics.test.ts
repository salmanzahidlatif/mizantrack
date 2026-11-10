import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import {
	aggregateComparisonAnalytics,
	aggregateComparisonAnalyticsChunked,
	getComparisonAnalyticsCacheKey,
} from "@/lib/analytics/comparisonAnalytics";
import { UNCATEGORIZED_CATEGORY_ID } from "@/lib/analytics/periodAnalytics";
import {
	COMPARISON_PRESET_OPTIONS,
	getComparisonRangeDayCount,
	resolveComparisonRanges,
	type ComparisonPresetId,
	type ComparisonRangeBounds,
} from "@/lib/comparisonPresets";

import type { Account, Category, Transaction } from "@/types";

const USER_ID = "comparison-user";
const OTHER_USER_ID = "other-user";
const GST_OFFSET_MINUTES = 4 * 60;
/** 2026-06-15T10:00:00 in GST (UTC+4). */
const NOW = new Date(Date.UTC(2026, 5, 15, 6, 0, 0));
const UPDATED_AT = Date.UTC(2026, 5, 15, 6, 0, 0);

function gst(year: number, monthIndex: number, day: number): number {
	return Date.UTC(year, monthIndex, day, 12, 0, 0) - GST_OFFSET_MINUTES * 60 * 1000;
}

function gstStartOfDay(year: number, monthIndex: number, day: number): number {
	return Date.UTC(year, monthIndex, day) - GST_OFFSET_MINUTES * 60 * 1000;
}

function gstEndOfDay(year: number, monthIndex: number, day: number): number {
	return gstStartOfDay(year, monthIndex, day + 1) - 1;
}

function days(range: ComparisonRangeBounds): number {
	return getComparisonRangeDayCount(range, GST_OFFSET_MINUTES);
}

const ACCOUNTS: Account[] = [
	{
		id: "acc-aed",
		userId: USER_ID,
		title: "Main AED",
		openingBalance: 0,
		currency: "AED",
		isArchived: false,
		updatedAt: UPDATED_AT,
	},
	{
		id: "acc-usd",
		userId: USER_ID,
		title: "Travel USD",
		openingBalance: 0,
		currency: "USD",
		isArchived: false,
		updatedAt: UPDATED_AT,
	},
	{
		id: "acc-other-user",
		userId: OTHER_USER_ID,
		title: "Someone else",
		openingBalance: 0,
		currency: "AED",
		isArchived: false,
		updatedAt: UPDATED_AT,
	},
];

const CATEGORIES: Category[] = [
	{
		id: "cat-internet",
		userId: USER_ID,
		title: "Home Internet",
		type: "Expense",
		icon: "wifi",
		color: "#2563eb",
		updatedAt: UPDATED_AT,
	},
	{
		id: "cat-dining",
		userId: USER_ID,
		title: "Dining Out",
		type: "Expense",
		updatedAt: UPDATED_AT,
	},
	{
		id: "cat-gym",
		userId: USER_ID,
		title: "Gym",
		type: "Expense",
		updatedAt: UPDATED_AT,
	},
	{
		id: "cat-salary",
		userId: USER_ID,
		title: "Salary",
		type: "Income",
		updatedAt: UPDATED_AT,
	},
];

let transactionSeq = 0;

function txn(overrides: Partial<Transaction> & Pick<Transaction, "date" | "amount">): Transaction {
	transactionSeq++;
	return {
		id: `txn-${transactionSeq}`,
		userId: USER_ID,
		type: "Expense",
		accountId: "acc-aed",
		updatedAt: UPDATED_AT,
		...overrides,
	};
}

/**
 * Preset `half-vs-prev-half` with now = 15 Jun 2026:
 * current  = 1 Jan 2026 .. 15 Jun 2026 (166 days, ends today)
 * previous = 19 Jul 2025 .. 31 Dec 2025 (the preceding 166 days)
 */
function buildTransactions(): Transaction[] {
	return [
		// Home Internet: 500/mo previously, 300/mo now -> savings.
		txn({ date: gst(2025, 8, 10), amount: 500, categoryId: "cat-internet" }),
		txn({ date: gst(2025, 9, 10), amount: 500, categoryId: "cat-internet" }),
		txn({ date: gst(2026, 1, 10), amount: 300, categoryId: "cat-internet" }),
		txn({ date: gst(2026, 2, 10), amount: 300, categoryId: "cat-internet" }),
		// Dining Out increased.
		txn({ date: gst(2025, 10, 5), amount: 200, categoryId: "cat-dining" }),
		txn({ date: gst(2026, 3, 5), amount: 650, categoryId: "cat-dining" }),
		// Gym is brand new this period.
		txn({ date: gst(2026, 4, 1), amount: 120, categoryId: "cat-gym" }),
		// Income grew.
		txn({ date: gst(2025, 7, 1), amount: 9000, type: "Income", categoryId: "cat-salary" }),
		txn({ date: gst(2026, 0, 1), amount: 11000, type: "Income", categoryId: "cat-salary" }),
		// Uncategorized expenses in both periods.
		txn({ date: gst(2025, 11, 20), amount: 80 }),
		txn({ date: gst(2026, 5, 2), amount: 30 }),
		// Excluded: transfers.
		txn({ date: gst(2026, 2, 3), amount: 5000, type: "Transfer", toAccountId: "acc-usd" }),
		txn({ date: gst(2025, 9, 3), amount: 4000, type: "Transfer", toAccountId: "acc-usd" }),
		// Excluded: soft-deleted.
		txn({
			date: gst(2026, 2, 4),
			amount: 7777,
			categoryId: "cat-dining",
			deletedAt: UPDATED_AT,
		}),
		// Excluded: other user.
		txn({
			date: gst(2026, 2, 5),
			amount: 8888,
			userId: OTHER_USER_ID,
			accountId: "acc-other-user",
			categoryId: "cat-dining",
		}),
		// Excluded: different currency account.
		txn({ date: gst(2026, 2, 6), amount: 9999, accountId: "acc-usd", categoryId: "cat-dining" }),
		// Excluded: outside both windows.
		txn({ date: gst(2025, 2, 6), amount: 1234, categoryId: "cat-dining" }),
	];
}

const QUERY = {
	currency: "AED",
	presetId: "half-vs-prev-half" as ComparisonPresetId,
	now: NOW,
	timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
};

function run(transactions = buildTransactions()) {
	return aggregateComparisonAnalytics(USER_ID, ACCOUNTS, CATEGORIES, transactions, QUERY);
}

describe("resolveComparisonRanges", () => {
	it("exposes every preset as a selectable option", () => {
		expect(COMPARISON_PRESET_OPTIONS.map((option) => option.value)).toEqual([
			"month-vs-last-month",
			"quarter-vs-prev-quarter",
			"half-vs-prev-half",
			"year-rolling-vs-prev",
			"year-vs-last-year",
			"custom",
		]);
	});

	it("keeps every preset non-overlapping, equal in days, and never ending in the future", () => {
		for (const option of COMPARISON_PRESET_OPTIONS) {
			const pair = resolveComparisonRanges({
				presetId: option.value,
				now: NOW,
				customRange: {
					from: new Date(gstStartOfDay(2026, 3, 1)),
					to: new Date(gstEndOfDay(2026, 4, 31)),
				},
				fiscalYearStartMonth: 7,
				timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
			});

			expect(pair.previous.toMs).toBeLessThan(pair.current.fromMs);
			expect(days(pair.previous)).toBe(days(pair.current));
			expect(pair.current.toMs).toBeLessThanOrEqual(gstEndOfDay(2026, 5, 15));
			expect(pair.current.toMs).toBeGreaterThan(pair.current.fromMs);
		}
	});

	it("ends rolling windows today and precedes them with an equal-length window", () => {
		const pair = resolveComparisonRanges({
			presetId: "half-vs-prev-half",
			now: NOW,
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});

		expect(pair.current.fromMs).toBe(gstStartOfDay(2026, 0, 1));
		expect(pair.current.toMs).toBe(gstEndOfDay(2026, 5, 15));
		expect(pair.current.label).toBe("1 Jan – 15 Jun 2026");
		expect(pair.previous.toMs).toBe(pair.current.fromMs - 1);
		expect(pair.previous.fromMs).toBe(gstStartOfDay(2025, 6, 19));
		expect(pair.previous.label).toBe("19 Jul – 31 Dec 2025");
		expect(days(pair.current)).toBe(166);
		expect(days(pair.previous)).toBe(166);
	});

	it("compares this month to date against the same days of last month", () => {
		const pair = resolveComparisonRanges({
			presetId: "month-vs-last-month",
			now: NOW,
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});

		expect(pair.current.fromMs).toBe(gstStartOfDay(2026, 5, 1));
		expect(pair.current.toMs).toBe(gstEndOfDay(2026, 5, 15));
		expect(pair.previous.fromMs).toBe(gstStartOfDay(2026, 4, 1));
		expect(pair.previous.toMs).toBe(gstEndOfDay(2026, 4, 15));
		expect(pair.current.label).toBe("1 Jun – 15 Jun 2026");
		expect(pair.previous.label).toBe("1 May – 15 May 2026");
	});

	it("slides the previous month window back when the earlier month is too short", () => {
		const pair = resolveComparisonRanges({
			presetId: "month-vs-last-month",
			now: new Date(gst(2026, 2, 31)),
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});

		expect(pair.current.fromMs).toBe(gstStartOfDay(2026, 2, 1));
		expect(pair.current.toMs).toBe(gstEndOfDay(2026, 2, 31));
		expect(pair.previous.toMs).toBe(pair.current.fromMs - 1);
		expect(days(pair.previous)).toBe(days(pair.current));
		expect(days(pair.current)).toBe(31);
	});

	it("uses the calendar year by default and the fiscal year when configured", () => {
		const calendar = resolveComparisonRanges({
			presetId: "year-vs-last-year",
			now: NOW,
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});
		expect(calendar.current.label).toBe("1 Jan – 15 Jun 2026");
		expect(calendar.previous.label).toBe("1 Jan – 15 Jun 2025");
		expect(days(calendar.previous)).toBe(days(calendar.current));

		const fiscal = resolveComparisonRanges({
			presetId: "year-vs-last-year",
			now: NOW,
			fiscalYearStartMonth: 7,
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});
		expect(fiscal.current.label).toBe("1 Jul 2025 – 15 Jun 2026");
		expect(fiscal.previous.label).toBe("1 Jul 2024 – 15 Jun 2025");
		expect(fiscal.previous.toMs).toBeLessThan(fiscal.current.fromMs);
		expect(days(fiscal.previous)).toBe(days(fiscal.current));
	});

	it("compares the default fiscal year only up to today, not against twelve full months", () => {
		const pair = resolveComparisonRanges({
			presetId: "year-vs-last-year",
			now: new Date(gst(2026, 10, 10)),
			fiscalYearStartMonth: 7,
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});

		expect(pair.current.fromMs).toBe(gstStartOfDay(2026, 6, 1));
		expect(pair.current.toMs).toBe(gstEndOfDay(2026, 10, 10));
		expect(pair.previous.fromMs).toBe(gstStartOfDay(2025, 6, 1));
		expect(pair.previous.toMs).toBe(gstEndOfDay(2025, 10, 10));
		expect(days(pair.current)).toBe(133);
		expect(days(pair.previous)).toBe(days(pair.current));
		expect(pair.current.label).toBe("1 Jul – 10 Nov 2026");
	});

	it("keeps leap-day windows valid when shifted back a year", () => {
		const pair = resolveComparisonRanges({
			presetId: "year-vs-last-year",
			now: new Date(gst(2028, 1, 29)),
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});

		expect(pair.current.toMs).toBe(gstEndOfDay(2028, 1, 29));
		expect(pair.previous.fromMs).toBe(gstStartOfDay(2027, 0, 1));
		expect(pair.previous.toMs).toBe(gstEndOfDay(2027, 2, 1));
		expect(days(pair.previous)).toBe(days(pair.current));
		expect(pair.previous.label).toBe("1 Jan – 1 Mar 2027");

		const custom = resolveComparisonRanges({
			presetId: "custom",
			now: new Date(gst(2028, 2, 10)),
			customRange: { from: new Date(gst(2028, 1, 29)), to: new Date(gst(2028, 2, 10)) },
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});
		expect(custom.current.label).toBe("29 Feb – 10 Mar 2028");
		expect(days(custom.previous)).toBe(days(custom.current));
	});

	it("derives an equal-length preceding window for custom ranges", () => {
		const from = new Date(gst(2026, 3, 1));
		const to = new Date(gst(2026, 4, 31));
		const pair = resolveComparisonRanges({
			presetId: "custom",
			now: NOW,
			customRange: { from, to },
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});

		// Snapped to whole local days so the day-count invariant holds.
		expect(pair.current.fromMs).toBe(gstStartOfDay(2026, 3, 1));
		expect(pair.current.toMs).toBe(gstEndOfDay(2026, 4, 31));
		expect(pair.previous.toMs).toBe(pair.current.fromMs - 1);
		expect(days(pair.previous)).toBe(days(pair.current));
		expect(days(pair.current)).toBe(61);
	});

	it("clamps an unbounded custom range instead of throwing", () => {
		const pair = resolveComparisonRanges({
			presetId: "custom",
			now: NOW,
			customRange: { from: new Date(0), to: new Date(8.64e15) },
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});

		expect(pair.current.toMs).toBe(gstEndOfDay(2026, 5, 15));
		expect(days(pair.previous)).toBe(days(pair.current));
		expect(pair.previous.fromMs).toBeGreaterThan(-8.64e15);
		expect(pair.current.label).not.toBe("Unknown range");
		expect(pair.previous.label).not.toBe("Unknown range");
	});

	it("swaps an inverted custom range into a sane window", () => {
		const pair = resolveComparisonRanges({
			presetId: "custom",
			now: NOW,
			customRange: { from: new Date(gst(2026, 4, 31)), to: new Date(gst(2026, 3, 1)) },
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});

		expect(pair.current.fromMs).toBe(gstStartOfDay(2026, 3, 1));
		expect(pair.current.toMs).toBe(gstEndOfDay(2026, 4, 31));
		expect(pair.previous.toMs).toBe(pair.current.fromMs - 1);
		expect(days(pair.previous)).toBe(days(pair.current));
	});

	it("falls back to the rolling window for an unusable custom range", () => {
		const invalid = resolveComparisonRanges({
			presetId: "custom",
			now: NOW,
			customRange: { from: new Date(Number.NaN), to: new Date(gst(2026, 3, 1)) },
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});
		const half = resolveComparisonRanges({
			presetId: "half-vs-prev-half",
			now: NOW,
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});

		expect(invalid.current).toEqual(half.current);
		expect(invalid.previous).toEqual(half.previous);
	});

	it("falls back to the six-month behaviour when a custom range is missing", () => {
		const fallback = resolveComparisonRanges({
			presetId: "custom",
			now: NOW,
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});
		const half = resolveComparisonRanges({
			presetId: "half-vs-prev-half",
			now: NOW,
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});

		expect(fallback.presetId).toBe("custom");
		expect(fallback.current).toEqual(half.current);
		expect(fallback.previous).toEqual(half.previous);
	});
});

describe("aggregateComparisonAnalytics", () => {
	it("surfaces a category that now costs less as a top saving", () => {
		const result = run();
		const internet = result.expenseCategories.find((item) => item.categoryId === "cat-internet");

		expect(internet).toMatchObject({
			title: "Home Internet",
			icon: "wifi",
			color: "#2563eb",
			previousAmount: 1000,
			currentAmount: 600,
			delta: -400,
			savings: 400,
			changeShare: -0.4,
			isNew: false,
			isDropped: false,
		});
		expect(result.topSavings[0]?.categoryId).toBe("cat-internet");
		expect(result.totals.expenseSavings).toBe(1000 + 200 + 80 - (600 + 650 + 120 + 30));
		expect(result.totals.incomeGrowth).toBe(2000);
		expect(result.totals.totalBenefit).toBe(result.totals.currentNet - result.totals.previousNet);
	});

	it("surfaces a category that now costs more as a top increase", () => {
		const result = run();

		expect(result.topIncreases[0]).toMatchObject({
			categoryId: "cat-dining",
			previousAmount: 200,
			currentAmount: 650,
			delta: 450,
			savings: -450,
			changeShare: 2.25,
		});
		expect(result.topSavings.every((item) => item.savings > 0)).toBe(true);
		expect(result.topIncreases.every((item) => item.savings < 0)).toBe(true);
	});

	it("excludes transfers, soft-deleted rows, other users, and other currencies", () => {
		const result = run();

		expect(result.totals.currentExpense).toBe(600 + 650 + 120 + 30);
		expect(result.totals.previousExpense).toBe(1000 + 200 + 80);
		expect(result.totals.currentTransactionCount).toBe(6);
		expect(result.totals.previousTransactionCount).toBe(5);
		expect(
			result.expenseCategories.some(
				(item) => item.currentAmount >= 5000 || item.previousAmount >= 4000
			)
		).toBe(false);
	});

	it("isolates currencies so another currency never leaks in", () => {
		const usdOnly = aggregateComparisonAnalytics(
			USER_ID,
			ACCOUNTS,
			CATEGORIES,
			buildTransactions(),
			{
				...QUERY,
				currency: "USD",
			}
		);

		expect(usdOnly.totals.currentExpense).toBe(9999);
		expect(usdOnly.totals.previousExpense).toBe(0);
		expect(usdOnly.totals.currentIncome).toBe(0);
	});

	it("marks brand-new categories and leaves changeShare null without a baseline", () => {
		const gym = run().expenseCategories.find((item) => item.categoryId === "cat-gym");

		expect(gym).toMatchObject({
			previousAmount: 0,
			currentAmount: 120,
			savings: -120,
			changeShare: null,
			isNew: true,
			isDropped: false,
		});
	});

	it("marks categories that disappeared as dropped", () => {
		const result = run([
			txn({ date: gst(2025, 8, 10), amount: 400, categoryId: "cat-gym" }),
			txn({ date: gst(2026, 1, 10), amount: 100, categoryId: "cat-internet" }),
		]);
		const gym = result.expenseCategories.find((item) => item.categoryId === "cat-gym");

		expect(gym).toMatchObject({ isNew: false, isDropped: true, savings: 400 });
	});

	it("rolls uncategorized and mismatched-type transactions into the sentinel bucket", () => {
		const result = run([
			txn({ date: gst(2025, 8, 10), amount: 90 }),
			txn({ date: gst(2026, 1, 10), amount: 40 }),
			// Income category on an expense row must not match the expense breakdown.
			txn({ date: gst(2026, 1, 11), amount: 10, categoryId: "cat-salary" }),
		]);
		const uncategorized = result.expenseCategories.find((item) => item.categoryId === null);

		expect(result.expenseCategories).toHaveLength(1);
		expect(uncategorized).toMatchObject({
			title: "Uncategorized",
			previousAmount: 90,
			currentAmount: 50,
			savings: 40,
		});
		expect(UNCATEGORIZED_CATEGORY_ID).toBe("__uncategorized__");
	});

	it("respects topCount when capping the highlight lists", () => {
		const result = aggregateComparisonAnalytics(
			USER_ID,
			ACCOUNTS,
			CATEGORIES,
			buildTransactions(),
			{ ...QUERY, topCount: 1 }
		);

		expect(result.topSavings).toHaveLength(1);
		expect(result.topIncreases).toHaveLength(1);
	});

	it("refuses to run without an explicit currency", () => {
		expect(() =>
			aggregateComparisonAnalytics(USER_ID, ACCOUNTS, CATEGORIES, buildTransactions(), {
				...QUERY,
				currency: "   ",
			})
		).toThrow("Analytics queries require an explicit currency. Refusing to mix currencies.");
	});

	it("produces identical results from the chunked aggregator", async () => {
		const transactions = buildTransactions();
		const sync = aggregateComparisonAnalytics(USER_ID, ACCOUNTS, CATEGORIES, transactions, QUERY);
		const chunked = await aggregateComparisonAnalyticsChunked(
			USER_ID,
			ACCOUNTS,
			CATEGORIES,
			transactions,
			QUERY,
			{ batchSize: 2, yieldNow: async () => undefined }
		);

		expect(chunked).toEqual(sync);
	});
});

describe("period-to-date aggregation", () => {
	/** 10 Nov 2026 in GST, the default dashboard configuration (fiscal year starts in July). */
	const NOV_10 = new Date(gst(2026, 10, 10));
	const DEFAULT_QUERY = {
		currency: "AED",
		presetId: "year-vs-last-year" as ComparisonPresetId,
		now: NOV_10,
		fiscalYearStartMonth: 7,
		timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
	};

	/** One payment on the 1st of every month from Jul 2025 through Nov 2026. */
	function monthlyExpense(
		amount: (year: number, monthIndex: number) => number,
		categoryId: string
	): Transaction[] {
		const rows: Transaction[] = [];
		for (let offset = 0; offset < 17; offset++) {
			const monthIndex = 6 + offset;
			const year = 2025 + Math.floor(monthIndex / 12);
			const month = monthIndex % 12;
			rows.push(txn({ date: gst(year, month, 1), amount: amount(year, month), categoryId }));
		}
		return rows;
	}

	it("reports no saving for a flat recurring expense across equal elapsed windows", () => {
		const result = aggregateComparisonAnalytics(
			USER_ID,
			ACCOUNTS,
			CATEGORIES,
			monthlyExpense(() => 500, "cat-internet"),
			DEFAULT_QUERY
		);
		const internet = result.expenseCategories.find((item) => item.categoryId === "cat-internet");

		expect(internet).toMatchObject({ previousAmount: 2500, currentAmount: 2500 });
		expect(internet?.savings).toBeCloseTo(0);
		expect(result.totals.expenseSavings).toBe(0);
		expect(result.totals.totalBenefit).toBe(0);
		expect(result.totals.currentTransactionCount).toBe(result.totals.previousTransactionCount);
	});

	it("still surfaces a genuine recurring saving over equal elapsed windows", () => {
		const result = aggregateComparisonAnalytics(
			USER_ID,
			ACCOUNTS,
			CATEGORIES,
			monthlyExpense((year) => (year === 2025 ? 500 : 300), "cat-internet"),
			DEFAULT_QUERY
		);
		const internet = result.expenseCategories.find((item) => item.categoryId === "cat-internet");

		// 5 payments in each window: 5 x 500 previously, 5 x 300 now.
		expect(internet).toMatchObject({
			previousAmount: 2500,
			currentAmount: 1500,
			savings: 1000,
			changeShare: -0.4,
		});
		expect(result.totals.expenseSavings).toBe(1000);
		expect(result.totals.totalBenefit).toBe(1000);
	});

	it("does not pretend income collapsed when the year is only part-way through", () => {
		const salary = Array.from({ length: 17 }, (_, offset) => {
			const monthIndex = 6 + offset;
			return txn({
				date: gst(2025 + Math.floor(monthIndex / 12), monthIndex % 12, 25),
				amount: 10_000,
				type: "Income",
				categoryId: "cat-salary",
			});
		});
		const result = aggregateComparisonAnalytics(
			USER_ID,
			ACCOUNTS,
			CATEGORIES,
			salary,
			DEFAULT_QUERY
		);

		expect(result.totals.currentIncome).toBe(result.totals.previousIncome);
		expect(result.totals.incomeGrowth).toBe(0);
	});
});

describe("getComparisonAnalyticsCacheKey", () => {
	it("is stable across different `now` values inside the same day", () => {
		const first = getComparisonAnalyticsCacheKey(QUERY);
		const second = getComparisonAnalyticsCacheKey({
			...QUERY,
			now: new Date(NOW.getTime() + 6 * 60 * 60 * 1000),
		});

		expect(second).toBe(first);
	});

	it("changes when the day rolls over, because the window now ends today", () => {
		const first = getComparisonAnalyticsCacheKey(QUERY);
		const nextDay = getComparisonAnalyticsCacheKey({
			...QUERY,
			now: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
		});

		expect(nextDay).not.toBe(first);
	});

	it("changes when the window, currency, or options change", () => {
		const base = getComparisonAnalyticsCacheKey(QUERY);

		expect(getComparisonAnalyticsCacheKey({ ...QUERY, currency: "USD" })).not.toBe(base);
		expect(getComparisonAnalyticsCacheKey({ ...QUERY, topCount: 10 })).not.toBe(base);
		expect(
			getComparisonAnalyticsCacheKey({ ...QUERY, now: new Date(Date.UTC(2026, 8, 15, 6, 0, 0)) })
		).not.toBe(base);
	});

	it("never throws for degenerate custom ranges", () => {
		const degenerate = [
			{ from: new Date(0), to: new Date(8.64e15) },
			{ from: new Date(8.64e15), to: new Date(0) },
			{ from: new Date(Number.NaN), to: new Date(Number.NaN) },
		];

		for (const customRange of degenerate) {
			expect(() =>
				getComparisonAnalyticsCacheKey({
					...QUERY,
					presetId: "custom",
					customRange,
					timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
				})
			).not.toThrow();
		}
	});
});
