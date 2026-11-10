import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import {
	getCachedAnalyticsValue,
	getComparisonAnalytics,
	getComparisonAnalyticsCacheKey,
	getSalaryProgression,
	getSalaryProgressionCacheKey,
	stripAnalyticsQueryCache,
} from "@/lib/analytics/cache";
import {
	ANALYTICS_CACHE_LOGIC_VERSION,
	buildAnalyticsDataVersion,
	getAnalyticsSourceData,
} from "@/lib/analytics/cacheMetadata";
import { sanitizeDashboardStats } from "@/lib/analytics/computeDashboardStats";
import { db } from "@/lib/db/local";

import type { ComparisonAnalyticsQuery } from "@/lib/analytics/comparisonAnalytics";
import type { SalaryProgressionQuery } from "@/lib/analytics/salaryProgression";
import type { Account, Category, DashboardStats, Transaction } from "@/types";

const USER_ID = "comparison-salary-user";
const ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440201";
const SALARY_CATEGORY_ID = "550e8400-e29b-41d4-a716-446655440202";
const FOOD_CATEGORY_ID = "550e8400-e29b-41d4-a716-446655440203";
const GST_OFFSET_MINUTES = 4 * 60;
const MS_PER_MINUTE = 60 * 1000;
const NOW = new Date(Date.UTC(2026, 8, 30, 12) - GST_OFFSET_MINUTES * MS_PER_MINUTE);
const CURRENT_EXPENSE_ID = "txn-expense-current";
const LATEST_SALARY_ID = "txn-salary-2026-08";

function at(year: number, monthIndex: number, day: number): number {
	return Date.UTC(year, monthIndex, day, 12) - GST_OFFSET_MINUTES * MS_PER_MINUTE;
}

function account(): Account {
	return {
		id: ACCOUNT_ID,
		userId: USER_ID,
		title: "Current",
		openingBalance: 0,
		currency: "AED",
		isArchived: false,
		updatedAt: 1,
	};
}

function categories(): Category[] {
	return [
		{
			id: SALARY_CATEGORY_ID,
			userId: USER_ID,
			title: "Salary",
			type: "Income",
			updatedAt: 1,
		},
		{
			id: FOOD_CATEGORY_ID,
			userId: USER_ID,
			title: "Food",
			type: "Expense",
			updatedAt: 1,
		},
	];
}

function transactions(): Transaction[] {
	return [
		{
			id: CURRENT_EXPENSE_ID,
			userId: USER_ID,
			type: "Expense",
			date: at(2026, 8, 15),
			amount: 100,
			accountId: ACCOUNT_ID,
			categoryId: FOOD_CATEGORY_ID,
			updatedAt: 1,
		},
		{
			id: "txn-expense-previous",
			userId: USER_ID,
			type: "Expense",
			date: at(2026, 7, 15),
			amount: 300,
			accountId: ACCOUNT_ID,
			categoryId: FOOD_CATEGORY_ID,
			updatedAt: 1,
		},
		{
			id: "txn-salary-2026-06",
			userId: USER_ID,
			type: "Income",
			date: at(2026, 6, 25),
			amount: 10_000,
			accountId: ACCOUNT_ID,
			categoryId: SALARY_CATEGORY_ID,
			updatedAt: 1,
		},
		{
			id: "txn-salary-2026-07",
			userId: USER_ID,
			type: "Income",
			date: at(2026, 7, 25),
			amount: 10_000,
			accountId: ACCOUNT_ID,
			categoryId: SALARY_CATEGORY_ID,
			updatedAt: 1,
		},
		{
			id: LATEST_SALARY_ID,
			userId: USER_ID,
			type: "Income",
			date: at(2026, 8, 25),
			amount: 12_000,
			accountId: ACCOUNT_ID,
			categoryId: SALARY_CATEGORY_ID,
			updatedAt: 1,
		},
	];
}

async function seed() {
	await db.accounts.bulkPut([account()]);
	await db.categories.bulkPut(categories());
	await db.transactions.bulkPut(transactions());
}

function comparisonQuery(
	overrides: Partial<ComparisonAnalyticsQuery> = {}
): ComparisonAnalyticsQuery {
	return {
		currency: "AED",
		presetId: "month-vs-last-month",
		now: NOW,
		timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		...overrides,
	};
}

function salaryQuery(overrides: Partial<SalaryProgressionQuery> = {}): SalaryProgressionQuery {
	return {
		currency: "AED",
		interval: "monthly",
		years: 1,
		now: NOW,
		timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		...overrides,
	};
}

async function readEntry(namespace: "comparisons" | "salaryProgression", key: string) {
	const stats = await db.dashboardStats.get(USER_ID);
	return stats?.analyticsCache?.[namespace]?.[key];
}

