import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { computeAccountBalances } from "@/lib/analytics/balanceMath";
import {
	aggregateAccountsAnalytics,
	getAccountsAnalytics,
	getMonthlySummaries,
	getPeriodAnalytics,
	UNCATEGORIZED_CATEGORY_TITLE,
} from "@/lib/analytics/periodAnalytics";
import { getDateRange, getMonthStripRanges, resolveAnalyticsPeriod } from "@/lib/dateRange";
import { db } from "@/lib/db/local";

import type { Account, Transaction } from "@/types";

const USER_ID = "analytics-history-user";
const OTHER_USER_ID = "analytics-history-other-user";
const GST_OFFSET_MINUTES = 4 * 60;

function gst(date: string): number {
	return new Date(date).getTime();
}

function buildBalanceRegressionFixture(cashOpeningBalance = 1848.59): {
	accounts: Account[];
	transactions: Transaction[];
} {
	const now = gst("2026-09-29T18:00:00.000+04:00");
	const crossCurrencyAmounts = [
		532154.23, 481000.19, 625410.77, 398225.61, 712004.44, 288901.34, 802330.55, 690120.18,
		495212.84,
	];
	const crossCurrencyTotal = crossCurrencyAmounts.reduce((sum, amount) => sum + amount, 0);
	const accounts: Account[] = [
		{
			id: "cash-aed",
			userId: USER_ID,
			title: "Cash",
			openingBalance: cashOpeningBalance,
			currency: "AED",
			isArchived: false,
			updatedAt: now,
		},
		{
			id: "aed-import-contra",
			userId: USER_ID,
			title: "Imported AED Contra",
			openingBalance: 96993.03 - crossCurrencyTotal,
			currency: "AED",
			isArchived: false,
			updatedAt: now,
		},
		{
			id: "aed-archived-zero",
			userId: USER_ID,
			title: "Archived AED Zero",
			openingBalance: 0,
			currency: "AED",
			isArchived: true,
			updatedAt: now,
		},
		{
			id: "aed-history-offset",
			userId: USER_ID,
			title: "Historical Inflow Outflow Offset",
			openingBalance: -302341.06,
			currency: "AED",
			isArchived: true,
			updatedAt: now,
		},
		{
			id: "aed-liability-legacy",
			userId: USER_ID,
			title: "Legacy Liability",
			openingBalance: -35799,
			currency: "AED",
			isArchived: false,
			accountType: "liability",
			updatedAt: now,
		},
		{
			id: "aed-offset-asset",
			userId: USER_ID,
			title: "Legacy Offset Asset",
			openingBalance: 35799,
			currency: "AED",
			isArchived: true,
			updatedAt: now,
		},
		{
			id: "aed-deleted-noise",
			userId: USER_ID,
			title: "Deleted Noise",
			openingBalance: 999999,
			currency: "AED",
			isArchived: true,
			updatedAt: now,
			deletedAt: now,
		},
		...crossCurrencyAmounts.map((amount, index) => ({
			id: `pkr-source-${index + 1}`,
			userId: USER_ID,
			title: `PKR Source ${index + 1}`,
			openingBalance: amount,
			currency: "PKR",
			isArchived: index % 2 === 0,
			updatedAt: now,
		})),
	];
	const transactions: Transaction[] = [
		{
			id: "cash-sep-income",
			userId: USER_ID,
			type: "Income",
			date: gst("2026-09-05T09:00:00.000+04:00"),
			amount: 8884.73,
			accountId: "cash-aed",
			updatedAt: now,
		},
		{
			id: "cash-sep-expense",
			userId: USER_ID,
			type: "Expense",
			date: gst("2026-09-20T20:00:00.000+04:00"),
			amount: 10355.23,
			accountId: "cash-aed",
			updatedAt: now,
		},
		{
			id: "cash-to-import-contra",
			userId: USER_ID,
			type: "Transfer",
			date: gst("2026-09-21T10:00:00.000+04:00"),
			amount: crossCurrencyTotal,
			accountId: "cash-aed",
			toAccountId: "aed-import-contra",
			updatedAt: now,
		},
		{
			id: "soft-deleted-cash-noise",
			userId: USER_ID,
			type: "Expense",
			date: gst("2026-09-22T10:00:00.000+04:00"),
			amount: 123456,
			accountId: "cash-aed",
			updatedAt: now,
			deletedAt: now,
		},
		{
			id: "aed-all-time-income",
			userId: USER_ID,
			type: "Income",
			date: gst("2026-08-05T09:00:00.000+04:00"),
			amount: 2425885.83,
			accountId: "aed-history-offset",
			updatedAt: now,
		},
		{
			id: "aed-all-time-expense",
			userId: USER_ID,
			type: "Expense",
			date: gst("2026-08-20T20:00:00.000+04:00"),
			amount: 2123544.77,
			accountId: "aed-history-offset",
			updatedAt: now,
		},
		...crossCurrencyAmounts.map((amount, index) => ({
			id: `pkr-to-cash-${index + 1}`,
			userId: USER_ID,
			type: "Transfer" as const,
			date: gst(`2026-09-${String(index + 1).padStart(2, "0")}T12:00:00.000+04:00`),
			amount,
			accountId: `pkr-source-${index + 1}`,
			toAccountId: "cash-aed",
			updatedAt: now,
		})),
	];

	for (let i = transactions.length; i < 10000; i++) {
		const sourceIndex = (i % crossCurrencyAmounts.length) + 1;
		transactions.push({
			id: `pkr-noise-${i}`,
			userId: USER_ID,
			type: i % 2 === 0 ? "Income" : "Expense",
			date: gst("2026-08-15T12:00:00.000+04:00") + i,
			amount: 1,
			accountId: `pkr-source-${sourceIndex}`,
			updatedAt: now,
			deletedAt: now,
		});
	}

	return { accounts, transactions };
}

