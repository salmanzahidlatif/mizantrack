import Dexie from "dexie";
import { IDBFactory } from "fake-indexeddb";
import initSqlJs from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { db, withoutSyncDirtyTracking } from "@/lib/db/local";
import { buildHysabKytabSqliteExport } from "@/lib/export/hysabKytabSqlite";

import type { Account, Budget, Category, Transaction } from "@/types";
import type initSqlJsType from "sql.js";

type Database = initSqlJsType.Database;
type SqlValue = initSqlJsType.SqlValue;

Dexie.dependencies.indexedDB = new IDBFactory();

const USER_ID = "hysab-kytab-sqlite-export-user";
const RANGE = {
	from: new Date(2026, 9, 1),
	to: new Date(2026, 9, 31, 23, 59, 59, 999),
};

interface Row {
	[key: string]: SqlValue;
}

function account(id: string, title: string, currency: string, openingBalance: number): Account {
	return {
		id,
		userId: USER_ID,
		title,
		openingBalance,
		currency,
		isArchived: false,
		updatedAt: 1_000,
	};
}

function category(id: string, title: string, type: Category["type"], currency?: string): Category {
	return {
		id,
		userId: USER_ID,
		title,
		type,
		updatedAt: 1_000,
		...(currency ? { currency } : {}),
	};
}

function transaction(id: string, patch: Partial<Transaction>): Transaction {
	return {
		id,
		userId: USER_ID,
		type: "Expense",
		date: new Date(2026, 9, 10).getTime(),
		amount: 1,
		accountId: "cash-aed",
		updatedAt: 1_000,
		...patch,
	};
}

function budget(id: string, categoryId: string, patch: Partial<Budget> = {}): Budget {
	return {
		id,
		userId: USER_ID,
		categoryId,
		period: "2026-10",
		amount: 300,
		active: true,
		updatedAt: 1_000,
		...patch,
	};
}

async function loadSqlite(bytes: Uint8Array): Promise<Database> {
	const SQL = await initSqlJs({
		locateFile: (file) => `${process.cwd()}/node_modules/sql.js/dist/${file}`,
	});
	return new SQL.Database(bytes);
}

function rows(database: Database, sql: string): Row[] {
	const result = database.exec(sql)[0];
	if (!result) return [];

	return result.values.map((values) =>
		Object.fromEntries(result.columns.map((column, index) => [column, values[index] ?? null]))
	);
}

async function seedExportFixture() {
	await withoutSyncDirtyTracking(async () => {
		await db.accounts.bulkPut([
			account("cash-aed", "Cash AED", "AED", 1_000),
			account("bank-aed", "Bank AED", "AED", 500),
			account("wallet-pkr", "Wallet PKR", "PKR", 10_000),
		]);
		await db.categories.bulkPut([
			category("salary", "Salary", "Income"),
			category("groceries-aed", "Groceries", "Expense", "AED"),
			category("groceries-pkr", "Groceries PKR", "Expense", "PKR"),
		]);
		await db.budgets.bulkPut([
			budget("budget-aed-explicit", "salary", { currency: "AED", amount: 1_000 }),
			budget("budget-aed-derived", "groceries-aed", { amount: 300 }),
			budget("budget-pkr-derived", "groceries-pkr", { amount: 9_999 }),
		]);
		await db.transactions.bulkPut([
			transaction("income-aed", {
				type: "Income",
				amount: 2_000,
				categoryId: "salary",
				description: "Salary",
			}),
			transaction("expense-aed", {
				type: "Expense",
				amount: 125,
				categoryId: "groceries-aed",
				description: "Groceries",
			}),
			transaction("transfer-aed", {
				type: "Transfer",
				amount: 200,
				accountId: "cash-aed",
				toAccountId: "bank-aed",
				description: "Move to bank",
			}),
			transaction("cross-currency-transfer", {
				type: "Transfer",
				amount: 50,
				accountId: "cash-aed",
				toAccountId: "wallet-pkr",
				description: "Cross-currency transfer",
			}),
		]);
	});
}

beforeEach(async () => {
	await db.delete();
	await db.open();
});

