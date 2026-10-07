import fs from "fs";
import path from "path";

import "fake-indexeddb/auto";
import ts from "typescript";
import { beforeEach, describe, expect, it } from "vitest";

import { db, withoutSyncDirtyTracking } from "@/lib/db/local";
import {
	buildMizanTrackBackupWorkbookBytes,
	decodeMizanTrackBackupWorkbook,
	MIZAN_TRACK_BACKUP_SHEETS,
	SECURITY_EXCLUDED_DB_CONFIG_FIELDS,
} from "@/lib/export";
import {
	commitHysabKytabSqliteImport,
	prepareHysabKytabSqliteImport,
} from "@/lib/import/hysabKytabSqlite";

import type {
	Account,
	Budget,
	Category,
	DashboardStats,
	DbConfig,
	GoldItem,
	SyncMeta,
	Transaction,
	ZakatCalculation,
	ZakatPayment,
} from "@/types";

const USER_ID = "mizantrack-excel-export-user";
const REAL_BACKUP_USER_ID = "mizantrack-excel-real-backup-user";
const REAL_BACKUP_PATH = path.join(process.cwd(), "docs", "HK Backup - PKR.db");

type BackupEntity =
	| "Account"
	| "Category"
	| "Transaction"
	| "Budget"
	| "GoldItem"
	| "ZakatCalculation"
	| "ZakatPayment"
	| "DbConfig"
	| "SyncMeta"
	| "DashboardStats";

type BackupRecord =
	| Account
	| Category
	| Transaction
	| Budget
	| GoldItem
	| ZakatCalculation
	| ZakatPayment
	| Partial<DbConfig>
	| SyncMeta
	| DashboardStats;

const TYPE_FILE = path.join(process.cwd(), "src", "types", "index.ts");

function interfaceFields(interfaceName: string): string[] {
	const source = ts.createSourceFile(
		TYPE_FILE,
		fs.readFileSync(TYPE_FILE, "utf8"),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS
	);
	const declaration = source.statements.find(
		(statement): statement is ts.InterfaceDeclaration =>
			ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName
	);
	if (!declaration) throw new Error(`Interface ${interfaceName} not found.`);

	return declaration.members.filter(ts.isPropertySignature).map((member) => {
		const name = member.name;
		if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
			return name.text;
		}
		throw new Error(`Unsupported property name in ${interfaceName}.`);
	});
}

function sheetFor(entity: BackupEntity) {
	const sheet = MIZAN_TRACK_BACKUP_SHEETS.find((definition) => definition.entity === entity);
	if (!sheet) throw new Error(`Missing backup sheet for ${entity}.`);
	return sheet;
}

function sortById<T extends { id?: string }>(records: T[]): T[] {
	return [...records].sort((left, right) => String(left.id).localeCompare(String(right.id)));
}

function pickColumns<T extends BackupRecord>(record: T, columns: readonly string[]) {
	const output: Record<string, unknown> = {};
	for (const column of columns) {
		const value = (record as Record<string, unknown>)[column];
		if (value !== undefined) output[column] = value;
	}
	return output;
}

async function expectedRows<T extends BackupRecord>(
	entity: BackupEntity,
	records: Promise<T[]>
): Promise<Record<string, unknown>[]> {
	const columns = sheetFor(entity).columns;
	return sortById(await records).map((record) => pickColumns(record, columns));
}

