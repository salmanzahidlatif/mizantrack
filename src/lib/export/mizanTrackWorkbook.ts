import * as XLSX from "xlsx";

import { db } from "../db/local";

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

export const MIZAN_TRACK_BACKUP_ENCODING =
	"MTJSON-v1: every cell is a JSON literal; __MIZANTRACK_UNDEFINED_V1__ means the field was absent.";
const UNDEFINED_SENTINEL = "__MIZANTRACK_UNDEFINED_V1__";

const ACCOUNT_COLUMNS = [
	"id",
	"userId",
	"title",
	"openingBalance",
	"currency",
	"color",
	"icon",
	"isArchived",
	"accountType",
	"sourceId",
	"updatedAt",
	"deletedAt",
] as const satisfies readonly (keyof Account)[];

const CATEGORY_COLUMNS = [
	"id",
	"userId",
	"title",
	"type",
	"currency",
	"icon",
	"color",
	"parentId",
	"sourceId",
	"updatedAt",
	"deletedAt",
] as const satisfies readonly (keyof Category)[];

const TRANSACTION_COLUMNS = [
	"id",
	"userId",
	"type",
	"date",
	"amount",
	"description",
	"categoryId",
	"accountId",
	"toAccountId",
	"tags",
	"place",
	"travelCurrency",
	"sourceId",
	"updatedAt",
	"deletedAt",
] as const satisfies readonly (keyof Transaction)[];

const BUDGET_COLUMNS = [
	"id",
	"userId",
	"categoryId",
	"period",
	"amount",
	"currency",
	"active",
	"sourceId",
	"updatedAt",
	"deletedAt",
] as const satisfies readonly (keyof Budget)[];

const GOLD_ITEM_COLUMNS = [
	"id",
	"userId",
	"currency",
	"title",
	"weight",
	"purity",
	"purchaseDate",
	"purchasePrice",
	"notes",
	"updatedAt",
	"deletedAt",
] as const satisfies readonly (keyof GoldItem)[];

const ZAKAT_CALCULATION_COLUMNS = [
	"id",
	"userId",
	"currency",
	"islamicYear",
	"assessmentDate",
	"nisabStandard",
	"goldPricePerGram",
	"silverPricePerGram",
	"referenceCurrency",
	"totalGoldWeightGrams",
	"totalGoldValue",
	"accountBalances",
	"totalZakatable",
	"nisabThreshold",
	"zakatObligation",
	"isLiable",
	"monthlyBalances",
	"createdAt",
	"updatedAt",
	"deletedAt",
] as const satisfies readonly (keyof ZakatCalculation)[];

const ZAKAT_PAYMENT_COLUMNS = [
	"id",
	"userId",
	"calculationId",
	"islamicYear",
	"date",
	"amount",
	"currency",
	"recipient",
	"notes",
	"createdAt",
	"updatedAt",
	"deletedAt",
] as const satisfies readonly (keyof ZakatPayment)[];

export const SECURITY_EXCLUDED_DB_CONFIG_FIELDS = [
	"firebaseConfig",
	"goldApiKey",
	"pinHash",
	"biometricCredentialId",
] as const satisfies readonly (keyof DbConfig)[];

const DB_CONFIG_COLUMNS = [
	"id",
	"enabled",
	"currency",
	"fiscalYearStartMonth",
	"lastGoldPricePerGram",
	"lastGoldPriceFetchedAt",
	"appLockEnabled",
	"biometricEnabled",
	"enabledCurrencies",
] as const satisfies readonly (keyof DbConfig)[];

const SYNC_META_COLUMNS = ["id", "timestamp"] as const satisfies readonly (keyof SyncMeta)[];

const DASHBOARD_STATS_COLUMNS = [
	"id",
	"updatedAt",
	"logicVersion",
	"dataVersion",
	"cacheStatus",
	"cacheUpdatedAt",
	"analyticsCache",
	"balances",
	"perCurrency",
	"recent",
	"warnings",
] as const satisfies readonly (keyof DashboardStats)[];

export type MizanTrackBackupEntity =
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

export interface MizanTrackBackupSheetDefinition {
	entity: MizanTrackBackupEntity;
	sheetName: string;
	columns: readonly string[];
}

interface SheetDefinition extends MizanTrackBackupSheetDefinition {
	load: (userId: string) => Promise<object[]>;
}

export type MizanTrackBackupRecords = {
	accounts: Account[];
	categories: Category[];
	transactions: Transaction[];
	budgets: Budget[];
	goldItems: GoldItem[];
	zakatCalculations: ZakatCalculation[];
	zakatPayments: ZakatPayment[];
	dbConfig: Partial<DbConfig>[];
	syncMeta: SyncMeta[];
	dashboardStats: DashboardStats[];
};

