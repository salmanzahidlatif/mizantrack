import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import {
	getAccountsAnalytics,
	getMonthlySummaries,
	getPeriodAnalytics,
	UNCATEGORIZED_CATEGORY_TITLE,
} from "@/lib/analytics/periodAnalytics";
import { getDateRange, getMonthStripRanges, resolveAnalyticsPeriod } from "@/lib/dateRange";
import { db } from "@/lib/db/local";

const USER_ID = "analytics-history-user";
const OTHER_USER_ID = "analytics-history-other-user";
const GST_OFFSET_MINUTES = 4 * 60;

function gst(date: string): number {
	return new Date(date).getTime();
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
		expect(analytics.netWorth).toBe(1319);
	});

	it("does not let invalid transfers affect historical account balances", async () => {
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
			1489
		);
		expect(analytics.warnings).toContainEqual({
			code: "invalid_transfer_counterparty_skipped",
			transactionId: "aed-invalid-transfer",
			message:
				"Transfer balance impact was skipped because the destination account is missing or deleted.",
		});
	});
});