async function seedFullFidelityFixture() {
	await withoutSyncDirtyTracking(async () => {
		await db.dbConfig.put({
			id: USER_ID,
			firebaseConfig: '{"apiKey":"secret"}',
			enabled: true,
			currency: "PKR",
			fiscalYearStartMonth: 7,
			goldApiKey: "gold-secret",
			lastGoldPricePerGram: 27_500,
			lastGoldPriceFetchedAt: 1_234_567,
			pinHash: "pin-secret",
			appLockEnabled: true,
			biometricEnabled: true,
			biometricCredentialId: "device-secret",
			enabledCurrencies: ["PKR", "AED"],
		});
		await db.accounts.bulkPut([
			{
				id: "acc-aed",
				userId: USER_ID,
				title: "Cash AED",
				openingBalance: 100,
				currency: " aed ",
				color: "#fff",
				icon: "wallet",
				isArchived: true,
				accountType: "liability",
				sourceId: "hk:AED:account:1",
				updatedAt: 10,
				deletedAt: 20,
			},
		]);
		await db.categories.bulkPut([
			{
				id: "cat-parent",
				userId: USER_ID,
				title: "Food",
				type: "Expense",
				currency: "AED",
				icon: "utensils",
				color: "#123456",
				sourceId: "hk:AED:category:1",
				updatedAt: 11,
			},
			{
				id: "cat-child",
				userId: USER_ID,
				title: "Restaurants",
				type: "Expense",
				parentId: "cat-parent",
				updatedAt: 12,
				deletedAt: 22,
			},
		]);
		await db.transactions.bulkPut([
			{
				id: "txn-rich",
				userId: USER_ID,
				type: "Expense",
				date: 1_000,
				amount: 25,
				description: "Dinner",
				categoryId: "cat-child",
				accountId: "acc-aed",
				toAccountId: "acc-aed",
				tags: ["travel,food", "family"],
				place: "Dubai",
				travelCurrency: {
					symbol: "€",
					rate: 4.1,
					amount: 6.1,
					location: "Berlin",
				},
				sourceId: "hk:AED:voucher:1",
				updatedAt: 13,
				deletedAt: 23,
			},
		]);
		await db.budgets.bulkPut([
			{
				id: "budget-food",
				userId: USER_ID,
				categoryId: "cat-child",
				period: "2026-10",
				amount: 500,
				currency: "AED",
				active: false,
				sourceId: "hk:AED:budget:1",
				updatedAt: 14,
				deletedAt: 24,
			},
		]);
		await db.goldItems.bulkPut([
			{
				id: "gold-ring",
				userId: USER_ID,
				currency: "AED",
				title: "Ring",
				weight: 5,
				purity: "24k",
				purchaseDate: 2_000,
				purchasePrice: 1_000,
				notes: "Gift",
				updatedAt: 15,
				deletedAt: 25,
			},
		]);
		await db.zakatCalculations.bulkPut([
			{
				id: "calc-1",
				userId: USER_ID,
				currency: "AED",
				islamicYear: "1447",
				assessmentDate: 3_000,
				nisabStandard: "gold",
				goldPricePerGram: 250,
				silverPricePerGram: 3,
				referenceCurrency: "AED",
				totalGoldWeightGrams: 5,
				totalGoldValue: 1_250,
				accountBalances: [
					{
						accountId: "acc-aed",
						accountTitle: "Cash AED",
						balance: 100,
						currency: "AED",
						exchangeRate: 1,
						zakatable: true,
						accountType: "liability",
					},
				],
				totalZakatable: 1_350,
				nisabThreshold: 10_000,
				zakatObligation: 0,
				isLiable: false,
				monthlyBalances: [
					{
						month: "Ramaḍān 1447",
						gregorianDate: "2026-02-18",
						totalWealth: 1_350,
					},
				],
				createdAt: 16,
				updatedAt: 17,
				deletedAt: 27,
			},
		]);
		await db.zakatPayments.bulkPut([
			{
				id: "payment-1",
				userId: USER_ID,
				calculationId: "calc-1",
				islamicYear: "1447",
				date: 4_000,
				amount: 100,
				currency: "AED",
				recipient: "Charity",
				notes: "Cash",
				createdAt: 18,
				updatedAt: 19,
				deletedAt: 29,
			},
		]);
		await db.syncMeta.bulkPut([
			{
				id: "lastSync:accounts",
				timestamp: 30,
			},
		]);
		await db.dashboardStats.put({
			id: USER_ID,
			updatedAt: 31,
			logicVersion: 2,
			dataVersion: "v1",
			cacheStatus: "valid",
			cacheUpdatedAt: 32,
			analyticsCache: {
				accounts: {
					"acc-aed": {
						logicVersion: 2,
						dataVersion: "v1",
						key: "acc-aed",
						updatedAt: 33,
						value: { balance: 100 },
					},
				},
			},
			balances: { AED: 100 },
			perCurrency: {
				AED: {
					monthIncome: 0,
					monthExpense: 25,
					trend: [{ month: "2026-10", income: 0, expense: 25 }],
				},
			},
			recent: [
				{
					id: "txn-rich",
					type: "Expense",
					date: 1_000,
					amount: 25,
					description: "Dinner",
					place: "Dubai",
					accountId: "acc-aed",
					accountTitle: "Cash AED",
					accountCurrency: "AED",
				},
			],
			warnings: [
				{
					code: "invalid_transfer_counterparty_skipped",
					transactionId: "txn-rich",
					message: "Synthetic warning",
				},
			],
		});
	});
}

function readRealBackupFile(): File {
	expect(fs.existsSync(REAL_BACKUP_PATH)).toBe(true);
	const buffer = fs.readFileSync(REAL_BACKUP_PATH);
	return new File([new Uint8Array(buffer)], "HK Backup - PKR.db");
}

beforeEach(async () => {
	await db.delete();
	await db.open();
});

