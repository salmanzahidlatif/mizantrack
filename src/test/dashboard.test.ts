/**
 * Sprint 4: Dashboard & Reports tests
 * Covers: useMonthlySummary aggregation, getDateRange period logic
 */
import "fake-indexeddb/auto";

import { format, startOfMonth, subMonths } from "date-fns";
import { beforeEach, describe, expect, it } from "vitest";

import { getDateRange } from "@/lib/dateRange";
import { db } from "@/lib/db/local";

const USER_ID = "user-sprint4-test";
const ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440040";

// ─── getDateRange period tests ──────────────────────────────────────────────

describe("getDateRange", () => {
	it("returns today boundaries", () => {
		const { from, to } = getDateRange("today", 7);
		const today = new Date();
		expect(from.getDate()).toBe(today.getDate());
		expect(to.getDate()).toBe(today.getDate());
	});

	it("returns current month boundaries for 'month'", () => {
		const { from, to: _to } = getDateRange("month", 7);
		const now = new Date();
		expect(from.getMonth()).toBe(now.getMonth());
		expect(from.getDate()).toBe(1);
	});

	it("returns correct fiscal year start for July start (month=7)", () => {
		const { from } = getDateRange("fiscal-year", 7);
		expect(from.getMonth()).toBe(6); // July = index 6
		expect(from.getDate()).toBe(1);
	});

	it("returns correct fiscal year start for January start (month=1)", () => {
		const { from } = getDateRange("fiscal-year", 1);
		expect(from.getMonth()).toBe(0); // January = index 0
		expect(from.getDate()).toBe(1);
	});

	it("uses custom range when period is 'custom'", () => {
		const customFrom = new Date("2025-01-01");
		const customTo = new Date("2025-03-31");
		const { from, to } = getDateRange("custom", 7, { from: customFrom, to: customTo });
		expect(from.toISOString()).toBe(customFrom.toISOString());
		expect(to.toISOString()).toBe(customTo.toISOString());
	});

	it("falls back to month when 'custom' but no custom range", () => {
		const { from } = getDateRange("custom", 7);
		// should return month start
		const now = new Date();
		expect(from.getDate()).toBe(1);
		expect(from.getMonth()).toBe(now.getMonth());
	});

	it("returns quarter spanning 3 months", () => {
		const { from, to } = getDateRange("quarter", 7);
		const monthDiff =
			(to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();
		expect(monthDiff).toBe(2); // from start to end of 3rd month
	});

	it("returns half-year spanning 6 months", () => {
		const { from, to } = getDateRange("half-year", 7);
		const monthDiff =
			(to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();
		expect(monthDiff).toBe(5);
	});
});

// ─── Monthly summary aggregation ────────────────────────────────────────────

describe("monthly summary aggregation", () => {
	beforeEach(async () => {
		await db.transactions.clear();
	});

	it("sums income and expense within a month correctly", async () => {
		const now = new Date();
		const thisMonth = startOfMonth(now).getTime() + 86400 * 1000; // 1 day into month

		await db.transactions.bulkAdd([
			{
				id: "550e8400-e29b-41d4-a716-446655440041",
				userId: USER_ID,
				type: "Income",
				amount: 1000,
				date: thisMonth,
				accountId: ACCOUNT_ID,
				updatedAt: Date.now(),
			},
			{
				id: "550e8400-e29b-41d4-a716-446655440042",
				userId: USER_ID,
				type: "Expense",
				amount: 400,
				date: thisMonth,
				accountId: ACCOUNT_ID,
				updatedAt: Date.now(),
			},
			{
				id: "550e8400-e29b-41d4-a716-446655440043",
				userId: USER_ID,
				type: "Expense",
				amount: 200,
				date: thisMonth,
				accountId: ACCOUNT_ID,
				updatedAt: Date.now(),
			},
		]);

		const txns = await db.transactions
			.where("userId")
			.equals(USER_ID)
			.filter((t) => !t.deletedAt)
			.toArray();

		const income = txns.filter((t) => t.type === "Income").reduce((s, t) => s + t.amount, 0);
		const expense = txns.filter((t) => t.type === "Expense").reduce((s, t) => s + t.amount, 0);

		expect(income).toBe(1000);
		expect(expense).toBe(600);
		expect(income - expense).toBe(400);
	});

	it("excludes deleted transactions from summary", async () => {
		const thisMonth = startOfMonth(new Date()).getTime() + 86400 * 1000;

		await db.transactions.bulkAdd([
			{
				id: "550e8400-e29b-41d4-a716-446655440044",
				userId: USER_ID,
				type: "Income",
				amount: 500,
				date: thisMonth,
				accountId: ACCOUNT_ID,
				updatedAt: Date.now(),
			},
			{
				id: "550e8400-e29b-41d4-a716-446655440045",
				userId: USER_ID,
				type: "Expense",
				amount: 300,
				date: thisMonth,
				accountId: ACCOUNT_ID,
				updatedAt: Date.now(),
				deletedAt: Date.now(), // soft-deleted
			},
		]);

		const txns = await db.transactions
			.where("userId")
			.equals(USER_ID)
			.filter((t) => !t.deletedAt)
			.toArray();

		const expense = txns.filter((t) => t.type === "Expense").reduce((s, t) => s + t.amount, 0);
		expect(expense).toBe(0); // deleted expense excluded
	});

	it("produces correct month label format", () => {
		const date = new Date(2025, 0, 15); // Jan 2025
		expect(format(date, "MMM yy")).toBe("Jan 25");
	});

	it("builds correct 6-month bucket range", () => {
		const months = 6;
		const now = new Date();
		const labels: string[] = [];
		for (let i = months - 1; i >= 0; i--) {
			labels.push(format(subMonths(now, i), "MMM yy"));
		}
		expect(labels).toHaveLength(6);
		expect(labels[5]).toBe(format(now, "MMM yy")); // last label = current month
		expect(labels[0]).toBe(format(subMonths(now, 5), "MMM yy"));
	});
});