function aggregateWithRegressedTransferSemantics(
	accounts: Account[],
	transactions: Transaction[],
	currency = "AED"
): { cashBalance: number; netWorth: number } {
	const activeAccounts = accounts.filter(
		(account) => account.userId === USER_ID && !account.deletedAt
	);
	const accountById = new Map(activeAccounts.map((account) => [account.id, account]));
	const scopedAccounts = activeAccounts.filter((account) => account.currency === currency);
	const balances = new Map(scopedAccounts.map((account) => [account.id, account.openingBalance]));

	for (const transaction of transactions) {
		if (transaction.userId !== USER_ID || transaction.deletedAt) continue;

		if (transaction.type === "Income" && balances.has(transaction.accountId)) {
			balances.set(
				transaction.accountId,
				balances.get(transaction.accountId)! + transaction.amount
			);
		} else if (transaction.type === "Expense" && balances.has(transaction.accountId)) {
			balances.set(
				transaction.accountId,
				balances.get(transaction.accountId)! - transaction.amount
			);
		} else if (transaction.type === "Transfer") {
			if (!transaction.toAccountId || !accountById.has(transaction.toAccountId)) continue;

			if (balances.has(transaction.accountId)) {
				balances.set(
					transaction.accountId,
					balances.get(transaction.accountId)! - transaction.amount
				);
			}

			if (transaction.toAccountId && balances.has(transaction.toAccountId)) {
				const source = accountById.get(transaction.accountId);
				const destination = accountById.get(transaction.toAccountId);
				if (source && destination && source.currency !== destination.currency) continue;
				balances.set(
					transaction.toAccountId,
					balances.get(transaction.toAccountId)! + transaction.amount
				);
			}
		}
	}

	return {
		cashBalance: balances.get("cash-aed") ?? 0,
		netWorth: [...balances.values()].reduce((sum, balance) => sum + balance, 0),
	};
}

function assertBalanceConservation(
	accounts: Account[],
	transactions: Transaction[],
	balances: Map<string, number>
) {
	const activeAccounts = accounts.filter((account) => !account.deletedAt);
	const accountById = new Map(activeAccounts.map((account) => [account.id, account]));
	const currencies = new Set(activeAccounts.map((account) => account.currency));
	let globalTransferDelta = 0;

	for (const currency of currencies) {
		let expected = 0;
		let transferDelta = 0;
		const accountIds = new Set(
			activeAccounts.filter((account) => account.currency === currency).map((account) => account.id)
		);

		for (const account of activeAccounts) {
			if (account.currency === currency) expected += account.openingBalance;
		}

		for (const transaction of transactions) {
			if (transaction.deletedAt) continue;

			if (transaction.type === "Income" && accountIds.has(transaction.accountId)) {
				expected += transaction.amount;
			} else if (transaction.type === "Expense" && accountIds.has(transaction.accountId)) {
				expected -= transaction.amount;
			} else if (transaction.type === "Transfer") {
				const source = accountById.get(transaction.accountId);
				const destination = transaction.toAccountId
					? accountById.get(transaction.toAccountId)
					: undefined;
				if (source) {
					globalTransferDelta -= transaction.amount;
					if (source.currency === currency) transferDelta -= transaction.amount;
				}
				if (destination) {
					globalTransferDelta += transaction.amount;
					if (destination.currency === currency) transferDelta += transaction.amount;
				}
			}
		}

		const actual = [...accountIds].reduce(
			(sum, accountId) => sum + (balances.get(accountId) ?? 0),
			0
		);
		expect(actual).toBeCloseTo(expected + transferDelta, 2);
	}

	expect(globalTransferDelta).toBeCloseTo(0, 2);
}