describe("Hysab Kytab SQLite export", () => {
	it("creates a valid SQLite file with the expected Hysab Kytab tables", async () => {
		await seedExportFixture();

		const exported = await buildHysabKytabSqliteExport(USER_ID, RANGE, {
			currency: "AED",
			includeArchivedAccounts: true,
		});
		const sqlite = await loadSqlite(exported.bytes);

		try {
			const tableNames = rows(
				sqlite,
				"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
			).map((row) => row.name);

			expect(tableNames).toEqual(
				expect.arrayContaining([
					"HKBACCOUNT",
					"HKBCATEGORY",
					"HKBVOUCHER",
					"HKBBUDGET",
					"HKACTIVITY",
					"HKBEVENT",
					"HKBGOAL",
					"HKBGOALTRX",
					"HKBNOTIFICATIONS",
					"HKBPARTY",
					"HKBREMINDER",
					"COREAREA",
					"CORECITY",
					"CORECOUNTRY",
					"android_metadata",
				])
			);
			expect(rows(sqlite, "PRAGMA table_info(HKBVOUCHER)").map((row) => row.name)).toEqual(
				expect.arrayContaining(["REFNO", "CATEGRORYNAME", "VCHDAY", "MONTH", "VCHYEAR"])
			);
			expect(
				rows(sqlite, "SELECT DISTINCT ACCOUNTCURRENCY FROM HKBACCOUNT").map(
					(row) => row.ACCOUNTCURRENCY
				)
			).toEqual(expect.arrayContaining(["AED", "PKR"]));
			expect(exported.summary).toMatchObject({
				currency: "AED",
				accounts: 3,
				transactions: 4,
				voucherRows: 6,
				transferPairs: 2,
				budgets: 2,
			});
		} finally {
			sqlite.close();
		}
	});

	it("exports transfers as mutually-referencing REFNO pairs with opposite signs", async () => {
		await seedExportFixture();

		const exported = await buildHysabKytabSqliteExport(USER_ID, RANGE, {
			currency: "AED",
			includeArchivedAccounts: true,
		});
		const sqlite = await loadSqlite(exported.bytes);

		try {
			const transferRows = rows(
				sqlite,
				"SELECT ID, REFNO, VCHAMOUNT FROM HKBVOUCHER WHERE VCHTYPE = 'Transfer'"
			);
			const byId = new Map(transferRows.map((row) => [Number(row.ID), row]));

			expect(transferRows).toHaveLength(4);
			for (const row of transferRows) {
				const counterpart = byId.get(Number(row.REFNO));
				expect(counterpart).toBeDefined();
				expect(String(counterpart?.REFNO)).toBe(String(row.ID));
				expect(Number(counterpart?.VCHAMOUNT)).toBeCloseTo(-Number(row.VCHAMOUNT), 2);
			}
		} finally {
			sqlite.close();
		}
	});

	it("round-trips through the SQLite rows without changing per-account balances", async () => {
		await seedExportFixture();

		const exported = await buildHysabKytabSqliteExport(USER_ID, RANGE, {
			currency: "AED",
			includeArchivedAccounts: true,
		});
		const sqlite = await loadSqlite(exported.bytes);

		try {
			const exportedAccounts = rows(sqlite, "SELECT ID, TITLE, OPENINGBALANCE FROM HKBACCOUNT");
			const exportedVouchers = rows(sqlite, "SELECT ACCOUNTID, VCHAMOUNT FROM HKBVOUCHER");
			const actualBalances = new Map(
				exportedAccounts.map((row) => [String(row.TITLE), Number(row.OPENINGBALANCE)])
			);

			for (const voucher of exportedVouchers) {
				const account = exportedAccounts.find(
					(row) => Number(row.ID) === Number(voucher.ACCOUNTID)
				);
				expect(account).toBeDefined();
				const title = String(account?.TITLE);
				actualBalances.set(title, (actualBalances.get(title) ?? 0) + Number(voucher.VCHAMOUNT));
			}

			expect(actualBalances.get("Cash AED")).toBeCloseTo(2_625, 2);
			expect(actualBalances.get("Bank AED")).toBeCloseTo(700, 2);
			expect(actualBalances.get("Wallet PKR")).toBeCloseTo(10_050, 2);
			expect([...actualBalances.values()].reduce((sum, amount) => sum + amount, 0)).toBeCloseTo(
				13_375,
				2
			);
		} finally {
			sqlite.close();
		}
	});
});
