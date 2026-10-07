import Dexie from "dexie";
import { describe, expect, it, vi } from "vitest";

import {
	LEGACY_ZAKAT_CURRENCY,
	ZAKAT_CURRENCY_BACKFILL_META_ID,
	db,
	MizanTrackDB,
} from "@/lib/db/local";

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

			expect(upgradedDb.verno).toBe(10);
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

			expect(upgradedDb.verno).toBe(10);
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

	it("upgrades version 9 zakat tables by assigning legacy PKR currency without data loss", async () => {
		const databaseName = "mizantrack-v9-zakat-currency-upgrade-test";
		await Dexie.delete(databaseName);

		const legacyDb = new Dexie(databaseName);
		legacyDb.version(9).stores({
			accounts: "id, userId, isArchived, accountType, sourceId, updatedAt, deletedAt, pendingSync",
			categories: "id, userId, type, currency, sourceId, updatedAt, deletedAt, pendingSync",
			transactions:
				"id, userId, [userId+date], type, date, accountId, categoryId, toAccountId, sourceId, updatedAt, deletedAt, pendingSync",
			budgets:
				"id, userId, categoryId, period, [userId+period], [categoryId+period], sourceId, updatedAt, deletedAt, pendingSync",
			dbConfig: "id",
			syncMeta: "id",
			categoryCurrencyBackfillDecisions: null,
			dashboardStats: "id, updatedAt",
			goldItems: "id, userId, purity, updatedAt, deletedAt",
			zakatCalculations: "id, userId, islamicYear, assessmentDate, updatedAt, deletedAt",
			zakatPayments: "id, userId, islamicYear, date, calculationId, updatedAt, deletedAt",
		});

		await legacyDb.open();
		await legacyDb.table("goldItems").bulkPut([
			{
				id: "gold-legacy",
				userId: "user-zakat-v9",
				title: "Legacy Ring",
				weight: 10,
				purity: "22k",
				updatedAt: 9_000,
			},
			{
				id: "gold-aed",
				userId: "user-zakat-v9",
				currency: "AED",
				title: "AED Ring",
				weight: 5,
				purity: "24k",
				updatedAt: 9_100,
			},
		]);
		await legacyDb.table("zakatCalculations").put({
			id: "calc-legacy",
			userId: "user-zakat-v9",
			islamicYear: "1447",
			assessmentDate: 9_000,
			nisabStandard: "gold",
			goldPricePerGram: 250,
			referenceCurrency: "PKR",
			totalGoldWeightGrams: 10,
			totalGoldValue: 2_500,
			accountBalances: [],
			totalZakatable: 2_500,
			nisabThreshold: 20_000,
			zakatObligation: 0,
			isLiable: false,
			createdAt: 9_000,
			updatedAt: 9_000,
		});
		await legacyDb.table("zakatPayments").put({
			id: "payment-legacy",
			userId: "user-zakat-v9",
			islamicYear: "1447",
			date: 9_000,
			amount: 100,
			createdAt: 9_000,
			updatedAt: 9_000,
		});
		legacyDb.close();

		const upgradedDb = new MizanTrackDB(databaseName);
		try {
			await upgradedDb.open();

			expect(upgradedDb.verno).toBe(10);
			expect(await upgradedDb.goldItems.get("gold-legacy")).toMatchObject({
				title: "Legacy Ring",
				currency: LEGACY_ZAKAT_CURRENCY,
				pendingSync: true,
			});
			expect(await upgradedDb.goldItems.get("gold-aed")).toMatchObject({
				title: "AED Ring",
				currency: "AED",
			});
			expect(await upgradedDb.zakatCalculations.get("calc-legacy")).toMatchObject({
				totalZakatable: 2_500,
				currency: LEGACY_ZAKAT_CURRENCY,
				pendingSync: true,
			});
			expect(await upgradedDb.zakatPayments.get("payment-legacy")).toMatchObject({
				amount: 100,
				currency: LEGACY_ZAKAT_CURRENCY,
				pendingSync: true,
			});
			expect(await upgradedDb.syncMeta.get(ZAKAT_CURRENCY_BACKFILL_META_ID)).toBeTruthy();

			await upgradedDb.goldItems.update("gold-legacy", { currency: undefined });
			upgradedDb.close();

			const reopenedDb = new MizanTrackDB(databaseName);
			try {
				await reopenedDb.open();
				expect((await reopenedDb.goldItems.get("gold-legacy"))?.currency).toBeUndefined();
				expect(await reopenedDb.syncMeta.get(ZAKAT_CURRENCY_BACKFILL_META_ID)).toBeTruthy();
			} finally {
				reopenedDb.close();
			}
		} finally {
			upgradedDb.close();
			await Dexie.delete(databaseName);
		}
	});
});