async function overwriteCachedValue(
	namespace: "comparisons" | "salaryProgression",
	key: string,
	value: unknown
) {
	const stats = await db.dashboardStats.get(USER_ID);
	const entry = stats?.analyticsCache?.[namespace]?.[key];
	if (!stats || !entry) throw new Error(`Missing ${namespace} cache entry for sentinel overwrite.`);
	await db.dashboardStats.put({
		...stats,
		analyticsCache: {
			...stats.analyticsCache,
			[namespace]: {
				...stats.analyticsCache?.[namespace],
				[key]: { ...entry, value },
			},
		},
	});
}

async function bumpTransaction(id: string, amount: number) {
	const existing = await db.transactions.get(id);
	if (!existing) throw new Error(`Missing transaction ${id}.`);
	await db.transactions.put({ ...existing, amount, updatedAt: existing.updatedAt + 1 });
}

function staleStats(
	namespace: "comparisons" | "salaryProgression",
	key: string,
	dataVersion: string,
	value: unknown
): DashboardStats {
	return {
		id: USER_ID,
		updatedAt: 1,
		logicVersion: ANALYTICS_CACHE_LOGIC_VERSION,
		dataVersion,
		cacheStatus: "valid",
		cacheUpdatedAt: 1,
		balances: {},
		perCurrency: {},
		recent: [],
		analyticsCache: {
			[namespace]: {
				[key]: {
					logicVersion: ANALYTICS_CACHE_LOGIC_VERSION - 1,
					dataVersion,
					key,
					updatedAt: 1,
					value,
				},
			},
		},
	};
}