function assertTransferLegsVisible(
	accounts: Account[],
	transactions: Transaction[],
	visibleAccountIds: Set<string>
) {
	const activeAccountIds = new Set(
		accounts.filter((account) => !account.deletedAt).map((account) => account.id)
	);

	for (const transaction of transactions) {
		if (transaction.type !== "Transfer" || transaction.deletedAt || !transaction.toAccountId) {
			continue;
		}
		if (
			!activeAccountIds.has(transaction.accountId) ||
			!activeAccountIds.has(transaction.toAccountId)
		) {
			continue;
		}

		expect(visibleAccountIds.has(transaction.accountId)).toBe(
			visibleAccountIds.has(transaction.toAccountId)
		);
	}
}

async function seedAnalyticsHistoryData() {
	const now = gst("2026-09-15T12:00:00.000+04:00");

	await db.accounts.bulkPut([
		{
			id: "aed-active",
			userId: USER_ID,
			title: "AED Wallet",
			openingBalance: 1000,
			currency: "AED",
			isArchived: false,
			updatedAt: now,
		},
		{
			id: "aed-archived",
			userId: USER_ID,
			title: "AED Old Cash",
			openingBalance: 300,
			currency: "AED",
			isArchived: true,
			updatedAt: now,
		},
		{
			id: "aed-liability",
			userId: USER_ID,
			title: "AED Loan",
			openingBalance: -500,
			currency: "AED",
			isArchived: false,
			accountType: "liability",
			updatedAt: now,
		},
		{
			id: "aed-deleted",
			userId: USER_ID,
			title: "Deleted AED",
			openingBalance: 9999,
			currency: "AED",
			isArchived: false,
			updatedAt: now,
			deletedAt: now,
		},
		{
			id: "usd-active",
			userId: USER_ID,
			title: "USD Wallet",
			openingBalance: 100,
			currency: "USD",
			isArchived: false,
			updatedAt: now,
		},
		{
			id: "other-aed",
			userId: OTHER_USER_ID,
			title: "Other AED",
			openingBalance: 1,
			currency: "AED",
			isArchived: false,
			updatedAt: now,
		},
	]);

	await db.categories.bulkPut([
		{
			id: "cat-food",
			userId: USER_ID,
			title: "Food & Drink",
			type: "Expense",
			currency: "AED",
			color: "#ef4444",
			icon: "🍔",
			updatedAt: now,
		},
		{
			id: "cat-transport",
			userId: USER_ID,
			title: "Transport",
			type: "Expense",
			color: "#3b82f6",
			icon: "🚕",
			updatedAt: now,
		},
		{
			id: "cat-salary",
			userId: USER_ID,
			title: "Salary",
			type: "Income",
			currency: "AED",
			color: "#22c55e",
			icon: "💼",
			updatedAt: now,
		},
		{
			id: "cat-usd-food",
			userId: USER_ID,
			title: "USD Food",
			type: "Expense",
			currency: "USD",
			color: "#a855f7",
			updatedAt: now,
		},
	]);

	await db.transactions.bulkPut([
		{
			id: "aed-income",
			userId: USER_ID,
			type: "Income",
			date: gst("2026-09-01T00:30:00.000+04:00"),
			amount: 1000,
			accountId: "aed-active",
			categoryId: "cat-salary",
			updatedAt: now,
		},
		{
			id: "aed-food",
			userId: USER_ID,
			type: "Expense",
			date: gst("2026-09-10T12:00:00.000+04:00"),
			amount: 200,
			accountId: "aed-active",
			categoryId: "cat-food",
			updatedAt: now,
		},
		{
			id: "aed-uncategorized",
			userId: USER_ID,
			type: "Expense",
			date: gst("2026-09-11T12:00:00.000+04:00"),
			amount: 50,
			accountId: "aed-active",
			updatedAt: now,
		},
		{
			id: "aed-archived-transport",
			userId: USER_ID,
			type: "Expense",
			date: gst("2026-09-30T23:30:00.000+04:00"),
			amount: 70,
			accountId: "aed-archived",
			categoryId: "cat-transport",
			updatedAt: now,
		},
		{
			id: "aed-transfer",
			userId: USER_ID,
			type: "Transfer",
			date: gst("2026-09-12T12:00:00.000+04:00"),
			amount: 100,
			accountId: "aed-active",
			toAccountId: "aed-archived",
			updatedAt: now,
		},
		{
			id: "aed-cross-transfer",
			userId: USER_ID,
			type: "Transfer",
			date: gst("2026-09-13T12:00:00.000+04:00"),
			amount: 50,
			accountId: "aed-active",
			toAccountId: "usd-active",
			updatedAt: now,
		},
		{
			id: "aed-deleted-expense",
			userId: USER_ID,
			type: "Expense",
			date: gst("2026-09-14T12:00:00.000+04:00"),
			amount: 999,
			accountId: "aed-active",
			categoryId: "cat-food",
			updatedAt: now,
			deletedAt: now,
		},
		{
			id: "aed-deleted-account-expense",
			userId: USER_ID,
			type: "Expense",
			date: gst("2026-09-14T12:00:00.000+04:00"),
			amount: 888,
			accountId: "aed-deleted",
			categoryId: "cat-food",
			updatedAt: now,
		},
		{
			id: "aed-august-expense",
			userId: USER_ID,
			type: "Expense",
			date: gst("2026-08-31T23:30:00.000+04:00"),
			amount: 111,
			accountId: "aed-active",
			categoryId: "cat-food",
			updatedAt: now,
		},
		{
			id: "aed-october-expense",
			userId: USER_ID,
			type: "Expense",
			date: gst("2026-10-01T00:30:00.000+04:00"),
			amount: 222,
			accountId: "aed-active",
			categoryId: "cat-food",
			updatedAt: now,
		},
		{
			id: "usd-expense",
			userId: USER_ID,
			type: "Expense",
			date: gst("2026-09-15T12:00:00.000+04:00"),
			amount: 400,
			accountId: "usd-active",
			categoryId: "cat-usd-food",
			updatedAt: now,
		},
		{
			id: "other-user-expense",
			userId: OTHER_USER_ID,
			type: "Expense",
			date: gst("2026-09-15T12:00:00.000+04:00"),
			amount: 777,
			accountId: "other-aed",
			updatedAt: now,
		},
	]);
}

