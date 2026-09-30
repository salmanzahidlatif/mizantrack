import { waitFor } from "@testing-library/react";
import { liveQuery } from "dexie";
import { beforeEach, describe, expect, it } from "vitest";

import { createAccount, updateAccount } from "@/lib/actions/accounts";
import { createCategory, updateCategory } from "@/lib/actions/categories";
import { createTransaction, updateTransaction } from "@/lib/actions/transactions";
import {
	getAccountsAnalyticsCacheKey,
	getCachedAnalyticsValue,
	getOrComputeCachedAnalyticsValue,
} from "@/lib/analytics/cache";
import {
	ANALYTICS_CACHE_LOGIC_VERSION,
	buildAnalyticsDataVersion,
	getAnalyticsSourceData,
} from "@/lib/analytics/cacheMetadata";
import {
	aggregateAccountsAnalytics,
	aggregateAccountsAnalyticsChunked,
	aggregatePeriodAnalytics,
	aggregatePeriodAnalyticsChunked,
	getAccountsAnalytics,
	getPeriodAnalytics,
} from "@/lib/analytics/periodAnalytics";
import { db } from "@/lib/db/local";

import type { Account, Category, Transaction } from "@/types";

const USER_ID = "analytics-cache-user";
const ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440101";
const CATEGORY_ID = "550e8400-e29b-41d4-a716-446655440102";
const TXN_ID = "550e8400-e29b-41d4-a716-446655440103";
const NOW = new Date("2026-09-30T09:37:15.923+04:00");
const GST_OFFSET_MINUTES = 4 * 60;

function account(overrides: Partial<Account> = {}): Account {
	return {
		id: ACCOUNT_ID,
		userId: USER_ID,
		title: "Cash",
		openingBalance: 0,
		currency: "AED",
		isArchived: false,
		updatedAt: 1,
		...overrides,
	};
}

function category(overrides: Partial<Category> = {}): Category {
	return {
		id: CATEGORY_ID,
		userId: USER_ID,
		title: "Food",
		type: "Expense",
		currency: "AED",
		updatedAt: 1,
		...overrides,
	};
}

function transaction(overrides: Partial<Transaction> = {}): Transaction {
	return {
		id: TXN_ID,
		userId: USER_ID,
		type: "Expense",
		date: new Date("2026-09-15T12:00:00.000+04:00").getTime(),
		amount: 100,
		accountId: ACCOUNT_ID,
		categoryId: CATEGORY_ID,
		updatedAt: 1,
		...overrides,
	};
}

async function seedBasicData() {
	await db.accounts.put(account());
	await db.categories.put(category());
	await db.transactions.put(transaction());
}

function accountsQuery() {
	return {
		currency: "AED",
		enabledCurrencies: ["AED"],
		asOf: NOW,
		timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		period: {
			interval: "monthly" as const,
			anchorDate: NOW,
			now: NOW,
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		},
	};
}

function periodQuery() {
	return {
		currency: "AED",
		interval: "monthly" as const,
		anchorDate: NOW,
		now: NOW,
		timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
	};
}

