import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db, withoutSyncDirtyTracking } from "@/lib/db/local";
import {
	getResetLocalFinancialDataPreview,
	resetLocalFinancialDataForCurrency,
} from "@/lib/db/reset";
import { CORE_SYNC_TABLES } from "@/lib/db/sync";

import type { Account, Budget, Category, DashboardStats, Transaction } from "@/types";

vi.mock("@/lib/analytics/scheduleRecompute", () => ({
	flushAnalyticsRecompute: vi.fn(),
	recomputeAnalyticsNow: vi.fn(),
	scheduleAnalyticsRecompute: vi.fn(),
}));

const USER_ID = "reset-per-currency-test-user";
const ENABLED_CURRENCIES = ["AED", "PKR"] as const;

function account(id: string, currency: string, patch: Partial<Account> = {}): Account {
	return {
		id,
		userId: USER_ID,
		title: id,
		openingBalance: 100,
		currency,
		isArchived: false,
		updatedAt: 1_000,
		...patch,
	};
}

function category(id: string, currency?: string): Category {
	return {
		id,
		userId: USER_ID,
		title: id,
		type: "Expense",
		updatedAt: 1_000,
		...(currency !== undefined ? { currency } : {}),
	};
}

function budget(id: string, categoryId: string, patch: Partial<Budget> = {}): Budget {
	return {
		id,
		userId: USER_ID,
		categoryId,
		period: "2026-10",
		amount: 100,
		active: true,
		updatedAt: 1_000,
		...patch,
	};
}

function transaction(id: string, accountId: string, patch: Partial<Transaction> = {}): Transaction {
	return {
		id,
		userId: USER_ID,
		type: "Expense",
		date: 1_000,
		amount: 10,
		accountId,
		updatedAt: 1_000,
		...patch,
	};
}

function dashboardStats(): DashboardStats {
	return {
		id: USER_ID,
		updatedAt: 1_000,
		balances: { AED: 100, PKR: 200 },
		perCurrency: {
			ALL: {
				monthIncome: 0,
				monthExpense: 0,
				trend: [],
			},
			AED: {
				monthIncome: 0,
				monthExpense: 0,
				trend: [],
			},
			PKR: {
				monthIncome: 0,
				monthExpense: 0,
				trend: [],
			},
		},
		recent: [],
	};
}

function coreSyncMetaKeys() {
	return [
		"lastSync",
		...CORE_SYNC_TABLES.map((table) => `lastSync:${table}`),
		...CORE_SYNC_TABLES.map((table) => `syncedAtMigration:${table}:v1`),
	];
}

async function clearUserData() {
	await db.accounts.where("userId").equals(USER_ID).delete();
	await db.categories.where("userId").equals(USER_ID).delete();
	await db.budgets.where("userId").equals(USER_ID).delete();
	await db.transactions.where("userId").equals(USER_ID).delete();
	await db.goldItems.where("userId").equals(USER_ID).delete();
	await db.zakatCalculations.where("userId").equals(USER_ID).delete();
	await db.zakatPayments.where("userId").equals(USER_ID).delete();
	await db.dashboardStats.delete(USER_ID);
	await db.dbConfig.delete(USER_ID);
	await db.syncMeta.bulkDelete(coreSyncMetaKeys());
}

