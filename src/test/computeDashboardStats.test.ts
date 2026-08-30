import "fake-indexeddb/auto";

import { format, startOfMonth, subMonths } from "date-fns";
import { beforeEach, describe, expect, it } from "vitest";

import { ALL_CURRENCIES_KEY, computeDashboardStats } from "@/lib/analytics/computeDashboardStats";
import { db } from "@/lib/db/local";

const USER_ID = "dashboard-cache-user";

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
			"acc-usd": 525,
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
	});
});