describe("analytics cache", () => {
	beforeEach(async () => {
		await db.accounts.clear();
		await db.categories.clear();
		await db.transactions.clear();
		await db.dashboardStats.clear();
	});

	it("discards cached entries stamped with an old logic version", async () => {
		await seedBasicData();
		const dataVersion = buildAnalyticsDataVersion(await getAnalyticsSourceData(USER_ID));
		const cacheKey = getAccountsAnalyticsCacheKey(accountsQuery());
		await db.dashboardStats.put({
			id: USER_ID,
			updatedAt: 1,
			logicVersion: ANALYTICS_CACHE_LOGIC_VERSION - 1,
			dataVersion,
			cacheStatus: "valid",
			balances: { [ACCOUNT_ID]: 9999 },
			perCurrency: {},
			recent: [],
			analyticsCache: {
				accounts: {
					[cacheKey]: {
						logicVersion: ANALYTICS_CACHE_LOGIC_VERSION - 1,
						dataVersion,
						key: cacheKey,
						updatedAt: 1,
						value: {
							userId: USER_ID,
							currency: "AED",
							asOf: NOW,
							period: { label: "old" },
							netWorth: 9999,
							inflow: 0,
							outflow: 0,
							netFlow: 0,
							accounts: [],
							warnings: [],
						},
					},
				},
			},
		});

		const analytics = await getAccountsAnalytics(USER_ID, accountsQuery());

		expect(analytics.netWorth).toBe(-100);
		expect(analytics.netWorth).not.toBe(9999);
		expect((await db.dashboardStats.get(USER_ID))?.logicVersion).toBe(
			ANALYTICS_CACHE_LOGIC_VERSION
		);
	});

	it("serves a valid cached analytics entry without recomputation", async () => {
		await seedBasicData();
		const source = await getAnalyticsSourceData(USER_ID);
		const dataVersion = buildAnalyticsDataVersion(source);
		const cacheKey = getAccountsAnalyticsCacheKey(accountsQuery());
		const value = aggregateAccountsAnalytics(
			USER_ID,
			source.accounts,
			source.transactions,
			accountsQuery()
		);
		await db.dashboardStats.put({
			id: USER_ID,
			updatedAt: 1,
			logicVersion: ANALYTICS_CACHE_LOGIC_VERSION,
			dataVersion,
			cacheStatus: "valid",
			cacheUpdatedAt: 1,
			balances: { [ACCOUNT_ID]: -100 },
			perCurrency: {},
			recent: [],
			analyticsCache: {
				accounts: {
					[cacheKey]: {
						logicVersion: ANALYTICS_CACHE_LOGIC_VERSION,
						dataVersion,
						key: cacheKey,
						updatedAt: 1,
						value,
					},
				},
			},
		});

		let computeCount = 0;
		const cached = await getOrComputeCachedAnalyticsValue(USER_ID, "accounts", cacheKey, () => {
			computeCount++;
			return { ...value, netWorth: 9999 };
		});

		expect(await getCachedAnalyticsValue(USER_ID, "accounts", cacheKey)).toEqual(value);
		expect(cached).toEqual(value);
		expect(computeCount).toBe(0);
	});

	it("does not serve cached analytics when logic or data versions mismatch", async () => {
		await seedBasicData();
		const source = await getAnalyticsSourceData(USER_ID);
		const dataVersion = buildAnalyticsDataVersion(source);
		const cacheKey = getAccountsAnalyticsCacheKey(accountsQuery());
		await db.dashboardStats.put({
			id: USER_ID,
			updatedAt: 1,
			logicVersion: ANALYTICS_CACHE_LOGIC_VERSION,
			dataVersion,
			cacheStatus: "valid",
			cacheUpdatedAt: 1,
			balances: { [ACCOUNT_ID]: -100 },
			perCurrency: {},
			recent: [],
			analyticsCache: {
				accounts: {
					[cacheKey]: {
						logicVersion: ANALYTICS_CACHE_LOGIC_VERSION,
						dataVersion: "stale-data-version",
						key: cacheKey,
						updatedAt: 1,
						value: { netWorth: 6517 },
					},
				},
			},
		});

		let computeCount = 0;
		const fresh = await getOrComputeCachedAnalyticsValue(
			USER_ID,
			"accounts",
			cacheKey,
			(sourceData) => {
				computeCount++;
				return aggregateAccountsAnalytics(
					USER_ID,
					sourceData.accounts,
					sourceData.transactions,
					accountsQuery()
				);
			}
		);

		expect(fresh.netWorth).toBe(-100);
		expect(await getCachedAnalyticsValue(USER_ID, "accounts", cacheKey)).toEqual(fresh);
		expect(computeCount).toBe(1);
	});

	it("keeps analytics recomputation outside the observed cache liveQuery", async () => {
		await seedBasicData();
		const cacheKey = getAccountsAnalyticsCacheKey(accountsQuery());
		let computeCount = 0;
		let emissionCount = 0;
		let latestValue: unknown;

		const subscription = liveQuery(() =>
			getCachedAnalyticsValue(USER_ID, "accounts", cacheKey)
		).subscribe({
			next(value) {
				emissionCount++;
				latestValue = value;
				if (value !== undefined) return;

				void getOrComputeCachedAnalyticsValue(USER_ID, "accounts", cacheKey, (sourceData) => {
					computeCount++;
					return aggregateAccountsAnalytics(
						USER_ID,
						sourceData.accounts,
						sourceData.transactions,
						accountsQuery()
					);
				});
			},
		});

		await waitFor(() => {
			expect(latestValue).toEqual(expect.objectContaining({ netWorth: -100 }));
		});
		await new Promise((resolve) => setTimeout(resolve, 20));
		subscription.unsubscribe();

		expect(computeCount).toBe(1);
		expect(emissionCount).toBeLessThanOrEqual(3);
	});

	it("chunked analytics match single-pass analytics and yield between slices", async () => {
		const accounts = [
			account({ id: "cash", openingBalance: 1000 }),
			account({ id: "bank", title: "Bank", openingBalance: 500 }),
		];
		const categories = [category()];
		const transactions = Array.from({ length: 24 }, (_, index) =>
			transaction({
				id: `txn-${index}`,
				accountId: index % 2 === 0 ? "cash" : "bank",
				type: index % 3 === 0 ? "Income" : "Expense",
				amount: index + 1,
				date: new Date(
					`2026-09-${String((index % 20) + 1).padStart(2, "0")}T12:00:00.000+04:00`
				).getTime(),
				updatedAt: index + 1,
			})
		);
		let yields = 0;
		const chunkOptions = {
			batchSize: 5,
			yieldNow: async () => undefined,
			onYield: () => {
				yields++;
			},
		};

		await expect(
			aggregateAccountsAnalyticsChunked(
				USER_ID,
				accounts,
				transactions,
				accountsQuery(),
				chunkOptions
			)
		).resolves.toEqual(
			aggregateAccountsAnalytics(USER_ID, accounts, transactions, accountsQuery())
		);
		await expect(
			aggregatePeriodAnalyticsChunked(
				USER_ID,
				accounts,
				categories,
				transactions,
				periodQuery(),
				chunkOptions
			)
		).resolves.toEqual(
			aggregatePeriodAnalytics(USER_ID, accounts, categories, transactions, periodQuery())
		);
		expect(yields).toBeGreaterThan(0);
	});

	it("returns cached account and period analytics equal to fresh aggregates", async () => {
		await seedBasicData();

		const cachedAccounts = await getAccountsAnalytics(USER_ID, accountsQuery());
		const cachedPeriod = await getPeriodAnalytics(USER_ID, periodQuery());
		const [accounts, categories, transactions] = await Promise.all([
			db.accounts.where("userId").equals(USER_ID).toArray(),
			db.categories.where("userId").equals(USER_ID).toArray(),
			db.transactions.where("userId").equals(USER_ID).toArray(),
		]);

		expect(cachedAccounts).toEqual(
			aggregateAccountsAnalytics(USER_ID, accounts, transactions, accountsQuery())
		);
		expect(cachedPeriod).toEqual(
			aggregatePeriodAnalytics(USER_ID, accounts, categories, transactions, periodQuery())
		);
	});

	it("refreshes cached analytics after a transaction mutation", async () => {
		await seedBasicData();
		expect((await getPeriodAnalytics(USER_ID, periodQuery())).expense).toBe(100);

		await updateTransaction(USER_ID, TXN_ID, {
			type: "Expense",
			amount: 250,
			date: new Date("2026-09-15T12:00:00.000+04:00"),
			accountId: ACCOUNT_ID,
			categoryId: CATEGORY_ID,
		});

		expect((await getPeriodAnalytics(USER_ID, periodQuery())).expense).toBe(250);
		expect((await getAccountsAnalytics(USER_ID, accountsQuery())).netWorth).toBe(-250);
	});

	it("refreshes cached analytics after an account opening balance mutation", async () => {
		await seedBasicData();
		expect((await getAccountsAnalytics(USER_ID, accountsQuery())).netWorth).toBe(-100);

		await updateAccount(USER_ID, ACCOUNT_ID, {
			title: "Cash",
			currency: "AED",
			openingBalance: 1000,
		});

		expect((await getAccountsAnalytics(USER_ID, accountsQuery())).netWorth).toBe(900);
	});

	it("refreshes cached analytics after a category mutation", async () => {
		await seedBasicData();
		expect((await getPeriodAnalytics(USER_ID, periodQuery())).expenseBreakdown[0]?.title).toBe(
			"Food"
		);

		await updateCategory(USER_ID, CATEGORY_ID, {
			title: "Groceries",
			type: "Expense",
			currency: "AED",
		});

		expect((await getPeriodAnalytics(USER_ID, periodQuery())).expenseBreakdown[0]?.title).toBe(
			"Groceries"
		);
	});

	it("creates accounts and categories through mutation actions that refresh the cache", async () => {
		const accountId = await createAccount(
			USER_ID,
			{ title: "Wallet", currency: "AED", openingBalance: 50 },
			{ id: ACCOUNT_ID }
		);
		const categoryId = await createCategory(
			USER_ID,
			{ title: "Food", type: "Expense", currency: "AED" },
			{ id: CATEGORY_ID }
		);
		await createTransaction(
			USER_ID,
			{
				type: "Expense",
				amount: 20,
				date: new Date("2026-09-15T12:00:00.000+04:00"),
				accountId,
				categoryId,
			},
			{ id: TXN_ID }
		);

		const analytics = await getAccountsAnalytics(USER_ID, accountsQuery());
		expect(analytics.netWorth).toBe(30);
	});
});