describe("analytics period resolution", () => {
	it("produces UTC+4 monthly boundaries at first-day and last-day edges", () => {
		const firstDay = resolveAnalyticsPeriod({
			interval: "monthly",
			anchorDate: new Date("2026-09-01T00:30:00.000+04:00"),
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});
		const lastDay = resolveAnalyticsPeriod({
			interval: "monthly",
			anchorDate: new Date("2026-09-30T23:30:00.000+04:00"),
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});

		expect(firstDay.from.toISOString()).toBe("2026-08-31T20:00:00.000Z");
		expect(firstDay.to.toISOString()).toBe("2026-09-30T19:59:59.999Z");
		expect(lastDay.from.toISOString()).toBe(firstDay.from.toISOString());
		expect(lastDay.to.toISOString()).toBe(firstDay.to.toISOString());
	});

	it("resolves interval windows without applying fiscal months to month or quarter", () => {
		const anchorDate = new Date("2026-09-15T12:00:00.000+04:00");
		const month = resolveAnalyticsPeriod({
			interval: "monthly",
			anchorDate,
			fiscalYearStartMonth: 7,
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});
		const quarter = resolveAnalyticsPeriod({
			interval: "quarterly",
			anchorDate,
			fiscalYearStartMonth: 7,
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});
		const halfYear = resolveAnalyticsPeriod({
			interval: "half-yearly",
			anchorDate,
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});
		const fiscalYear = resolveAnalyticsPeriod({
			interval: "yearly",
			anchorDate,
			fiscalYearStartMonth: 7,
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});

		expect(month.from.toISOString()).toBe("2026-08-31T20:00:00.000Z");
		expect(quarter.from.toISOString()).toBe("2026-06-30T20:00:00.000Z");
		expect(quarter.to.toISOString()).toBe("2026-09-30T19:59:59.999Z");
		expect(halfYear.from.toISOString()).toBe("2026-06-30T20:00:00.000Z");
		expect(halfYear.to.toISOString()).toBe("2026-12-31T19:59:59.999Z");
		expect(fiscalYear.from.toISOString()).toBe("2026-06-30T20:00:00.000Z");
		expect(fiscalYear.to.toISOString()).toBe("2027-06-30T19:59:59.999Z");
	});

	it("returns month strip ranges around a selected month", () => {
		const strip = getMonthStripRanges(new Date("2026-09-15T12:00:00.000+04:00"), {
			months: 4,
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});

		expect(strip.map((item) => item.key)).toEqual(["2026-08", "2026-09", "2026-10", "2026-11"]);
	});

	it("keeps existing getDateRange all-time epoch behaviour", () => {
		const range = getDateRange("all");
		expect(range.from.getTime()).toBe(0);
		expect(range.to.getTime()).toBe(8640000000000000);
	});
});

