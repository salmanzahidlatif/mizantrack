/**
 * Recurring transactions and bulk editing.
 *
 * Occurrences are materialised as real transactions, so these tests pin the two things
 * that behaviour depends on: the schedule a rule expands to, and the fact that a bulk
 * edit only ever touches the fields the owner enabled.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
	applyBulkAmount,
	buildBulkTransactionPatch,
	bulkDeleteTransactions,
	bulkUpdateTransactions,
	createRecurringTransactions,
	loadRecurrenceSeriesIds,
	updateTransactionSeries,
} from "@/lib/actions/transactions";
import { db } from "@/lib/db/local";
import {
	MAX_RECURRENCE_OCCURRENCES,
	generateRecurrenceDates,
	generateRecurrenceTimestamps,
} from "@/lib/recurrence";
import {
	bulkTransactionEditSchema,
	isEmptyBulkTransactionEdit,
} from "@/lib/validations/transaction";

import type { Transaction } from "@/types";

const USER_ID = "user-recurring-test";
const ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440040";
const ACCOUNT_ID_2 = "550e8400-e29b-41d4-a716-446655440041";
const CATEGORY_ID = "550e8400-e29b-41d4-a716-446655440042";
const CATEGORY_ID_2 = "550e8400-e29b-41d4-a716-446655440043";

function iso(date: Date): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
		date.getDate()
	).padStart(2, "0")}`;
}

function makeTransaction(overrides: Partial<Transaction> & { id: string }): Transaction {
	return {
		userId: USER_ID,
		type: "Expense",
		amount: 1000,
		date: new Date(2026, 0, 10).getTime(),
		accountId: ACCOUNT_ID,
		updatedAt: Date.now(),
		...overrides,
	};
}

// ─── generateRecurrenceDates ───────────────────────────────────────────────

describe("generateRecurrenceDates", () => {
	it("includes the start date as the first occurrence", () => {
		const start = new Date(2026, 0, 5);
		const dates = generateRecurrenceDates(start, {
			frequency: "daily",
			interval: 1,
			endMode: "count",
			count: 10,
		});

		expect(dates).toHaveLength(10);
		expect(iso(dates[0]!)).toBe("2026-01-05");
		expect(iso(dates[9]!)).toBe("2026-01-14");
	});

	it("keeps the same day of month across a year", () => {
		const dates = generateRecurrenceDates(new Date(2026, 0, 15), {
			frequency: "monthly",
			interval: 1,
			endMode: "count",
			count: 12,
		});

		expect(dates).toHaveLength(12);
		expect(dates.every((date) => date.getDate() === 15)).toBe(true);
		expect(iso(dates[11]!)).toBe("2026-12-15");
	});

	it("measures each occurrence from the anchor so a short month does not drag the series", () => {
		const dates = generateRecurrenceDates(new Date(2026, 0, 31), {
			frequency: "monthly",
			interval: 1,
			endMode: "count",
			count: 4,
		});

		// A chained +1 month would clamp to 28 Feb and then stay on the 28th.
		expect(dates.map(iso)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
	});

	it("honours an interval greater than one", () => {
		const dates = generateRecurrenceDates(new Date(2026, 0, 1), {
			frequency: "weekly",
			interval: 2,
			endMode: "count",
			count: 3,
		});

		expect(dates.map(iso)).toEqual(["2026-01-01", "2026-01-15", "2026-01-29"]);
	});

	it("stops at the end date and never overshoots it", () => {
		const dates = generateRecurrenceDates(new Date(2026, 0, 1), {
			frequency: "monthly",
			interval: 1,
			endMode: "until",
			until: new Date(2026, 3, 15),
		});

		expect(dates.map(iso)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"]);
	});

	it("caps a runaway series", () => {
		const dates = generateRecurrenceDates(new Date(2026, 0, 1), {
			frequency: "daily",
			interval: 1,
			endMode: "until",
			until: new Date(2060, 0, 1),
		});

		expect(dates).toHaveLength(MAX_RECURRENCE_OCCURRENCES);
	});

	it("returns nothing for an end date before the start", () => {
		const dates = generateRecurrenceDates(new Date(2026, 5, 1), {
			frequency: "monthly",
			interval: 1,
			endMode: "until",
			until: new Date(2026, 0, 1),
		});

		expect(dates).toEqual([]);
	});

	it("keeps the time of day on every occurrence", () => {
		const start = new Date(2026, 0, 5, 14, 30);
		const timestamps = generateRecurrenceTimestamps(start, {
			frequency: "monthly",
			interval: 1,
			endMode: "count",
			count: 3,
		});

		expect(timestamps).toHaveLength(3);
		for (const timestamp of timestamps) {
			const date = new Date(timestamp);
			expect(date.getHours()).toBe(14);
			expect(date.getMinutes()).toBe(30);
		}
	});
});

// ─── createRecurringTransactions ───────────────────────────────────────────

describe("createRecurringTransactions", () => {
	beforeEach(async () => {
		await db.transactions.clear();
		await db.dashboardStats.clear();
	});

	it("writes one transaction per occurrence under a shared series id", async () => {
		const { recurrenceId, transactionIds } = await createRecurringTransactions(
			USER_ID,
			{
				type: "Expense",
				amount: 5000,
				date: new Date(2026, 0, 1),
				accountId: ACCOUNT_ID,
				categoryId: CATEGORY_ID,
				description: "Monthly rent",
			},
			{ frequency: "monthly", interval: 1, endMode: "count", count: 12 }
		);

		expect(transactionIds).toHaveLength(12);

		const stored = await db.transactions.where("userId").equals(USER_ID).toArray();
		expect(stored).toHaveLength(12);
		expect(stored.every((txn) => txn.recurrenceId === recurrenceId)).toBe(true);
		expect(stored.every((txn) => txn.description === "Monthly rent")).toBe(true);
		expect(new Set(stored.map((txn) => txn.id)).size).toBe(12);
		// Dexie's dirty hooks must still fire on a bulk write, or the series never syncs.
		expect(stored.every((txn) => (txn as { pendingSync?: boolean }).pendingSync)).toBe(true);
	});

	it("rejects a rule that produces nothing", async () => {
		await expect(
			createRecurringTransactions(
				USER_ID,
				{
					type: "Expense",
					amount: 10,
					date: new Date(2026, 5, 1),
					accountId: ACCOUNT_ID,
				},
				{ frequency: "monthly", interval: 1, endMode: "until", until: new Date(2026, 0, 1) }
			)
		).rejects.toThrow(/does not produce any transactions/i);
	});
});

// ─── loadRecurrenceSeriesIds ───────────────────────────────────────────────

describe("loadRecurrenceSeriesIds", () => {
	beforeEach(async () => {
		await db.transactions.clear();
		await db.transactions.bulkPut([
			makeTransaction({ id: "s1", recurrenceId: "series-a", date: new Date(2026, 0, 1).getTime() }),
			makeTransaction({ id: "s2", recurrenceId: "series-a", date: new Date(2026, 1, 1).getTime() }),
			makeTransaction({ id: "s3", recurrenceId: "series-a", date: new Date(2026, 2, 1).getTime() }),
			makeTransaction({ id: "other", date: new Date(2026, 1, 1).getTime() }),
		]);
	});

	it("returns only the anchor for a single-scope edit", async () => {
		expect(await loadRecurrenceSeriesIds(USER_ID, "s2", "single")).toEqual(["s2"]);
	});

	it("returns the whole series without reaching other transactions", async () => {
		const ids = await loadRecurrenceSeriesIds(USER_ID, "s2", "series");
		expect(new Set(ids)).toEqual(new Set(["s1", "s2", "s3"]));
	});

	it("returns only the anchor and later occurrences for a future-scope edit", async () => {
		const ids = await loadRecurrenceSeriesIds(USER_ID, "s2", "future");
		expect(new Set(ids)).toEqual(new Set(["s2", "s3"]));
	});

	it("falls back to the single transaction when it belongs to no series", async () => {
		expect(await loadRecurrenceSeriesIds(USER_ID, "other", "series")).toEqual(["other"]);
	});
});

// ─── updateTransactionSeries ───────────────────────────────────────────────

describe("updateTransactionSeries", () => {
	beforeEach(async () => {
		await db.transactions.clear();
		await db.dashboardStats.clear();
		await db.transactions.bulkPut([
			makeTransaction({
				id: "s1",
				recurrenceId: "series-a",
				amount: 5000,
				date: new Date(2026, 0, 1).getTime(),
			}),
			makeTransaction({
				id: "s2",
				recurrenceId: "series-a",
				amount: 5000,
				date: new Date(2026, 1, 1).getTime(),
			}),
		]);
	});

	it("applies the edit to every member while each keeps its own date", async () => {
		const updated = await updateTransactionSeries(USER_ID, ["s1", "s2"], {
			type: "Expense",
			amount: 5500,
			date: new Date(2026, 0, 1),
			accountId: ACCOUNT_ID,
			categoryId: CATEGORY_ID,
			description: "Rent (increased)",
		});

		expect(updated).toBe(2);

		const [first, second] = await Promise.all([
			db.transactions.get("s1"),
			db.transactions.get("s2"),
		]);
		expect(first?.amount).toBe(5500);
		expect(second?.amount).toBe(5500);
		expect(second?.description).toBe("Rent (increased)");
		// Collapsing the series onto one day is never what "apply to all" means.
		expect(second?.date).toBe(new Date(2026, 1, 1).getTime());
		expect(second?.recurrenceId).toBe("series-a");
	});
});

// ─── bulk amount maths ─────────────────────────────────────────────────────

describe("applyBulkAmount", () => {
	it("sets a fixed amount", () => {
		expect(applyBulkAmount(5000, { amountMode: "set", amountValue: 5500 })).toBe(5500);
	});

	it("adds and subtracts a flat amount", () => {
		expect(applyBulkAmount(5000, { amountMode: "adjustAmount", amountValue: 250 })).toBe(5250);
		expect(applyBulkAmount(5000, { amountMode: "adjustAmount", amountValue: -250 })).toBe(4750);
	});

	it("applies a percentage and rounds to cents", () => {
		expect(applyBulkAmount(5000, { amountMode: "adjustPercent", amountValue: 5 })).toBe(5250);
		expect(applyBulkAmount(33.33, { amountMode: "adjustPercent", amountValue: 10 })).toBe(36.66);
	});

	it("leaves the amount alone when no mode is chosen", () => {
		expect(applyBulkAmount(5000, {})).toBe(5000);
	});
});

// ─── buildBulkTransactionPatch ─────────────────────────────────────────────

describe("buildBulkTransactionPatch", () => {
	const now = 1_700_000_000_000;

	it("returns null when nothing would change", () => {
		const txn = makeTransaction({ id: "a", description: "Rent" });
		expect(buildBulkTransactionPatch(txn, { description: "Rent" }, now)).toBeNull();
	});

	it("changes only the enabled fields", () => {
		const txn = makeTransaction({
			id: "a",
			description: "Rent",
			place: "Dubai",
			categoryId: CATEGORY_ID,
		});
		const patched = buildBulkTransactionPatch(txn, { amountMode: "set", amountValue: 6000 }, now);

		expect(patched?.amount).toBe(6000);
		expect(patched?.description).toBe("Rent");
		expect(patched?.place).toBe("Dubai");
		expect(patched?.categoryId).toBe(CATEGORY_ID);
		expect(patched?.date).toBe(txn.date);
	});

	it("clears a category and a place when explicitly asked", () => {
		const txn = makeTransaction({ id: "a", categoryId: CATEGORY_ID, place: "Dubai" });
		const patched = buildBulkTransactionPatch(txn, { clearCategory: true, clearPlace: true }, now);

		expect(patched).not.toBeNull();
		expect(patched && "categoryId" in patched).toBe(false);
		expect(patched && "place" in patched).toBe(false);
	});

	it("clears the description rather than storing an empty string", () => {
		const txn = makeTransaction({ id: "a", description: "Rent", place: "Dubai" });
		const patched = buildBulkTransactionPatch(txn, { description: "   " }, now);

		expect(patched).not.toBeNull();
		expect(patched && "description" in patched).toBe(false);
		expect(patched?.place).toBe("Dubai");
	});

	it("trims a new description", () => {
		const txn = makeTransaction({ id: "a", description: "Rent" });
		expect(
			buildBulkTransactionPatch(txn, { description: "  Monthly rent " }, now)?.description
		).toBe("Monthly rent");
	});

	it("skips the category on a transfer instead of failing the batch", () => {
		const txn = makeTransaction({ id: "a", type: "Transfer", toAccountId: ACCOUNT_ID_2 });
		expect(buildBulkTransactionPatch(txn, { categoryId: CATEGORY_ID_2 }, now)).toBeNull();
	});

	it("refuses an adjustment that would drive an amount to zero or below", () => {
		const txn = makeTransaction({ id: "a", amount: 100 });
		expect(() =>
			buildBulkTransactionPatch(txn, { amountMode: "adjustAmount", amountValue: -100 }, now)
		).toThrow(/zero or negative/i);
	});

	it("refuses to point a transfer at its own destination account", () => {
		const txn = makeTransaction({ id: "a", type: "Transfer", toAccountId: ACCOUNT_ID_2 });
		expect(() => buildBulkTransactionPatch(txn, { accountId: ACCOUNT_ID_2 }, now)).toThrow(
			/move money to itself/i
		);
	});
});

// ─── bulkUpdateTransactions / bulkDeleteTransactions ───────────────────────

describe("bulkUpdateTransactions", () => {
	beforeEach(async () => {
		await db.transactions.clear();
		await db.dashboardStats.clear();
		await db.transactions.bulkPut([
			makeTransaction({ id: "a", amount: 5000, description: "Rent" }),
			makeTransaction({ id: "b", amount: 5000, description: "Rent" }),
			makeTransaction({ id: "c", amount: 300, description: "Groceries" }),
			makeTransaction({ id: "foreign", userId: "someone-else", amount: 5000 }),
		]);
	});

	it("updates every selected transaction and leaves the rest alone", async () => {
		const updated = await bulkUpdateTransactions(USER_ID, ["a", "b"], {
			amountMode: "set",
			amountValue: 5500,
			description: "Monthly rent",
		});

		expect(updated).toBe(2);
		expect((await db.transactions.get("a"))?.amount).toBe(5500);
		expect((await db.transactions.get("b"))?.description).toBe("Monthly rent");
		expect((await db.transactions.get("c"))?.amount).toBe(300);
	});

	it("raises every selected amount by a percentage", async () => {
		await bulkUpdateTransactions(USER_ID, ["a", "b"], {
			amountMode: "adjustPercent",
			amountValue: 10,
		});

		expect((await db.transactions.get("a"))?.amount).toBe(5500);
		expect((await db.transactions.get("b"))?.amount).toBe(5500);
	});

	it("never touches another user's transaction", async () => {
		const updated = await bulkUpdateTransactions(USER_ID, ["a", "foreign"], {
			amountMode: "set",
			amountValue: 1,
		});

		expect(updated).toBe(1);
		expect((await db.transactions.get("foreign"))?.amount).toBe(5000);
	});

	it("leaves every record untouched when one of them cannot be changed", async () => {
		await expect(
			bulkUpdateTransactions(USER_ID, ["a", "c"], {
				amountMode: "adjustAmount",
				amountValue: -500,
			})
		).rejects.toThrow(/zero or negative/i);

		expect((await db.transactions.get("a"))?.amount).toBe(5000);
		expect((await db.transactions.get("c"))?.amount).toBe(300);
	});

	it("rejects an edit that changes nothing", async () => {
		await expect(bulkUpdateTransactions(USER_ID, ["a"], {})).rejects.toThrow(/at least one field/i);
	});

	it("asks for an amount when the amount field is enabled but left blank", async () => {
		await expect(bulkUpdateTransactions(USER_ID, ["a"], { amountMode: "set" })).rejects.toThrow(
			/enter an amount/i
		);
	});

	it("rejects an empty selection", async () => {
		await expect(
			bulkUpdateTransactions(USER_ID, [], { amountMode: "set", amountValue: 10 })
		).rejects.toThrow(/at least one transaction/i);
	});
});

describe("bulkDeleteTransactions", () => {
	beforeEach(async () => {
		await db.transactions.clear();
		await db.dashboardStats.clear();
		await db.transactions.bulkPut([
			makeTransaction({ id: "a" }),
			makeTransaction({ id: "b" }),
			makeTransaction({ id: "foreign", userId: "someone-else" }),
		]);
	});

	it("tombstones rather than erases, so the deletion reaches other devices", async () => {
		const deleted = await bulkDeleteTransactions(USER_ID, ["a", "b"]);

		expect(deleted).toBe(2);
		const [first, second] = await Promise.all([db.transactions.get("a"), db.transactions.get("b")]);
		expect(first?.deletedAt).toBeTypeOf("number");
		expect(second?.deletedAt).toBeTypeOf("number");
	});

	it("never deletes another user's transaction", async () => {
		const deleted = await bulkDeleteTransactions(USER_ID, ["foreign"]);

		expect(deleted).toBe(0);
		expect((await db.transactions.get("foreign"))?.deletedAt).toBeUndefined();
	});
});

// ─── bulkTransactionEditSchema ─────────────────────────────────────────────

describe("bulkTransactionEditSchema", () => {
	it("rejects a set-amount of zero", () => {
		const result = bulkTransactionEditSchema.safeParse({ amountMode: "set", amountValue: 0 });
		expect(result.success).toBe(false);
	});

	it("accepts a negative adjustment", () => {
		const result = bulkTransactionEditSchema.safeParse({
			amountMode: "adjustAmount",
			amountValue: -250,
		});
		expect(result.success).toBe(true);
	});

	it("rejects setting and clearing the same field", () => {
		const result = bulkTransactionEditSchema.safeParse({
			categoryId: CATEGORY_ID,
			clearCategory: true,
		});
		expect(result.success).toBe(false);
	});

	it("reports an edit with no enabled field as empty", () => {
		expect(isEmptyBulkTransactionEdit({})).toBe(true);
		expect(isEmptyBulkTransactionEdit({ clearPlace: true })).toBe(false);
	});
});
