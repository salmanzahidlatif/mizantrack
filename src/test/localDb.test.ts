import Dexie from "dexie";
import { describe, expect, it, vi } from "vitest";

import { db, MizanTrackDB } from "@/lib/db/local";

describe("local Dexie database events", () => {
	it("versionchange handler leaves the database reopenable", async () => {
		await db.open();
		await db.accounts.count();

		const closeSpy = vi.spyOn(db, "close");
		try {
			db.on("versionchange").fire({
				oldVersion: 30,
				newVersion: 40,
			} as IDBVersionChangeEvent);

			expect(closeSpy).toHaveBeenCalled();
			expect(closeSpy.mock.calls.every(([options]) => options?.disableAutoOpen === false)).toBe(
				true
			);
			await expect(db.accounts.count()).resolves.toEqual(expect.any(Number));
		} finally {
			closeSpy.mockRestore();
		}
	});

	it("opens a version 7 database at the current version without data loss", async () => {
		const databaseName = "mizantrack-v7-upgrade-test";
		await Dexie.delete(databaseName);

		const legacyDb = new Dexie(databaseName);
		legacyDb.version(7).stores({
			accounts: "id, userId, isArchived, accountType, updatedAt, deletedAt, pendingSync",
			categories: "id, userId, type, currency, updatedAt, deletedAt, pendingSync",
			transactions:
				"id, userId, [userId+date], type, date, accountId, categoryId, toAccountId, updatedAt, deletedAt, pendingSync",
			dbConfig: "id",
			syncMeta: "id",
			categoryCurrencyBackfillDecisions: "id, userId, categoryId, action, assignedAt",
			dashboardStats: "id, updatedAt",
			goldItems: "id, userId, purity, updatedAt, deletedAt",
			zakatCalculations: "id, userId, islamicYear, assessmentDate, updatedAt, deletedAt",
			zakatPayments: "id, userId, islamicYear, date, calculationId, updatedAt, deletedAt",
		});

		await legacyDb.open();
		await legacyDb.table("accounts").put({
			id: "acc-v7",
			userId: "user-v7",
			title: "Legacy Cash",
			openingBalance: 123,
			currency: "PKR",
			isArchived: false,
			updatedAt: 7_000,
		});
		await legacyDb.table("transactions").put({
			id: "txn-v7",
			userId: "user-v7",
			type: "Income",
			date: 7_000,
			amount: 123,
			accountId: "acc-v7",
			updatedAt: 7_000,
		});
		legacyDb.close();

		const upgradedDb = new MizanTrackDB(databaseName);
		try {
			await upgradedDb.open();

			expect(upgradedDb.verno).toBe(9);
			expect(await upgradedDb.accounts.get("acc-v7")).toMatchObject({
				title: "Legacy Cash",
				openingBalance: 123,
			});
			expect(await upgradedDb.transactions.get("txn-v7")).toMatchObject({
				amount: 123,
			});
			expect(await upgradedDb.budgets.count()).toBe(0);
		} finally {
			upgradedDb.close();
			await Dexie.delete(databaseName);
		}
	});

	it("drops category currency backfill decisions when upgrading from version 8 without data loss", async () => {
		const databaseName = "mizantrack-v8-drop-backfill-decisions-test";
		await Dexie.delete(databaseName);

		const legacyDb = new Dexie(databaseName);
		legacyDb.version(8).stores({
			accounts: "id, userId, isArchived, accountType, sourceId, updatedAt, deletedAt, pendingSync",
			categories: "id, userId, type, currency, sourceId, updatedAt, deletedAt, pendingSync",
			transactions:
				"id, userId, [userId+date], type, date, accountId, categoryId, toAccountId, sourceId, updatedAt, deletedAt, pendingSync",
			budgets:
				"id, userId, categoryId, period, [userId+period], [categoryId+period], sourceId, updatedAt, deletedAt, pendingSync",
			dbConfig: "id",
			syncMeta: "id",
			categoryCurrencyBackfillDecisions: "id, userId, categoryId, action, assignedAt",
			dashboardStats: "id, updatedAt",
			goldItems: "id, userId, purity, updatedAt, deletedAt",
			zakatCalculations: "id, userId, islamicYear, assessmentDate, updatedAt, deletedAt",
			zakatPayments: "id, userId, islamicYear, date, calculationId, updatedAt, deletedAt",
		});

		await legacyDb.open();
		await legacyDb.table("accounts").put({
			id: "acc-v8",
			userId: "user-v8",
			title: "V8 Cash",
			openingBalance: 500,
			currency: "AED",
			isArchived: false,
			sourceId: "hk:AED:account:cash",
			updatedAt: 8_000,
		});
		await legacyDb.table("categories").put({
			id: "cat-v8",
			userId: "user-v8",
			title: "Food",
			type: "Expense",
			currency: "AED",
			sourceId: "hk:AED:category:food",
			updatedAt: 8_000,
		});
		await legacyDb.table("transactions").put({
			id: "txn-v8",
			userId: "user-v8",
			type: "Expense",
			date: 8_000,
			amount: 50,
			accountId: "acc-v8",
			categoryId: "cat-v8",
			sourceId: "hk:AED:transaction:txn",
			updatedAt: 8_000,
		});
		await legacyDb.table("budgets").put({
			id: "budget-v8",
			userId: "user-v8",
			categoryId: "cat-v8",
			period: "2026-10",
			amount: 250,
			currency: "AED",
			active: true,
			sourceId: "hk:AED:budget:food",
			updatedAt: 8_000,
		});
		await legacyDb.table("categoryCurrencyBackfillDecisions").put({
			id: "decision-v8",
			userId: "user-v8",
			categoryId: "cat-v8",
			categoryTitle: "Food",
			action: "tagged",
			currencies: ["AED"],
			assignedCurrency: "AED",
			assignedAt: 8_000,
			version: 1,
		});
		legacyDb.close();

		const upgradedDb = new MizanTrackDB(databaseName);
		try {
			await upgradedDb.open();

			expect(upgradedDb.verno).toBe(9);
			expect(upgradedDb.tables.map((table) => table.name)).not.toContain(
				"categoryCurrencyBackfillDecisions"
			);
			expect(await upgradedDb.accounts.get("acc-v8")).toMatchObject({
				title: "V8 Cash",
				sourceId: "hk:AED:account:cash",
			});
			expect(await upgradedDb.categories.get("cat-v8")).toMatchObject({
				title: "Food",
				currency: "AED",
				sourceId: "hk:AED:category:food",
			});
			expect(await upgradedDb.transactions.get("txn-v8")).toMatchObject({
				amount: 50,
				categoryId: "cat-v8",
				sourceId: "hk:AED:transaction:txn",
			});
			expect(await upgradedDb.budgets.get("budget-v8")).toMatchObject({
				amount: 250,
				period: "2026-10",
				sourceId: "hk:AED:budget:food",
			});
		} finally {
			upgradedDb.close();
			await Dexie.delete(databaseName);
		}
	});
});