describe("historical analytics queries", () => {
	beforeEach(async () => {
		await db.accounts.clear();
		await db.categories.clear();
		await db.transactions.clear();
		await seedAnalyticsHistoryData();
	});

	it("returns period totals and category breakdowns that exactly sum to totals", async () => {
		const analytics = await getPeriodAnalytics(USER_ID, {
			currency: "AED",
			interval: "monthly",
			anchorDate: new Date("2026-09-15T12:00:00.000+04:00"),
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});

		expect(analytics.income).toBe(1000);
		expect(analytics.expense).toBe(320);
		expect(analytics.net).toBe(680);
		expect(analytics.transactionCount).toBe(4);
		expect(analytics.expenseBreakdown.map((item) => [item.title, item.amount])).toEqual([
			["Food & Drink", 200],
			["Transport", 70],
			[UNCATEGORIZED_CATEGORY_TITLE, 50],
		]);
		expect(analytics.expenseBreakdown.reduce((sum, item) => sum + item.amount, 0)).toBe(
			analytics.expense
		);
		expect(analytics.incomeBreakdown).toEqual([
			{
				categoryId: "cat-salary",
				title: "Salary",
				color: "#22c55e",
				icon: "💼",
				amount: 1000,
				share: 1,
			},
		]);
	});

	it("isolates currencies and excludes transfers and soft-deleted records", async () => {
		const aed = await getPeriodAnalytics(USER_ID, {
			currency: "AED",
			interval: "monthly",
			anchorDate: new Date("2026-09-15T12:00:00.000+04:00"),
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});
		const usd = await getPeriodAnalytics(USER_ID, {
			currency: "USD",
			interval: "monthly",
			anchorDate: new Date("2026-09-15T12:00:00.000+04:00"),
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});

		expect(aed.expense).toBe(320);
		expect(usd.income).toBe(0);
		expect(usd.expense).toBe(400);
		expect(usd.expenseBreakdown).toEqual([
			{
				categoryId: "cat-usd-food",
				title: "USD Food",
				color: "#a855f7",
				amount: 400,
				share: 1,
			},
		]);
	});

	it("returns zeroes for a month with no data", async () => {
		const analytics = await getPeriodAnalytics(USER_ID, {
			currency: "AED",
			interval: "monthly",
			anchorDate: new Date("2026-07-15T12:00:00.000+04:00"),
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});

		expect(analytics.income).toBe(0);
		expect(analytics.expense).toBe(0);
		expect(analytics.net).toBe(0);
		expect(analytics.incomeBreakdown).toEqual([]);
		expect(analytics.expenseBreakdown).toEqual([]);
	});

	it("builds monthly summaries with one bounded scan over the requested window", async () => {
		const summaries = await getMonthlySummaries(USER_ID, {
			currency: "AED",
			months: 3,
			anchorDate: new Date("2026-09-15T12:00:00.000+04:00"),
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
		});

		expect(summaries.map((item) => [item.key, item.income, item.expense])).toEqual([
			["2026-07", 0, 0],
			["2026-08", 0, 111],
			["2026-09", 1000, 320],
		]);
	});

	it("includes archived accounts in account totals and current balances", async () => {
		const analytics = await getAccountsAnalytics(USER_ID, {
			currency: "AED",
			asOf: new Date("2026-09-30T23:30:00.000+04:00"),
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
			period: {
				interval: "monthly",
				anchorDate: new Date("2026-09-15T12:00:00.000+04:00"),
				timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
			},
		});

		expect(analytics.inflow).toBe(1000);
		expect(analytics.outflow).toBe(320);
		expect(analytics.netFlow).toBe(680);
		expect(analytics.accounts.map((account) => account.accountId).sort()).toEqual([
			"aed-active",
			"aed-archived",
			"aed-liability",
		]);
		expect(
			Object.fromEntries(analytics.accounts.map((account) => [account.accountId, account.balance]))
		).toEqual({
			"aed-active": 1489,
			"aed-archived": 330,
			"aed-liability": -500,
		});
		expect(
			analytics.allAccounts.find((account) => account.accountId === "usd-active")
		).toMatchObject({
			balance: -250,
			currency: "USD",
		});
		expect(analytics.netWorth).toBe(1319);
	});

	it("warns while preserving legacy invalid-transfer source debits", async () => {
		await db.transactions.put({
			id: "aed-invalid-transfer",
			userId: USER_ID,
			type: "Transfer",
			date: gst("2026-09-16T12:00:00.000+04:00"),
			amount: 532154.23,
			accountId: "aed-active",
			updatedAt: gst("2026-09-16T12:00:00.000+04:00"),
		});

		const analytics = await getAccountsAnalytics(USER_ID, {
			currency: "AED",
			asOf: new Date("2026-09-30T23:30:00.000+04:00"),
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
			period: {
				interval: "monthly",
				anchorDate: new Date("2026-09-15T12:00:00.000+04:00"),
				timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
			},
		});

		expect(analytics.accounts.find((account) => account.accountId === "aed-active")?.balance).toBe(
			-530665.23
		);
		expect(analytics.warnings).toContainEqual({
			code: "invalid_transfer_counterparty_skipped",
			transactionId: "aed-invalid-transfer",
			message:
				"Transfer destination is missing or deleted; the source account was still debited to preserve legacy balance arithmetic.",
		});
	});

	it("reconciles the balance regression fixture against imported ground truth", () => {
		const regressedFixture = buildBalanceRegressionFixture(532154.23);
		const regressed = aggregateWithRegressedTransferSemantics(
			regressedFixture.accounts,
			regressedFixture.transactions
		);

		expect(regressed.cashBalance).toBeCloseTo(-4494676.42, 2);

		const { accounts, transactions } = buildBalanceRegressionFixture(1848.59);
		const analytics = aggregateAccountsAnalytics(USER_ID, accounts, transactions, {
			currency: "AED",
			asOf: new Date("2026-09-30T23:30:00.000+04:00"),
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
			period: {
				interval: "monthly",
				anchorDate: new Date("2026-09-15T12:00:00.000+04:00"),
				timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
			},
		});
		const cash = analytics.accounts.find((account) => account.accountId === "cash-aed");
		const balances = computeAccountBalances(USER_ID, accounts, transactions, {
			asOfMs: new Date("2026-09-30T23:30:00.000+04:00").getTime(),
		}).balances;

		expect(transactions).toHaveLength(10000);
		expect(cash?.balance).toBeCloseTo(378.09, 2);
		expect(analytics.netWorth).toBeCloseTo(97371.12, 2);
		expect(analytics.inflow).toBeCloseTo(8884.73, 2);
		expect(analytics.outflow).toBeCloseTo(10355.23, 2);
		expect(analytics.warnings).toHaveLength(9);
		assertBalanceConservation(accounts, transactions, balances);

		const allTime = aggregateAccountsAnalytics(USER_ID, accounts, transactions, {
			currency: "AED",
			asOf: new Date("2026-09-30T23:30:00.000+04:00"),
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
			period: {
				interval: "all-time",
				anchorDate: new Date("2026-09-15T12:00:00.000+04:00"),
				timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
			},
		});

		expect(allTime.inflow).toBeCloseTo(2434770.56, 2);
		expect(allTime.outflow).toBeCloseTo(2133900, 2);
	});

	it("keeps bad-currency transfer counterparties visible and applies transfer legs symmetrically", () => {
		const now = gst("2026-09-29T12:00:00.000+04:00");
		const accounts: Account[] = [
			{
				id: "cash-aed",
				userId: USER_ID,
				title: "Cash",
				openingBalance: 1000,
				currency: "AED",
				isArchived: false,
				updatedAt: now,
			},
			{
				id: "pkr-missing-from-enabled-currencies",
				userId: USER_ID,
				title: "PKR account not in enabled currencies",
				openingBalance: 5000,
				currency: "PKR",
				isArchived: false,
				updatedAt: now,
			},
			{
				id: "blank-currency-account",
				userId: USER_ID,
				title: "Account with blank currency",
				openingBalance: 0,
				currency: "",
				isArchived: false,
				updatedAt: now,
			},
			{
				id: "lowercase-aed-account",
				userId: USER_ID,
				title: "Lowercase AED account",
				openingBalance: 200,
				currency: "aed",
				isArchived: false,
				updatedAt: now,
			},
			{
				id: "whitespace-aed-account",
				userId: USER_ID,
				title: "Whitespace AED account",
				openingBalance: 300,
				currency: " AED ",
				isArchived: false,
				updatedAt: now,
			},
			{
				id: "undefined-currency-account",
				userId: USER_ID,
				title: "Undefined currency account",
				openingBalance: 7,
				currency: undefined as unknown as string,
				isArchived: false,
				updatedAt: now,
			},
		];
		const transactions: Transaction[] = [
			{
				id: "pkr-to-cash-heavy-transfer",
				userId: USER_ID,
				type: "Transfer",
				date: now,
				amount: 4000,
				accountId: "pkr-missing-from-enabled-currencies",
				toAccountId: "cash-aed",
				updatedAt: now,
			},
			{
				id: "cash-to-blank-currency-transfer",
				userId: USER_ID,
				type: "Transfer",
				date: now + 1,
				amount: 1000,
				accountId: "cash-aed",
				toAccountId: "blank-currency-account",
				updatedAt: now,
			},
			{
				id: "blank-currency-income",
				userId: USER_ID,
				type: "Income",
				date: now + 2,
				amount: 100,
				accountId: "blank-currency-account",
				updatedAt: now,
			},
			{
				id: "lowercase-aed-expense",
				userId: USER_ID,
				type: "Expense",
				date: now + 3,
				amount: 50,
				accountId: "lowercase-aed-account",
				updatedAt: now,
			},
			{
				id: "whitespace-aed-income",
				userId: USER_ID,
				type: "Income",
				date: now + 4,
				amount: 20,
				accountId: "whitespace-aed-account",
				updatedAt: now,
			},
		];
		const regressed = aggregateWithRegressedTransferSemantics(accounts, transactions);

		expect(regressed.cashBalance).toBe(0);

		const analytics = aggregateAccountsAnalytics(USER_ID, accounts, transactions, {
			currency: "AED",
			enabledCurrencies: ["AED"],
			asOf: new Date("2026-09-30T23:30:00.000+04:00"),
			timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
			period: {
				interval: "monthly",
				anchorDate: new Date("2026-09-15T12:00:00.000+04:00"),
				timeZoneOffsetMinutes: GST_OFFSET_MINUTES,
			},
		});
		const balances = new Map(
			analytics.allAccounts.map((account) => [account.accountId, account.balance])
		);

		expect(Object.fromEntries(balances)).toMatchObject({
			"cash-aed": 4000,
			"pkr-missing-from-enabled-currencies": 1000,
			"blank-currency-account": 1100,
			"lowercase-aed-account": 150,
			"whitespace-aed-account": 320,
			"undefined-currency-account": 7,
		});
		expect(analytics.netWorth).toBe(4470);
		expect(analytics.accounts.map((account) => account.accountId).sort()).toEqual([
			"cash-aed",
			"lowercase-aed-account",
			"whitespace-aed-account",
		]);
		expect(analytics.unscopedAccounts.map((account) => account.accountId).sort()).toEqual([
			"blank-currency-account",
			"pkr-missing-from-enabled-currencies",
			"undefined-currency-account",
		]);
		expect(analytics.warnings.map((warning) => warning.code)).toEqual([
			"cross_currency_transfer_destination_skipped",
			"cross_currency_transfer_destination_skipped",
			"account_currency_unscoped",
			"account_currency_unscoped",
			"account_currency_unscoped",
		]);
		assertBalanceConservation(accounts, transactions, balances);
		assertTransferLegsVisible(
			accounts,
			transactions,
			new Set(analytics.allAccounts.map((account) => account.accountId))
		);
	});
});
