import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	findDuplicateAccountGroups,
	mergeDuplicateAccounts,
	normalizeAccountTitle,
} from "@/components/accounts/duplicateAccountMerge";
import { recomputeAnalyticsNow } from "@/lib/analytics/scheduleRecompute";
import { db, withoutSyncDirtyTracking } from "@/lib/db/local";

import type { Account, Transaction } from "@/types";

vi.mock("@/lib/analytics/scheduleRecompute", () => ({
	recomputeAnalyticsNow: vi.fn(),
}));

const USER_ID = "duplicate-account-merge-test-user";

function account(id: string, patch: Partial<Account> = {}): Account {
	return {
		id,
		userId: USER_ID,
		title: id,
		openingBalance: 0,
		currency: "AED",
		isArchived: false,
		updatedAt: 1_000,
		...patch,
	};
}

function transaction(id: string, patch: Partial<Transaction> = {}): Transaction {
	return {
		id,
		userId: USER_ID,
		type: "Expense",
		date: 1_000,
		amount: 10,
		accountId: "survivor",
		updatedAt: 1_000,
		...patch,
	};
}

async function seedData(input: { accounts?: Account[]; transactions?: Transaction[] }) {
	await withoutSyncDirtyTracking(async () => {
		if (input.accounts?.length) await db.accounts.bulkPut(input.accounts);
		if (input.transactions?.length) await db.transactions.bulkPut(input.transactions);
	});
}

function computeBalances(accounts: Account[], transactions: Transaction[]): Map<string, number> {
	const balances = new Map<string, number>();
	for (const item of accounts.filter((entry) => entry.userId === USER_ID)) {
		balances.set(item.id, item.openingBalance ?? 0);
	}

	for (const item of transactions) {
		if (item.userId !== USER_ID || item.deletedAt) continue;

		if (item.type === "Income") {
			balances.set(item.accountId, (balances.get(item.accountId) ?? 0) + item.amount);
			continue;
		}

		if (item.type === "Expense") {
			balances.set(item.accountId, (balances.get(item.accountId) ?? 0) - item.amount);
			continue;
		}

		balances.set(item.accountId, (balances.get(item.accountId) ?? 0) - item.amount);
		if (item.toAccountId) {
			balances.set(item.toAccountId, (balances.get(item.toAccountId) ?? 0) + item.amount);
		}
	}

	return balances;
}

function grandTotal(balances: Map<string, number>): number {
	return Array.from(balances.values()).reduce((total, value) => total + value, 0);
}

beforeEach(async () => {
	await db.delete();
	await db.open();
	vi.mocked(recomputeAnalyticsNow).mockClear();
});

describe("normalizeAccountTitle", () => {
	it("strips Hysab Kytab duplicate suffixes, trims, collapses whitespace, and lowercases", () => {
		expect(normalizeAccountTitle("  Cash   Wallet ~2  ")).toBe("cash wallet");
		expect(normalizeAccountTitle("Meezan    Current~3")).toBe("meezan current");
		expect(normalizeAccountTitle("  FAB   Share Card  ")).toBe("fab share card");
	});
});