describe("comparison and salary progression analytics cache", () => {
	beforeEach(async () => {
		await db.accounts.clear();
		await db.categories.clear();
		await db.transactions.clear();
		await db.dashboardStats.clear();
		await seed();
	});

	it("computes comparison analytics and writes a comparisons cache entry", async () => {
		const key = getComparisonAnalyticsCacheKey(comparisonQuery());
		const analytics = await getComparisonAnalytics(USER_ID, comparisonQuery());

		expect(analytics.totals.currentExpense).toBe(100);
		expect(analytics.totals.previousExpense).toBe(300);
		expect(analytics.totals.expenseSavings).toBe(200);

		const entry = await readEntry("comparisons", key);
		expect(entry?.key).toBe(key);
		expect(entry?.logicVersion).toBe(ANALYTICS_CACHE_LOGIC_VERSION);
		expect(entry?.value).toEqual(analytics);
		expect(await getCachedAnalyticsValue(USER_ID, "comparisons", key)).toEqual(analytics);
	});

	it("serves repeated comparison analytics reads from the cache", async () => {
		const key = getComparisonAnalyticsCacheKey(comparisonQuery());
		const first = await getComparisonAnalytics(USER_ID, comparisonQuery());
		const firstEntry = await readEntry("comparisons", key);
		const sentinel = { ...first, totals: { ...first.totals, expenseSavings: 6517 } };
		await overwriteCachedValue("comparisons", key, sentinel);

		const second = await getComparisonAnalytics(USER_ID, comparisonQuery());

		expect(second.totals.expenseSavings).toBe(6517);
		expect((await readEntry("comparisons", key))?.updatedAt).toBe(firstEntry?.updatedAt);
	});

	it("recomputes comparison analytics after a transaction changes the data version", async () => {
		const key = getComparisonAnalyticsCacheKey(comparisonQuery());
		await getComparisonAnalytics(USER_ID, comparisonQuery());
		const staleDataVersion = (await readEntry("comparisons", key))?.dataVersion;

		await bumpTransaction(CURRENT_EXPENSE_ID, 50);
		const recomputed = await getComparisonAnalytics(USER_ID, comparisonQuery());

		expect(recomputed.totals.currentExpense).toBe(50);
		expect(recomputed.totals.expenseSavings).toBe(250);
		const entry = await readEntry("comparisons", key);
		expect(entry?.dataVersion).not.toBe(staleDataVersion);
		expect(entry?.dataVersion).toBe(
			buildAnalyticsDataVersion(await getAnalyticsSourceData(USER_ID))
		);
	});

	it("computes salary progression and writes a salaryProgression cache entry", async () => {
		const key = getSalaryProgressionCacheKey(salaryQuery());
		const analytics = await getSalaryProgression(USER_ID, salaryQuery());

		expect(analytics.totalEarned).toBe(32_000);
		expect(analytics.points.find((point) => point.key === "2026-09")?.total).toBe(12_000);
		expect(analytics.usedCategoryIds).toEqual([SALARY_CATEGORY_ID]);

		const entry = await readEntry("salaryProgression", key);
		expect(entry?.key).toBe(key);
		expect(entry?.logicVersion).toBe(ANALYTICS_CACHE_LOGIC_VERSION);
		expect(entry?.value).toEqual(analytics);
		expect(await getCachedAnalyticsValue(USER_ID, "salaryProgression", key)).toEqual(analytics);
	});

	it("serves repeated salary progression reads from the cache", async () => {
		const key = getSalaryProgressionCacheKey(salaryQuery());
		const first = await getSalaryProgression(USER_ID, salaryQuery());
		const firstEntry = await readEntry("salaryProgression", key);
		await overwriteCachedValue("salaryProgression", key, { ...first, totalEarned: 6517 });

		const second = await getSalaryProgression(USER_ID, salaryQuery());

		expect(second.totalEarned).toBe(6517);
		expect((await readEntry("salaryProgression", key))?.updatedAt).toBe(firstEntry?.updatedAt);
	});

	it("recomputes salary progression after a transaction changes the data version", async () => {
		const key = getSalaryProgressionCacheKey(salaryQuery());
		await getSalaryProgression(USER_ID, salaryQuery());
		const staleDataVersion = (await readEntry("salaryProgression", key))?.dataVersion;

		await bumpTransaction(LATEST_SALARY_ID, 15_000);
		const recomputed = await getSalaryProgression(USER_ID, salaryQuery());

		expect(recomputed.totalEarned).toBe(35_000);
		expect(recomputed.points.find((point) => point.key === "2026-09")?.total).toBe(15_000);
		const entry = await readEntry("salaryProgression", key);
		expect(entry?.dataVersion).not.toBe(staleDataVersion);
	});

	it("keeps differing queries in separate cache entries", async () => {
		const monthlyKey = getComparisonAnalyticsCacheKey(comparisonQuery());
		const yearlyKey = getComparisonAnalyticsCacheKey(
			comparisonQuery({ presetId: "year-vs-last-year" })
		);
		const oneYearKey = getSalaryProgressionCacheKey(salaryQuery());
		const quarterlyKey = getSalaryProgressionCacheKey(salaryQuery({ interval: "quarterly" }));

		expect(yearlyKey).not.toBe(monthlyKey);
		expect(quarterlyKey).not.toBe(oneYearKey);

		await getComparisonAnalytics(USER_ID, comparisonQuery());
		await getComparisonAnalytics(USER_ID, comparisonQuery({ presetId: "year-vs-last-year" }));
		await getSalaryProgression(USER_ID, salaryQuery());
		await getSalaryProgression(USER_ID, salaryQuery({ interval: "quarterly" }));

		const stats = await db.dashboardStats.get(USER_ID);
		expect(Object.keys(stats?.analyticsCache?.comparisons ?? {})).toEqual(
			expect.arrayContaining([monthlyKey, yearlyKey])
		);
		expect(Object.keys(stats?.analyticsCache?.salaryProgression ?? {})).toEqual(
			expect.arrayContaining([oneYearKey, quarterlyKey])
		);
		expect(stats?.analyticsCache?.comparisons?.[yearlyKey]?.value).not.toEqual(
			stats?.analyticsCache?.comparisons?.[monthlyKey]?.value
		);
	});

	it("strips the new namespaces before the stats leave the device", async () => {
		await getComparisonAnalytics(USER_ID, comparisonQuery());
		await getSalaryProgression(USER_ID, salaryQuery());
		const stats = await db.dashboardStats.get(USER_ID);
		expect(stats?.analyticsCache?.comparisons).toBeDefined();
		expect(stats?.analyticsCache?.salaryProgression).toBeDefined();

		expect(stripAnalyticsQueryCache(stats!).analyticsCache).toBeUndefined();
		expect(sanitizeDashboardStats(stats!).analyticsCache).toBeUndefined();
	});

	it("discards new-namespace entries stamped with an old logic version", async () => {
		const dataVersion = buildAnalyticsDataVersion(await getAnalyticsSourceData(USER_ID));
		const comparisonKey = getComparisonAnalyticsCacheKey(comparisonQuery());
		const salaryKey = getSalaryProgressionCacheKey(salaryQuery());

		await db.dashboardStats.put(
			staleStats("comparisons", comparisonKey, dataVersion, {
				totals: { expenseSavings: 6517 },
			})
		);
		const comparison = await getComparisonAnalytics(USER_ID, comparisonQuery());
		expect(comparison.totals.expenseSavings).toBe(200);

		await db.dashboardStats.put(
			staleStats("salaryProgression", salaryKey, dataVersion, { totalEarned: 6517 })
		);
		const salary = await getSalaryProgression(USER_ID, salaryQuery());
		expect(salary.totalEarned).toBe(32_000);
	});
});
