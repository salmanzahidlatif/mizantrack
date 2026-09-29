import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	getCategoryCurrencyBackfillMetaKey,
	resetAutoAssignedCategoryCurrencies,
	runCategoryCurrencyBackfill,
} from "@/lib/db/categoryCurrencyBackfill";
import { db, withoutSyncDirtyTracking } from "@/lib/db/local";

import type { Account, Category, Transaction } from "@/types";

const USER_ID = "category-currency-backfill-test-user";

function account(id: string, currency: string, patch: Partial<Account> = {}): Account {
	return {
		id,
		userId: USER_ID,
		title: id,
		openingBalance: 0,
		currency,
		isArchived: false,
		updatedAt: 1_000,
		...patch,
	};
}

function category(id: string, patch: Partial<Category> = {}): Category {
	return {
		id,
		userId: USER_ID,
		title: id,
		type: "Expense",
		updatedAt: 1_000,
		...patch,
	};
}

function transaction(
	id: string,
	accountId: string,
	categoryId: string,
	patch: Partial<Transaction> = {}
) {
	return {
		id,
		userId: USER_ID,
		type: "Expense",
		date: 1_000,
		amount: 10,
		accountId,
		categoryId,
		updatedAt: 1_000,
		...patch,
	} satisfies Transaction;
}

function pendingSync(record: Category | undefined) {
	return (record as (Category & { pendingSync?: boolean }) | undefined)?.pendingSync;
}

async function resetUserData() {
	await db.transactions.where("userId").equals(USER_ID).delete();
	await db.accounts.where("userId").equals(USER_ID).delete();
	await db.categories.where("userId").equals(USER_ID).delete();
	await db.categoryCurrencyBackfillDecisions.where("userId").equals(USER_ID).delete();
	await db.syncMeta.delete(getCategoryCurrencyBackfillMetaKey(USER_ID));
}

async function seedData(input: {
	accounts?: Account[];
	categories?: Category[];
	transactions?: Transaction[];
}) {
	await withoutSyncDirtyTracking(async () => {
		if (input.accounts?.length) await db.accounts.bulkPut(input.accounts);
		if (input.categories?.length) await db.categories.bulkPut(input.categories);
		if (input.transactions?.length) await db.transactions.bulkPut(input.transactions);
	});
}

beforeEach(async () => {
	await resetUserData();
});