describe("findDuplicateAccountGroups", () => {
	it("groups only by currency and normalized title", () => {
		const groups = findDuplicateAccountGroups(
			[
				account("aed-cash-1", { title: "Cash", currency: "AED" }),
				account("aed-cash-2", { title: " cash~2 ", currency: " aed " }),
				account("aed-bank", { title: "Cash", currency: "AED", deletedAt: 2_000 }),
				account("pkr-cash", { title: "CASH", currency: "PKR" }),
			],
			[
				transaction("txn-1", { accountId: "aed-cash-1" }),
				transaction("txn-2", { accountId: "aed-cash-2" }),
				transaction("txn-3", { accountId: "pkr-cash" }),
			]
		);

		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({
			currency: "AED",
			normalizedTitle: "cash",
			totalTransactionCount: 2,
		});
		expect(groups[0]?.candidates.map((candidate) => candidate.account.id).sort()).toEqual([
			"aed-cash-1",
			"aed-cash-2",
		]);
	});

	it("never groups same-title accounts across different currencies", () => {
		const groups = findDuplicateAccountGroups(
			[
				account("aed-cash", { title: "Cash", currency: "AED" }),
				account("pkr-cash", { title: "Cash", currency: "PKR" }),
			],
			[]
		);

		expect(groups).toEqual([]);
	});

	it("skips accounts with no or empty currency", () => {
		const groups = findDuplicateAccountGroups(
			[
				account("empty-cash-1", { title: "Cash", currency: "" }),
				account("empty-cash-2", { title: " cash~2 ", currency: "  " }),
				account("missing-cash", {
					title: "Cash",
					currency: undefined as unknown as string,
				}),
			],
			[]
		);

		expect(groups).toEqual([]);
	});

	it("excludes soft-deleted accounts", () => {
		const groups = findDuplicateAccountGroups(
			[
				account("active-cash", { title: "Cash", currency: "AED" }),
				account("deleted-cash", { title: "cash~2", currency: "AED", deletedAt: 2_000 }),
			],
			[]
		);

		expect(groups).toEqual([]);
	});
});

