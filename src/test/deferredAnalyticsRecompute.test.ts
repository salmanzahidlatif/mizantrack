/**
 * Local writes (transactions, accounts, categories) must resolve as soon as
 * Dexie has persisted the record. The analytics recompute is queued behind the
 * shared debounce in `scheduleAnalyticsRecompute` instead of being awaited.
 */
import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics/computeDashboardStats", async (importOriginal) => {
	const actual = await importOriginal<typeof ComputeDashboardStatsModule>();
	return {
		...actual,
		computeDashboardStats: vi.fn(),
	};
});

vi.mock("@/lib/db/firebase", () => ({
	getFirestoreForUser: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
	doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
	setDoc: vi.fn(),
}));

import { createAccount } from "@/lib/actions/accounts";
import { createTransaction, updateTransaction } from "@/lib/actions/transactions";
import { computeDashboardStats } from "@/lib/analytics/computeDashboardStats";
import { flushAnalyticsRecompute } from "@/lib/analytics/scheduleRecompute";
import { getFirestoreForUser } from "@/lib/db/firebase";
import { db } from "@/lib/db/local";

import type * as ComputeDashboardStatsModule from "@/lib/analytics/computeDashboardStats";
import type { DashboardStats } from "@/types";

const USER_ID = "user-deferred-analytics";
const ACCOUNT_ID = "550e8400-e29b-41d4-a716-446655440090";
const ACCOUNT_ID_2 = "550e8400-e29b-41d4-a716-446655440091";
const TXN_ID = "550e8400-e29b-41d4-a716-446655440092";
const TXN_ID_2 = "550e8400-e29b-41d4-a716-446655440093";
const TXN_ID_3 = "550e8400-e29b-41d4-a716-446655440094";

let releaseRecompute: () => void = () => {};

function buildStats(): DashboardStats {
	return {
		id: USER_ID,
		updatedAt: 1,
		balances: { [ACCOUNT_ID]: -100 },
		perCurrency: {
			AED: { monthIncome: 0, monthExpense: 100, trend: [] },
		},
		recent: [],
	};
}

function expenseValues(amount: number) {
	return {
		type: "Expense" as const,
		amount,
		date: new Date("2026-02-10T09:00:00.000Z"),
		accountId: ACCOUNT_ID,
	};
}

describe("deferred analytics recompute after local writes", () => {
	beforeEach(async () => {
		await db.transactions.clear();
		await db.accounts.clear();
		await db.dashboardStats.clear();
		vi.clearAllMocks();
		vi.mocked(getFirestoreForUser).mockResolvedValue(null);

		const gate = new Promise<void>((resolve) => {
			releaseRecompute = resolve;
		});
		vi.mocked(computeDashboardStats).mockImplementation(async () => {
			await gate;
			return buildStats();
		});

		await db.accounts.put({
			id: ACCOUNT_ID,
			userId: USER_ID,
			title: "AED Wallet",
			openingBalance: 0,
			currency: "AED",
			isArchived: false,
			updatedAt: Date.now(),
		});
	});

	afterEach(async () => {
		releaseRecompute();
		await flushAnalyticsRecompute(USER_ID).catch(() => undefined);
	});

	it("resolves a create while the analytics recompute is still pending", async () => {
		const id = await createTransaction(USER_ID, expenseValues(100), { id: TXN_ID });

		expect(id).toBe(TXN_ID);
		expect(await db.transactions.get(TXN_ID)).toMatchObject({
			amount: 100,
			accountId: ACCOUNT_ID,
			pendingSync: true,
		});
		expect(await db.dashboardStats.get(USER_ID)).toBeUndefined();

		releaseRecompute();
		await flushAnalyticsRecompute(USER_ID);

		expect(computeDashboardStats).toHaveBeenCalledWith(USER_ID);
		expect(await db.dashboardStats.get(USER_ID)).toMatchObject({
			id: USER_ID,
			balances: { [ACCOUNT_ID]: -100 },
		});
	});

	it("coalesces several rapid writes into a single background recompute", async () => {
		releaseRecompute();

		await createTransaction(USER_ID, expenseValues(10), { id: TXN_ID });
		await createTransaction(USER_ID, expenseValues(20), { id: TXN_ID_2 });
		await createTransaction(USER_ID, expenseValues(30), { id: TXN_ID_3 });
		await createAccount(
			USER_ID,
			{ title: "Second Wallet", currency: "AED", openingBalance: 0 },
			{ id: ACCOUNT_ID_2 }
		);

		expect(computeDashboardStats).not.toHaveBeenCalled();

		await flushAnalyticsRecompute(USER_ID);

		expect(computeDashboardStats).toHaveBeenCalledTimes(1);
		expect(await db.dashboardStats.get(USER_ID)).toBeDefined();
	});

	it("logs a failing background recompute without rejecting the save", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		vi.mocked(computeDashboardStats).mockRejectedValue(new Error("recompute exploded"));

		await expect(createTransaction(USER_ID, expenseValues(100), { id: TXN_ID })).resolves.toBe(
			TXN_ID
		);

		await vi.waitFor(() => {
			expect(consoleError).toHaveBeenCalledWith(
				"Dashboard analytics recompute failed:",
				expect.objectContaining({ message: "recompute exploded" })
			);
		});

		expect(await db.transactions.get(TXN_ID)).toMatchObject({ amount: 100 });
		consoleError.mockRestore();
	});

	it("still throws validation and not-found errors without scheduling a recompute", async () => {
		await expect(
			createTransaction(USER_ID, {
				type: "Transfer",
				amount: 200,
				date: new Date("2026-02-10T09:00:00.000Z"),
				accountId: ACCOUNT_ID,
				toAccountId: "",
			})
		).rejects.toThrow("Destination account is required for transfers");

		await expect(updateTransaction(USER_ID, TXN_ID, expenseValues(50))).rejects.toThrow(
			"Transaction was not found. Please reload and try again."
		);

		releaseRecompute();
		await flushAnalyticsRecompute(USER_ID);

		expect(computeDashboardStats).not.toHaveBeenCalled();
	});
});
