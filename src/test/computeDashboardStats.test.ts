import "fake-indexeddb/auto";

import { format, startOfMonth, subMonths } from "date-fns";
import { beforeEach, describe, expect, it } from "vitest";

import {
	ALL_CURRENCIES_KEY,
	aggregateDashboardStats,
	computeDashboardStats,
	getMonthlySummaryFromDashboardStats,
} from "@/lib/analytics/computeDashboardStats";
import { db } from "@/lib/db/local";

const USER_ID = "dashboard-cache-user";
const GST_OFFSET_MINUTES = 4 * 60;

describe("computeDashboardStats", () => {
	beforeEach(async () => {
		await db.accounts.clear();
		await db.transactions.clear();
		await db.dashboardStats.clear();
	});

	it("computes balances, month summary, trend, and recent transactions", async () => {
		const now = new Date();
		const currentMonth = startOfMonth(now).getTime() + 2 * 24 * 60 * 60 * 1000;
		const previousMonth = startOfMonth(subMonths(now, 1)).getTime() + 3 * 24 * 60 * 60 * 1000;

		await db.accounts.bulkPut([
			{
				id: "acc-pkr",
				userId: USER_ID,
				title: "Cash PKR",
				openingBalance: 1000,
				currency: "PKR",
				isArchived: false,
				updatedAt: Date.now(),
			},
			{
				id: "acc-usd",
				userId: USER_ID,
				title: "USD Wallet",
				openingBalance: 200,
				currency: "USD",
				isArchived: false,
				updatedAt: Date.now(),
			},
		]);

		await db.transactions.bulkPut([
			{
				id: "txn-income-current",
				userId: USER_ID,
				type: "Income",
				date: currentMonth,
				amount: 500,
				accountId: "acc-pkr",
				description: "Salary",
				updatedAt: Date.now(),
			},
			{
				id: "txn-expense-current",
				userId: USER_ID,
				type: "Expense",
				date: currentMonth + 1,
				amount: 120,
				accountId: "acc-pkr",
				place: "Market",
				updatedAt: Date.now(),
			},
			{
				id: "txn-transfer-current",
				userId: USER_ID,
				type: "Transfer",
				date: currentMonth + 2,
				amount: 75,
				accountId: "acc-pkr",
				toAccountId: "acc-usd",
				description: "FX top-up",
				updatedAt: Date.now(),
			},
			{
				id: "txn-income-prev",
				userId: USER_ID,
				type: "Income",
				date: previousMonth,
				amount: 250,
				accountId: "acc-usd",
				description: "Freelance",
				updatedAt: Date.now(),
			},
			{
				id: "txn-expense-deleted",
				userId: USER_ID,
				type: "Expense",
				date: currentMonth + 3,
				amount: 999,
				accountId: "acc-pkr",
				description: "Ignore me",
				updatedAt: Date.now(),
				deletedAt: Date.now(),
			},
		]);

		const stats = await computeDashboardStats(USER_ID);
		const currentLabel = format(now, "MMM yy");
		const previousLabel = format(subMonths(now, 1), "MMM yy");
		const allCurrencies = stats.perCurrency[ALL_CURRENCIES_KEY];
		const pkr = stats.perCurrency.PKR;
		const usd = stats.perCurrency.USD;

		expect(stats.id).toBe(USER_ID);
		expect(stats.balances).toEqual({
			"acc-pkr": 1305,
			"acc-usd": 450,
		});

		expect(allCurrencies).toBeDefined();
		expect(pkr).toBeDefined();
		expect(usd).toBeDefined();

		expect(allCurrencies).toMatchObject({
			monthIncome: 500,
			monthExpense: 120,
		});
		expect(pkr).toMatchObject({
			monthIncome: 500,
			monthExpense: 120,
		});
		expect(usd).toMatchObject({
			monthIncome: 0,
			monthExpense: 0,
		});

		expect(allCurrencies?.trend.find((item) => item.month === currentLabel)).toEqual({
			month: currentLabel,
			income: 500,
			expense: 120,
		});
		expect(allCurrencies?.trend.find((item) => item.month === previousLabel)).toEqual({
			month: previousLabel,
			income: 250,
			expense: 0,
		});

		expect(stats.recent.map((txn) => txn.id)).toEqual([
			"txn-transfer-current",
			"txn-expense-current",
			"txn-income-current",
			"txn-income-prev",
		]);
		expect(stats.recent[0]).toMatchObject({
			id: "txn-transfer-current",
			accountTitle: "Cash PKR",
			accountCurrency: "PKR",
			toAccountId: "acc-usd",
		});
		expect(stats.warnings).toHaveLength(1);
	});

	it("does not credit source-currency amounts into cross-currency destination balances or totals", async () => {
		const currentMonth = startOfMonth(new Date()).getTime() + 2 * 24 * 60 * 60 * 1000;

		await db.accounts.bulkPut([
			{
				id: "acc-cross-pkr",
				userId: USER_ID,
				title: "Cash PKR",
				openingBalance: 50000,
				currency: "PKR",
				isArchived: false,
				updatedAt: Date.now(),
			},
			{
				id: "acc-cross-aed",
				userId: USER_ID,
				title: "AED Wallet",
				openingBalance: 10,
				currency: "AED",
				isArchived: false,
				updatedAt: Date.now(),
			},
		]);

		await db.transactions.bulkPut([
			{
				id: "txn-cross-transfer",
				userId: USER_ID,
				type: "Transfer",
				date: currentMonth,
				amount: 50000,
				accountId: "acc-cross-pkr",
				toAccountId: "acc-cross-aed",
				description: "Legacy cross-currency transfer",
				updatedAt: Date.now(),
			},
			{
				id: "txn-aed-income",
				userId: USER_ID,
				type: "Income",
				date: currentMonth + 1,
				amount: 25,
				accountId: "acc-cross-aed",
				description: "AED income",
				updatedAt: Date.now(),
			},
		]);

		const stats = await computeDashboardStats(USER_ID);
		const aed = stats.perCurrency.AED;

		expect(stats.balances).toMatchObject({
			"acc-cross-pkr": 0,
			"acc-cross-aed": 35,
		});
		expect(aed).toMatchObject({
			monthIncome: 25,
			monthExpense: 0,
		});
		expect(stats.warnings).toEqual([
			{
				code: "cross_currency_transfer_destination_skipped",
				transactionId: "txn-cross-transfer",
				message:
					"Cross-currency transfer destination balance was not adjusted because no destination amount or FX contract is stored.",
			},
		]);
	});

	it("aggregates exact monthly totals across timezone boundaries, currencies, transfers, archived accounts, and soft deletes", () => {
		const now = new Date("2026-09-15T12:00:00.000+04:00");
		const stats = aggregateDashboardStats(
			USER_ID,
			[
				{
					id: "acc-aed-active",
					userId: USER_ID,
					title: "AED Active",
					openingBalance: 1000,
					currency: "AED",
					isArchived: false,
					updatedAt: now.getTime(),
				},
				{
					id: "acc-aed-archived",
					userId: USER_ID,
					title: "AED Archived",
					openingBalance: 300,
					currency: "AED",
					isArchived: true,
					updatedAt: now.getTime(),
				},
				{
					id: "acc-aed-deleted",
					userId: USER_ID,
					title: "AED Deleted",
					openingBalance: 900,
					currency: "AED",
					isArchived: false,
					updatedAt: now.getTime(),
					deletedAt: now.getTime(),
				},
				{
					id: "acc-usd-active",
					userId: USER_ID,
					title: "USD Active",
					openingBalance: 100,
					currency: "USD",
					isArchived: false,
					updatedAt: now.getTime(),
				},
			],
			[
				{
					id: "txn-aed-income-first-day",
					userId: USER_ID,
					type: "Income",
					date: new Date("2026-09-01T00:30:00.000+04:00").getTime(),
					amount: 2000,
					accountId: "acc-aed-active",
					updatedAt: now.getTime(),
				},
				{
					id: "txn-aed-expense-last-day",
					userId: USER_ID,
					type: "Expense",
					date: new Date("2026-09-30T23:30:00.000+04:00").getTime(),
					amount: 6000,
					accountId: "acc-aed-active",
					updatedAt: now.getTime(),
				},
				{
					id: "txn-aed-archived-expense",
					userId: USER_ID,
					type: "Expense",
					date: new Date("2026-09-10T09:00:00.000+04:00").getTime(),
					amount: 4500,
					accountId: "acc-aed-archived",
					updatedAt: now.getTime(),
				},
				{
					id: "txn-aed-deleted-transaction",
					userId: USER_ID,
					type: "Expense",
					date: new Date("2026-09-12T09:00:00.000+04:00").getTime(),
					amount: 777,
					accountId: "acc-aed-active",
					updatedAt: now.getTime(),
					deletedAt: now.getTime(),
				},
				{
					id: "txn-aed-deleted-account",
					userId: USER_ID,
					type: "Expense",
					date: new Date("2026-09-12T10:00:00.000+04:00").getTime(),
					amount: 888,
					accountId: "acc-aed-deleted",
					updatedAt: now.getTime(),
				},
				{
					id: "txn-aed-prev-month",
					userId: USER_ID,
					type: "Expense",
					date: new Date("2026-08-31T23:30:00.000+04:00").getTime(),
					amount: 999,
					accountId: "acc-aed-active",
					updatedAt: now.getTime(),
				},
				{
					id: "txn-aed-next-month",
					userId: USER_ID,
					type: "Expense",
					date: new Date("2026-10-01T00:30:00.000+04:00").getTime(),
					amount: 9999,
					accountId: "acc-aed-active",
					updatedAt: now.getTime(),
				},
				{
					id: "txn-aed-transfer",
					userId: USER_ID,
					type: "Transfer",
					date: new Date("2026-09-20T12:00:00.000+04:00").getTime(),
					amount: 1000,
					accountId: "acc-aed-active",
					toAccountId: "acc-aed-archived",
					updatedAt: now.getTime(),
				},
				{
					id: "txn-cross-transfer",
					userId: USER_ID,
					type: "Transfer",
					date: new Date("2026-09-21T12:00:00.000+04:00").getTime(),
					amount: 200,
					accountId: "acc-aed-active",
					toAccountId: "acc-usd-active",
					updatedAt: now.getTime(),
				},
				{
					id: "txn-usd-income",
					userId: USER_ID,
					type: "Income",
					date: new Date("2026-09-11T12:00:00.000+04:00").getTime(),
					amount: 500,
					accountId: "acc-usd-active",
					updatedAt: now.getTime(),
				},
				{
					id: "txn-usd-expense",
					userId: USER_ID,
					type: "Expense",
					date: new Date("2026-09-11T13:00:00.000+04:00").getTime(),
					amount: 90,
					accountId: "acc-usd-active",
					updatedAt: now.getTime(),
				},
			],
			{ now, timeZoneOffsetMinutes: GST_OFFSET_MINUTES }
		);
		const aed = stats.perCurrency.AED;
		const usd = stats.perCurrency.USD;
		const allCurrencies = stats.perCurrency[ALL_CURRENCIES_KEY];
		const aedTrend = getMonthlySummaryFromDashboardStats(stats, 6, "AED");
		const currentAedTrend = aedTrend.at(-1);

		expect(aed).toBeDefined();
		expect(usd).toBeDefined();
		expect(allCurrencies).toBeDefined();
		if (!aed || !usd || !allCurrencies) throw new Error("Expected currency buckets");
		expect(aed).toMatchObject({
			monthIncome: 2000,
			monthExpense: 10500,
		});
		expect(aed.monthIncome - aed.monthExpense).toBe(-8500);
		expect(usd).toMatchObject({
			monthIncome: 500,
			monthExpense: 90,
		});
		expect(allCurrencies).toMatchObject({
			monthIncome: 2500,
			monthExpense: 10590,
		});
		expect(stats.balances).toEqual({
			"acc-aed-active": -15198,
			"acc-aed-archived": -3200,
			"acc-usd-active": 510,
		});
		expect(stats.recent.map((transaction) => transaction.id)).not.toContain(
			"txn-aed-deleted-account"
		);
		expect(currentAedTrend).toEqual({
			month: "Sep 26",
			income: 2000,
			expense: 10500,
		});
		expect(currentAedTrend?.income).toBe(aed.monthIncome);
		expect(currentAedTrend?.expense).toBe(aed.monthExpense);
		expect(stats.warnings?.map((warning) => warning.transactionId)).toEqual(["txn-cross-transfer"]);
	});
});