describe("mergeDuplicateAccounts", () => {
	it("remaps both transaction accountId and transfer toAccountId references", async () => {
		await seedData({
			accounts: [
				account("survivor", { title: "Cash", currency: "AED" }),
				account("duplicate", { title: "cash~2", currency: "AED" }),
				account("external", { title: "Savings", currency: "AED" }),
			],
			transactions: [
				transaction("income-on-loser", {
					type: "Income",
					accountId: "duplicate",
					amount: 25,
				}),
				transaction("transfer-from-loser", {
					type: "Transfer",
					accountId: "duplicate",
					toAccountId: "external",
					amount: 5,
				}),
				transaction("transfer-to-loser", {
					type: "Transfer",
					accountId: "external",
					toAccountId: "duplicate",
					amount: 7,
				}),
			],
		});

		const result = await mergeDuplicateAccounts(USER_ID, "survivor", ["duplicate"]);

		await expect(db.transactions.get("income-on-loser")).resolves.toMatchObject({
			accountId: "survivor",
		});
		await expect(db.transactions.get("transfer-from-loser")).resolves.toMatchObject({
			accountId: "survivor",
			toAccountId: "external",
		});
		await expect(db.transactions.get("transfer-to-loser")).resolves.toMatchObject({
			accountId: "external",
			toAccountId: "survivor",
		});
		expect(result).toMatchObject({
			movedTransactions: 2,
			movedTransferLegs: 1,
			activeTransactionsBefore: 3,
			activeSurvivorTransactionsAfter: 3,
		});
		expect(recomputeAnalyticsNow).toHaveBeenCalledWith(USER_ID);
	});

	it("absorbs loser opening balances into the survivor and zeroes losers without changing the group total", async () => {
		await seedData({
			accounts: [
				account("survivor", { title: "Bank", currency: "PKR", openingBalance: 100.25 }),
				account("duplicate-1", { title: "bank~2", currency: "PKR", openingBalance: 20.1 }),
				account("duplicate-2", { title: " BANK ~3", currency: "PKR", openingBalance: -5.35 }),
			],
		});
		const beforeTotal = (await db.accounts.toArray()).reduce(
			(total, item) => total + item.openingBalance,
			0
		);

		const result = await mergeDuplicateAccounts(USER_ID, "survivor", [
			"duplicate-1",
			"duplicate-2",
		]);

		const accounts = await db.accounts.toArray();
		const afterTotal = accounts.reduce((total, item) => total + item.openingBalance, 0);
		expect(accounts.find((item) => item.id === "survivor")?.openingBalance).toBe(115);
		expect(accounts.find((item) => item.id === "duplicate-1")?.openingBalance).toBe(0);
		expect(accounts.find((item) => item.id === "duplicate-2")?.openingBalance).toBe(0);
		expect(afterTotal).toBeCloseTo(beforeTotal, 10);
		expect(result.absorbedOpeningBalance).toBe(14.75);
	});

	it("conserves the grand total of account balances across income, expenses, and transfers", async () => {
		await seedData({
			accounts: [
				account("survivor", { title: "Cash", currency: "AED", openingBalance: 100 }),
				account("duplicate", { title: "cash~2", currency: "AED", openingBalance: 50 }),
				account("wallet", { title: "Wallet", currency: "AED", openingBalance: 25 }),
			],
			transactions: [
				transaction("survivor-income", {
					type: "Income",
					accountId: "survivor",
					amount: 20,
				}),
				transaction("loser-expense", {
					type: "Expense",
					accountId: "duplicate",
					amount: 8,
				}),
				transaction("loser-to-wallet", {
					type: "Transfer",
					accountId: "duplicate",
					toAccountId: "wallet",
					amount: 11,
				}),
				transaction("wallet-to-loser", {
					type: "Transfer",
					accountId: "wallet",
					toAccountId: "duplicate",
					amount: 6,
				}),
			],
		});
		const beforeAccounts = await db.accounts.toArray();
		const beforeTransactions = await db.transactions.toArray();
		const beforeGrandTotal = grandTotal(computeBalances(beforeAccounts, beforeTransactions));

		await mergeDuplicateAccounts(USER_ID, "survivor", ["duplicate"]);

		const afterAccounts = await db.accounts.toArray();
		const afterTransactions = await db.transactions.toArray();
		const afterGrandTotal = grandTotal(computeBalances(afterAccounts, afterTransactions));
		expect(afterGrandTotal).toBeCloseTo(beforeGrandTotal, 10);
	});

	it("reports self-transfers created when duplicate accounts were the two legs of the same transfer", async () => {
		await seedData({
			accounts: [
				account("survivor", { title: "Cash", currency: "AED", openingBalance: 0 }),
				account("duplicate", { title: "cash~2", currency: "AED", openingBalance: 0 }),
			],
			transactions: [
				transaction("between-duplicates", {
					type: "Transfer",
					accountId: "survivor",
					toAccountId: "duplicate",
					amount: 42,
				}),
			],
		});

		const result = await mergeDuplicateAccounts(USER_ID, "survivor", ["duplicate"]);
		const transfer = await db.transactions.get("between-duplicates");
		const balances = computeBalances(await db.accounts.toArray(), await db.transactions.toArray());

		expect(result.selfTransfersCreated).toBe(1);
		expect(transfer).toMatchObject({ accountId: "survivor", toAccountId: "survivor" });
		expect(balances.get("survivor")).toBe(0);
	});

	it("soft-deletes losers instead of hard-deleting them", async () => {
		await seedData({
			accounts: [
				account("survivor", { title: "Cash", currency: "AED" }),
				account("duplicate", { title: "cash~2", currency: "AED" }),
			],
		});

		const result = await mergeDuplicateAccounts(USER_ID, "survivor", ["duplicate"]);
		const duplicate = await db.accounts.get("duplicate");

		expect(result.softDeletedAccounts).toBe(1);
		expect(duplicate).toBeDefined();
		expect(duplicate?.deletedAt).toBeDefined();
	});

	it("rejects unsafe merge requests", async () => {
		await seedData({
			accounts: [
				account("survivor", { title: "Cash", currency: "AED" }),
				account("same-title-pkr", { title: "cash~2", currency: "PKR" }),
				account("different-title", { title: "Bank", currency: "AED" }),
				account("deleted-duplicate", { title: "cash~3", currency: "AED", deletedAt: 2_000 }),
			],
		});

		await expect(mergeDuplicateAccounts(USER_ID, "survivor", [])).rejects.toThrow(
			"Choose at least one duplicate account"
		);
		await expect(mergeDuplicateAccounts(USER_ID, "survivor", ["same-title-pkr"])).rejects.toThrow(
			"same currency"
		);
		await expect(mergeDuplicateAccounts(USER_ID, "survivor", ["different-title"])).rejects.toThrow(
			"same title and currency"
		);
		await expect(
			mergeDuplicateAccounts(USER_ID, "survivor", ["deleted-duplicate"])
		).rejects.toThrow("Deleted accounts cannot be merged");
	});
});