describe("category currency backfill", () => {
	it("tags an untagged category used by exactly one active account currency and marks it for sync", async () => {
		await seedData({
			accounts: [account("acc-pkr", "PKR")],
			categories: [category("cat-food")],
			transactions: [transaction("txn-1", "acc-pkr", "cat-food")],
		});

		const result = await runCategoryCurrencyBackfill(USER_ID);
		const updated = await db.categories.get("cat-food");

		expect(result.tagged).toBe(1);
		expect(updated).toMatchObject({
			currency: "PKR",
			pendingSync: true,
		});
		expect(updated?.updatedAt).toBeGreaterThan(1_000);
	});

	it("keeps a multi-currency category shared and records the deliberate skip", async () => {
		await seedData({
			accounts: [account("acc-pkr", "PKR"), account("acc-aed", "AED")],
			categories: [category("cat-food")],
			transactions: [
				transaction("txn-pkr", "acc-pkr", "cat-food"),
				transaction("txn-aed", "acc-aed", "cat-food"),
			],
		});

		const result = await runCategoryCurrencyBackfill(USER_ID);
		const updated = await db.categories.get("cat-food");
		const decision = await db.categoryCurrencyBackfillDecisions.get(`v1:${USER_ID}:cat-food`);

		expect(result.tagged).toBe(0);
		expect(result.skippedMultiCurrency).toBe(1);
		expect(updated?.currency).toBeUndefined();
		expect(pendingSync(updated)).toBeUndefined();
		expect(decision).toMatchObject({
			action: "skipped-multi-currency",
			currencies: ["AED", "PKR"],
		});
	});

	it("leaves unused categories untagged", async () => {
		await seedData({
			accounts: [account("acc-pkr", "PKR")],
			categories: [category("cat-unused")],
			transactions: [],
		});

		const result = await runCategoryCurrencyBackfill(USER_ID);
		const updated = await db.categories.get("cat-unused");

		expect(result.skippedUnused).toBe(1);
		expect(updated?.currency).toBeUndefined();
		expect(pendingSync(updated)).toBeUndefined();
	});

	it("never overwrites an explicitly set category currency", async () => {
		await seedData({
			accounts: [account("acc-pkr", "PKR")],
			categories: [category("cat-explicit", { currency: "AED" })],
			transactions: [transaction("txn-1", "acc-pkr", "cat-explicit")],
		});

		const result = await runCategoryCurrencyBackfill(USER_ID);
		const updated = await db.categories.get("cat-explicit");

		expect(result.skippedExplicitCurrency).toBe(1);
		expect(updated).toMatchObject({
			currency: "AED",
			updatedAt: 1_000,
		});
		expect(pendingSync(updated)).toBeUndefined();
	});

	it("ignores soft-deleted transactions, accounts, and categories", async () => {
		await seedData({
			accounts: [
				account("acc-pkr", "PKR"),
				account("acc-aed-deleted", "AED", { deletedAt: 2_000 }),
				account("acc-aed", "AED"),
			],
			categories: [category("cat-food"), category("cat-deleted", { deletedAt: 2_000 })],
			transactions: [
				transaction("txn-active", "acc-pkr", "cat-food"),
				transaction("txn-deleted-account", "acc-aed-deleted", "cat-food"),
				transaction("txn-deleted", "acc-aed", "cat-food", { deletedAt: 2_000 }),
				transaction("txn-deleted-category", "acc-pkr", "cat-deleted"),
			],
		});

		const result = await runCategoryCurrencyBackfill(USER_ID);
		const active = await db.categories.get("cat-food");
		const deleted = await db.categories.get("cat-deleted");
		const deletedDecision = await db.categoryCurrencyBackfillDecisions.get(
			`v1:${USER_ID}:cat-deleted`
		);

		expect(result.tagged).toBe(1);
		expect(active?.currency).toBe("PKR");
		expect(deleted?.currency).toBeUndefined();
		expect(deletedDecision).toBeUndefined();
	});

	it("counts both source and destination accounts for transfer categories", async () => {
		await seedData({
			accounts: [account("acc-pkr", "PKR"), account("acc-aed", "AED")],
			categories: [category("cat-transfer")],
			transactions: [
				transaction("txn-transfer", "acc-pkr", "cat-transfer", {
					type: "Transfer",
					toAccountId: "acc-aed",
				}),
			],
		});

		const result = await runCategoryCurrencyBackfill(USER_ID);
		const updated = await db.categories.get("cat-transfer");

		expect(result.skippedMultiCurrency).toBe(1);
		expect(updated?.currency).toBeUndefined();
	});

	it("keeps parent and child category trees coherent", async () => {
		await seedData({
			accounts: [account("acc-aed", "AED"), account("acc-pkr", "PKR")],
			categories: [
				category("cat-parent"),
				category("cat-child", { parentId: "cat-parent" }),
				category("cat-child-pkr", { parentId: "cat-parent" }),
			],
			transactions: [
				transaction("txn-parent", "acc-aed", "cat-parent"),
				transaction("txn-child", "acc-aed", "cat-child"),
				transaction("txn-child-pkr", "acc-pkr", "cat-child-pkr"),
			],
		});

		const result = await runCategoryCurrencyBackfill(USER_ID);
		const parent = await db.categories.get("cat-parent");
		const childAed = await db.categories.get("cat-child");
		const childPkr = await db.categories.get("cat-child-pkr");

		expect(result.skippedTreeConflict).toBe(1);
		expect(parent?.currency).toBeUndefined();
		expect(childAed?.currency).toBe("AED");
		expect(childPkr?.currency).toBe("PKR");
	});

	it("is idempotent and performs no category writes after completion", async () => {
		await seedData({
			accounts: [account("acc-pkr", "PKR")],
			categories: [category("cat-food")],
			transactions: [transaction("txn-1", "acc-pkr", "cat-food")],
		});

		await runCategoryCurrencyBackfill(USER_ID);
		const afterFirstRun = await db.categories.get("cat-food");
		const updateSpy = vi.spyOn(db.categories, "update");

		const secondResult = await runCategoryCurrencyBackfill(USER_ID);
		const afterSecondRun = await db.categories.get("cat-food");

		expect(secondResult.alreadyCompleted).toBe(true);
		expect(updateSpy).not.toHaveBeenCalled();
		expect(afterSecondRun).toEqual(afterFirstRun);

		updateSpy.mockRestore();
	});

	it("can reset unchanged auto-assigned tags without touching manually changed categories", async () => {
		await seedData({
			accounts: [account("acc-pkr", "PKR"), account("acc-aed", "AED")],
			categories: [category("cat-food"), category("cat-rent")],
			transactions: [
				transaction("txn-food", "acc-pkr", "cat-food"),
				transaction("txn-rent", "acc-aed", "cat-rent"),
			],
		});

		await runCategoryCurrencyBackfill(USER_ID);
		await withoutSyncDirtyTracking(async () => {
			await db.categories.update("cat-rent", { currency: "USD", updatedAt: 99_000 });
		});

		const reset = await resetAutoAssignedCategoryCurrencies(USER_ID);
		const food = await db.categories.get("cat-food");
		const rent = await db.categories.get("cat-rent");

		expect(reset).toEqual({ reset: 1, skipped: 1 });
		expect(food?.currency).toBeUndefined();
		expect(pendingSync(food)).toBe(true);
		expect(rent?.currency).toBe("USD");
	});
});