describe("MizanTrack Excel backup", () => {
	it("defines one full-fidelity sheet per entity and covers fields from src/types/index.ts", () => {
		for (const entity of [
			"Account",
			"Category",
			"Transaction",
			"Budget",
			"GoldItem",
			"ZakatCalculation",
			"ZakatPayment",
			"DbConfig",
			"SyncMeta",
			"DashboardStats",
		] as const) {
			const excluded =
				entity === "DbConfig" ? new Set<string>(SECURITY_EXCLUDED_DB_CONFIG_FIELDS) : new Set();
			const expected = interfaceFields(entity).filter((field) => !excluded.has(field));
			expect(sheetFor(entity).columns).toEqual(expected);
		}
	});

	it("round-trips every exported field including nested arrays, soft deletes, and budgets", async () => {
		await seedFullFidelityFixture();

		const decoded = decodeMizanTrackBackupWorkbook(
			await buildMizanTrackBackupWorkbookBytes(USER_ID)
		);

		expect(
			sortById(decoded.accounts).map((record) => pickColumns(record, sheetFor("Account").columns))
		).toEqual(await expectedRows("Account", db.accounts.where("userId").equals(USER_ID).toArray()));
		expect(
			sortById(decoded.categories).map((record) =>
				pickColumns(record, sheetFor("Category").columns)
			)
		).toEqual(
			await expectedRows("Category", db.categories.where("userId").equals(USER_ID).toArray())
		);
		expect(
			sortById(decoded.transactions).map((record) =>
				pickColumns(record, sheetFor("Transaction").columns)
			)
		).toEqual(
			await expectedRows("Transaction", db.transactions.where("userId").equals(USER_ID).toArray())
		);
		expect(
			sortById(decoded.budgets).map((record) => pickColumns(record, sheetFor("Budget").columns))
		).toEqual(await expectedRows("Budget", db.budgets.where("userId").equals(USER_ID).toArray()));
		expect(
			sortById(decoded.goldItems).map((record) => pickColumns(record, sheetFor("GoldItem").columns))
		).toEqual(
			await expectedRows("GoldItem", db.goldItems.where("userId").equals(USER_ID).toArray())
		);
		expect(
			sortById(decoded.zakatCalculations).map((record) =>
				pickColumns(record, sheetFor("ZakatCalculation").columns)
			)
		).toEqual(
			await expectedRows(
				"ZakatCalculation",
				db.zakatCalculations.where("userId").equals(USER_ID).toArray()
			)
		);
		expect(
			sortById(decoded.zakatPayments).map((record) =>
				pickColumns(record, sheetFor("ZakatPayment").columns)
			)
		).toEqual(
			await expectedRows("ZakatPayment", db.zakatPayments.where("userId").equals(USER_ID).toArray())
		);
		expect(decoded.dbConfig).toEqual(
			await expectedRows("DbConfig", Promise.resolve([(await db.dbConfig.get(USER_ID))!]))
		);
		expect(
			decoded.syncMeta.map((record) => pickColumns(record, sheetFor("SyncMeta").columns))
		).toEqual(await expectedRows("SyncMeta", db.syncMeta.toArray()));
		expect(
			decoded.dashboardStats.map((record) =>
				pickColumns(record, sheetFor("DashboardStats").columns)
			)
		).toEqual(
			await expectedRows(
				"DashboardStats",
				Promise.resolve([(await db.dashboardStats.get(USER_ID))!])
			)
		);
		for (const secretField of SECURITY_EXCLUDED_DB_CONFIG_FIELDS) {
			expect(decoded.dbConfig[0]).not.toHaveProperty(secretField);
		}
	});

	it("exports a realistic imported Hysab Kytab database without dropping imported rows", async () => {
		await db.dbConfig.put({
			id: REAL_BACKUP_USER_ID,
			currency: "PKR",
			fiscalYearStartMonth: 7,
			firebaseConfig: "",
			enabled: false,
			enabledCurrencies: ["PKR"],
		});
		const plan = await prepareHysabKytabSqliteImport(
			readRealBackupFile(),
			REAL_BACKUP_USER_ID,
			"PKR"
		);
		await commitHysabKytabSqliteImport(plan, { useReclassificationForAll: true });

		const decoded = decodeMizanTrackBackupWorkbook(
			await buildMizanTrackBackupWorkbookBytes(REAL_BACKUP_USER_ID)
		);

		expect(decoded.accounts).toHaveLength(
			await db.accounts.where("userId").equals(REAL_BACKUP_USER_ID).count()
		);
		expect(decoded.categories).toHaveLength(
			await db.categories.where("userId").equals(REAL_BACKUP_USER_ID).count()
		);
		expect(decoded.transactions).toHaveLength(
			await db.transactions.where("userId").equals(REAL_BACKUP_USER_ID).count()
		);
		expect(decoded.budgets).toHaveLength(
			await db.budgets.where("userId").equals(REAL_BACKUP_USER_ID).count()
		);
	}, 30000);
});