async function seedResetFixture() {
	const aedAccount = account("acc-aed", "AED");
	const secondAedAccount = account("acc-aed-2", "AED");
	const pkrAccount = account("acc-pkr", "PKR");
	const blankCurrencyAccount = account("acc-blank", "");
	const nonEnabledAccount = account("acc-usd", "USD");
	const unknownCurrencyAccount = account("acc-unknown", "ZZZ");
	const pkrTransaction = transaction("txn-pkr", pkrAccount.id, { amount: 20 });
	const blankCurrencyTransaction = transaction("txn-blank", blankCurrencyAccount.id, {
		amount: 30,
	});
	const nonEnabledTransaction = transaction("txn-usd", nonEnabledAccount.id, { amount: 40 });
	const unknownCurrencyTransaction = transaction("txn-unknown", unknownCurrencyAccount.id, {
		amount: 50,
	});

	await withoutSyncDirtyTracking(async () => {
		await db.dbConfig.put({
			id: USER_ID,
			currency: "AED",
			enabledCurrencies: [...ENABLED_CURRENCIES],
			firebaseConfig: "{}",
			enabled: true,
			fiscalYearStartMonth: 7,
		});
		await db.accounts.bulkPut([
			aedAccount,
			secondAedAccount,
			pkrAccount,
			blankCurrencyAccount,
			nonEnabledAccount,
			unknownCurrencyAccount,
		]);
		await db.categories.bulkPut([
			category("cat-shared"),
			category("cat-aed", "AED"),
			category("cat-pkr", "PKR"),
		]);
		await db.budgets.bulkPut([
			budget("budget-aed-explicit", "cat-shared", { currency: "AED" }),
			budget("budget-aed-derived", "cat-aed"),
			budget("budget-aed-explicit-on-pkr-category", "cat-pkr", { currency: "AED" }),
			budget("budget-pkr-explicit", "cat-shared", { currency: "PKR" }),
			budget("budget-pkr-derived", "cat-pkr"),
			budget("budget-shared", "cat-shared"),
		]);
		await db.transactions.bulkPut([
			transaction("txn-aed", aedAccount.id, { categoryId: "cat-aed" }),
			pkrTransaction,
			blankCurrencyTransaction,
			nonEnabledTransaction,
			unknownCurrencyTransaction,
			transaction("txn-cross-out", aedAccount.id, {
				type: "Transfer",
				toAccountId: pkrAccount.id,
			}),
			transaction("txn-cross-in", pkrAccount.id, {
				type: "Transfer",
				toAccountId: secondAedAccount.id,
			}),
		]);
		await db.dashboardStats.put(dashboardStats());
		await db.goldItems.put({
			id: "gold-aed",
			userId: USER_ID,
			title: "Ring",
			weight: 10,
			purity: "22k",
			updatedAt: 1_000,
		});
		await db.zakatCalculations.put({
			id: "zakat-calc-aed",
			userId: USER_ID,
			islamicYear: "1447",
			assessmentDate: 1_000,
			nisabStandard: "gold",
			goldPricePerGram: 250,
			referenceCurrency: "AED",
			totalGoldWeightGrams: 10,
			totalGoldValue: 2_500,
			accountBalances: [
				{
					accountId: aedAccount.id,
					accountTitle: aedAccount.title,
					balance: 100,
					currency: "AED",
					exchangeRate: 1,
					zakatable: true,
					accountType: "asset",
				},
			],
			totalZakatable: 2_600,
			nisabThreshold: 20_000,
			zakatObligation: 0,
			isLiable: false,
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		await db.zakatPayments.put({
			id: "zakat-payment-aed",
			userId: USER_ID,
			islamicYear: "1447",
			date: 1_000,
			amount: 50,
			currency: "AED",
			createdAt: 1_000,
			updatedAt: 1_000,
		});
		await db.syncMeta.bulkPut([
			{ id: "lastSync", timestamp: 9_999 },
			...CORE_SYNC_TABLES.map((table) => ({ id: `lastSync:${table}`, timestamp: 9_999 })),
			...CORE_SYNC_TABLES.map((table) => ({
				id: `syncedAtMigration:${table}:v1`,
				timestamp: 1,
			})),
		]);
	});

	return {
		pkrAccount,
		blankCurrencyAccount,
		nonEnabledAccount,
		unknownCurrencyAccount,
		pkrTransaction,
		blankCurrencyTransaction,
		nonEnabledTransaction,
		unknownCurrencyTransaction,
	};
}

beforeEach(async () => {
	vi.clearAllMocks();
	await clearUserData();
});

describe("resetLocalFinancialDataForCurrency", () => {
	it("removes only the target currency data and any transactions that would become orphaned", async () => {
		const kept = await seedResetFixture();
		const preview = await getResetLocalFinancialDataPreview(USER_ID, {
			type: "currency",
			currency: "AED",
			enabledCurrencies: ENABLED_CURRENCIES,
		});

		expect(preview).toMatchObject({
			accountsDeleted: 2,
			categoriesDeleted: 1,
			budgetsDeleted: 3,
			budgetsDeletedByExplicitCurrency: 2,
			budgetsDeletedByCategoryCurrency: 1,
			transactionsDeleted: 3,
			transactionsDeletedCrossCurrencyTransfers: 2,
			sharedCategoriesKept: 1,
			otherCurrencyCategoriesKept: 1,
			accountsKeptBlankCurrency: 1,
			accountsKeptUnknownCurrency: 1,
			accountsKeptNonEnabledCurrency: 1,
			goldItemsKept: 1,
			zakatCalculationsKept: 1,
			zakatPaymentsKept: 1,
		});

		const result = await resetLocalFinancialDataForCurrency(USER_ID, "AED", ENABLED_CURRENCIES);

		expect(result.accountsDeleted).toBe(2);
		expect(result.categoriesDeleted).toBe(1);
		expect(result.budgetsDeleted).toBe(3);
		expect(result.transactionsDeleted).toBe(3);
		expect(await db.accounts.get("acc-aed")).toBeUndefined();
		expect(await db.accounts.get("acc-aed-2")).toBeUndefined();
		expect(await db.categories.get("cat-aed")).toBeUndefined();
		expect(await db.budgets.get("budget-aed-explicit")).toBeUndefined();
		expect(await db.budgets.get("budget-aed-derived")).toBeUndefined();
		expect(await db.budgets.get("budget-aed-explicit-on-pkr-category")).toBeUndefined();
		expect(await db.transactions.get("txn-aed")).toBeUndefined();
		expect(await db.transactions.get("txn-cross-out")).toBeUndefined();
		expect(await db.transactions.get("txn-cross-in")).toBeUndefined();

		expect(await db.accounts.get("acc-pkr")).toEqual(kept.pkrAccount);
		expect(await db.accounts.get("acc-blank")).toEqual(kept.blankCurrencyAccount);
		expect(await db.accounts.get("acc-usd")).toEqual(kept.nonEnabledAccount);
		expect(await db.accounts.get("acc-unknown")).toEqual(kept.unknownCurrencyAccount);
		expect(await db.categories.get("cat-shared")).toMatchObject({ id: "cat-shared" });
		expect(await db.categories.get("cat-pkr")).toMatchObject({ id: "cat-pkr", currency: "PKR" });
		expect(await db.budgets.get("budget-pkr-explicit")).toMatchObject({
			id: "budget-pkr-explicit",
			currency: "PKR",
		});
		expect(await db.budgets.get("budget-pkr-derived")).toMatchObject({
			id: "budget-pkr-derived",
			categoryId: "cat-pkr",
		});
		expect(await db.budgets.get("budget-shared")).toMatchObject({
			id: "budget-shared",
			categoryId: "cat-shared",
		});
		expect(await db.transactions.get("txn-pkr")).toEqual(kept.pkrTransaction);
		expect(await db.transactions.get("txn-blank")).toEqual(kept.blankCurrencyTransaction);
		expect(await db.transactions.get("txn-usd")).toEqual(kept.nonEnabledTransaction);
		expect(await db.transactions.get("txn-unknown")).toEqual(kept.unknownCurrencyTransaction);
		expect(await db.goldItems.where("userId").equals(USER_ID).count()).toBe(1);
		expect(await db.zakatCalculations.where("userId").equals(USER_ID).count()).toBe(1);
		expect(await db.zakatPayments.where("userId").equals(USER_ID).count()).toBe(1);
		expect(await db.dashboardStats.get(USER_ID)).toBeUndefined();
	});

	it("leaves no transaction orphaned after deleting target-currency accounts", async () => {
		await seedResetFixture();

		await resetLocalFinancialDataForCurrency(USER_ID, "AED", ENABLED_CURRENCIES);

		const remainingAccountIds = new Set(
			(await db.accounts.where("userId").equals(USER_ID).toArray()).map((item) => item.id)
		);
		const remainingTransactions = await db.transactions.where("userId").equals(USER_ID).toArray();

		for (const item of remainingTransactions) {
			expect(remainingAccountIds.has(item.accountId)).toBe(true);
			if (item.toAccountId) {
				expect(remainingAccountIds.has(item.toAccountId)).toBe(true);
			}
		}
	});

	it("resets pull cursors without creating tombstones or dirty records to push", async () => {
		await seedResetFixture();

		await resetLocalFinancialDataForCurrency(USER_ID, "AED", ENABLED_CURRENCIES);

		expect((await db.syncMeta.get("lastSync"))?.timestamp).toBe(0);
		for (const table of CORE_SYNC_TABLES) {
			expect((await db.syncMeta.get(`lastSync:${table}`))?.timestamp).toBe(0);
			expect(await db.syncMeta.get(`syncedAtMigration:${table}:v1`)).toBeUndefined();
		}

		const remainingRecords = [
			...(await db.accounts.where("userId").equals(USER_ID).toArray()),
			...(await db.categories.where("userId").equals(USER_ID).toArray()),
			...(await db.budgets.where("userId").equals(USER_ID).toArray()),
			...(await db.transactions.where("userId").equals(USER_ID).toArray()),
		];

		expect(
			remainingRecords.some(
				(record) =>
					(record as { deletedAt?: number; pendingSync?: boolean }).deletedAt !== undefined ||
					(record as { deletedAt?: number; pendingSync?: boolean }).pendingSync === true
			)
		).toBe(false);
	});

	it("refuses to reset a currency that is not enabled", async () => {
		const kept = await seedResetFixture();

		await expect(
			resetLocalFinancialDataForCurrency(USER_ID, "USD", ENABLED_CURRENCIES)
		).rejects.toThrow("USD is not enabled");

		expect(await db.accounts.get("acc-usd")).toEqual(kept.nonEnabledAccount);
		expect(await db.transactions.get("txn-usd")).toEqual(kept.nonEnabledTransaction);
	});
});