const sheetDefinitions = [
	{
		entity: "Account",
		sheetName: "MizanTrack_Accounts",
		columns: ACCOUNT_COLUMNS,
		load: async (userId: string) => db.accounts.where("userId").equals(userId).toArray(),
	},
	{
		entity: "Category",
		sheetName: "MizanTrack_Categories",
		columns: CATEGORY_COLUMNS,
		load: async (userId: string) => db.categories.where("userId").equals(userId).toArray(),
	},
	{
		entity: "Transaction",
		sheetName: "MizanTrack_Transactions",
		columns: TRANSACTION_COLUMNS,
		load: async (userId: string) => db.transactions.where("userId").equals(userId).toArray(),
	},
	{
		entity: "Budget",
		sheetName: "MizanTrack_Budgets",
		columns: BUDGET_COLUMNS,
		load: async (userId: string) => db.budgets.where("userId").equals(userId).toArray(),
	},
	{
		entity: "GoldItem",
		sheetName: "MizanTrack_GoldItems",
		columns: GOLD_ITEM_COLUMNS,
		load: async (userId: string) => db.goldItems.where("userId").equals(userId).toArray(),
	},
	{
		entity: "ZakatCalculation",
		sheetName: "MizanTrack_ZakatCalculations",
		columns: ZAKAT_CALCULATION_COLUMNS,
		load: async (userId: string) => db.zakatCalculations.where("userId").equals(userId).toArray(),
	},
	{
		entity: "ZakatPayment",
		sheetName: "MizanTrack_ZakatPayments",
		columns: ZAKAT_PAYMENT_COLUMNS,
		load: async (userId: string) => db.zakatPayments.where("userId").equals(userId).toArray(),
	},
	{
		entity: "DbConfig",
		sheetName: "MizanTrack_DbConfig",
		columns: DB_CONFIG_COLUMNS,
		load: async (userId: string) => {
			const config = await db.dbConfig.get(userId);
			return config ? [config] : [];
		},
	},
	{
		entity: "SyncMeta",
		sheetName: "MizanTrack_SyncMeta",
		columns: SYNC_META_COLUMNS,
		load: async () => db.syncMeta.toArray(),
	},
	{
		entity: "DashboardStats",
		sheetName: "MizanTrack_DashboardStats",
		columns: DASHBOARD_STATS_COLUMNS,
		load: async (userId: string) => {
			const stats = await db.dashboardStats.get(userId);
			return stats ? [stats] : [];
		},
	},
] as const satisfies readonly SheetDefinition[];

export const MIZAN_TRACK_BACKUP_SHEETS: readonly MizanTrackBackupSheetDefinition[] =
	sheetDefinitions.map(({ entity, sheetName, columns }) => ({
		entity,
		sheetName,
		columns,
	}));

function encodeBackupCell(value: unknown): string {
	if (value === undefined) return UNDEFINED_SENTINEL;
	return JSON.stringify(value);
}

function decodeBackupCell(value: unknown): unknown {
	if (value === UNDEFINED_SENTINEL) return undefined;
	if (typeof value !== "string") return value;
	return JSON.parse(value);
}

function appendEncodedSheet(
	workbook: XLSX.WorkBook,
	definition: SheetDefinition,
	records: readonly object[]
): void {
	const rows = [
		[...definition.columns],
		...records.map((record) =>
			definition.columns.map((column) =>
				encodeBackupCell((record as Record<string, unknown>)[column])
			)
		),
	];
	XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), definition.sheetName);
}

export async function buildMizanTrackBackupWorkbook(userId: string): Promise<XLSX.WorkBook> {
	const workbook = XLSX.utils.book_new();

	for (const definition of sheetDefinitions) {
		const records = await definition.load(userId);
		appendEncodedSheet(workbook, definition, records);
	}

	return workbook;
}

export async function buildMizanTrackBackupWorkbookBytes(userId: string): Promise<Uint8Array> {
	const workbook = await buildMizanTrackBackupWorkbook(userId);
	const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
	return new Uint8Array(bytes);
}

function readEntitySheet<T extends object>(
	workbook: XLSX.WorkBook,
	definition: MizanTrackBackupSheetDefinition
): T[] {
	const sheet = workbook.Sheets[definition.sheetName];
	if (!sheet) return [];

	const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
		header: 1,
		blankrows: false,
		defval: UNDEFINED_SENTINEL,
	});
	const [_header, ...dataRows] = rows;

	return dataRows.map((row) => {
		const record: Record<string, unknown> = {};
		definition.columns.forEach((column, index) => {
			const value = decodeBackupCell(row[index]);
			if (value !== undefined) record[column] = value;
		});
		return record as T;
	});
}

export function decodeMizanTrackBackupWorkbook(
	input: ArrayBuffer | Uint8Array
): MizanTrackBackupRecords {
	const workbook = XLSX.read(input);
	const byEntity = new Map(
		MIZAN_TRACK_BACKUP_SHEETS.map((definition) => [definition.entity, definition])
	);

	return {
		accounts: readEntitySheet<Account>(workbook, byEntity.get("Account")!),
		categories: readEntitySheet<Category>(workbook, byEntity.get("Category")!),
		transactions: readEntitySheet<Transaction>(workbook, byEntity.get("Transaction")!),
		budgets: readEntitySheet<Budget>(workbook, byEntity.get("Budget")!),
		goldItems: readEntitySheet<GoldItem>(workbook, byEntity.get("GoldItem")!),
		zakatCalculations: readEntitySheet<ZakatCalculation>(
			workbook,
			byEntity.get("ZakatCalculation")!
		),
		zakatPayments: readEntitySheet<ZakatPayment>(workbook, byEntity.get("ZakatPayment")!),
		dbConfig: readEntitySheet<Partial<DbConfig>>(workbook, byEntity.get("DbConfig")!),
		syncMeta: readEntitySheet<SyncMeta>(workbook, byEntity.get("SyncMeta")!),
		dashboardStats: readEntitySheet<DashboardStats>(workbook, byEntity.get("DashboardStats")!),
	};
}
