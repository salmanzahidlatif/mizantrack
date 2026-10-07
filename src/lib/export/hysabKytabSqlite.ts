import { parseSourceId } from "@/lib/import/sourceId";

import { db } from "../db/local";

import type { DateRange, Account, Budget, Category, Transaction } from "@/types";
import type initSqlJs from "sql.js";

type SqlDatabase = initSqlJs.Database;
type SqlValue = initSqlJs.SqlValue;

export interface HysabKytabSqliteExportOptions {
	currency: string;
	includeArchivedAccounts: boolean;
}

export interface HysabKytabSqliteExportSummary {
	currency: string;
	accounts: number;
	categories: number;
	transactions: number;
	voucherRows: number;
	transferPairs: number;
	budgets: number;
}

export interface HysabKytabSqliteExportResult {
	bytes: Uint8Array;
	summary: HysabKytabSqliteExportSummary;
}

export const HYSAB_KYTAB_SQLITE_FLEX_MAPPING = {
	HKBACCOUNT: {
		FLEX1: "MizanTrack account id",
		FLEX2: "MizanTrack/Hysab Kytab sourceId when present",
		FLEX3: "MizanTrack accountType",
	},
	HKBCATEGORY: {
		FLEX1: "MizanTrack category id",
		FLEX2: "MizanTrack category currency; empty means shared/untagged",
		FLEX3: "MizanTrack/Hysab Kytab sourceId when present",
	},
	HKBVOUCHER: {
		FLEX1: "MizanTrack transaction id",
		FLEX2: "MizanTrack/Hysab Kytab sourceId when present",
		FLEX3: "MizanTrack transfer leg: source or destination",
		FLEX4: "JSON-encoded MizanTrack tags",
		FLEX5: "JSON-encoded MizanTrack travelCurrency",
	},
	HKBBUDGET: {
		FLEX1: "MizanTrack budget id",
		FLEX2: "MizanTrack budget currency; explicit value or derived category currency",
		FLEX3: "MizanTrack/Hysab Kytab sourceId when present",
	},
} as const;

interface ExportSelection {
	accounts: Account[];
	categories: Category[];
	transactions: Transaction[];
	budgets: Budget[];
}

interface VoucherRowInput {
	id: number;
	transaction: Transaction;
	account: Account;
	category?: Category;
	amount: number;
	type: Transaction["type"];
	refNo: string;
	leg: "" | "source" | "destination";
	description?: string;
}

const HKB_ACCOUNT_COLUMNS = [
	"ID",
	"ACCNATURE",
	"ACCOUNTCURRENCY",
	"ACCTYPE",
	"ACTIVE",
	"BALANCEAMOUNT",
	"BANKNAME",
	"BOXCOLOR",
	"BOXICON",
	"DESCR",
	"FLEX1",
	"FLEX2",
	"FLEX3",
	"FLEX4",
	"FLEX5",
	"FLEX6",
	"GLACCNO",
	"OPENINGBALANCE",
	"SYNC",
	"SYSTEMDEFINED",
	"TITLE",
	"USERID",
] as const;

const HKB_CATEGORY_COLUMNS = [
	"ID",
	"ACTIVE",
	"BALANCEAMOUNT",
	"BOXCOLOR",
	"BOXICON",
	"BUDGETAMOUNT",
	"CATTYPE",
	"DESCR",
	"FLEX1",
	"FLEX2",
	"FLEX3",
	"FLEX4",
	"FLEX5",
	"FLEX6",
	"GLACCNO",
	"ISEXPENSE",
	"PARENTID",
	"SYNC",
	"SYSTEMDEFINED",
	"TITILE",
	"USERID",
] as const;

const HKB_VOUCHER_COLUMNS = [
	"ID",
	"ACCOUNTID",
	"ACCOUNTNAME",
	"ACTIVE",
	"CATEGORYID",
	"CATEGRORYNAME",
	"CREATEDON",
	"DESCRIPTION",
	"EVENTID",
	"EVENTNAME",
	"FCAMOUNT",
	"FCCURRENCY",
	"FCRATE",
	"FLEX1",
	"FLEX2",
	"FLEX3",
	"FLEX4",
	"FLEX5",
	"FLEX6",
	"FLEX7",
	"FLEX8",
	"FLEX9",
	"FLEX10",
	"MONTH",
	"NOSERIAL",
	"PARTYID",
	"REFNO",
	"SYNC",
	"TAG",
	"TRAVELMODE",
	"TRAVELMODELOCATION",
	"TRAVELMODEPLACE",
	"UPDATEDON",
	"USECASE",
	"USERID",
	"VCHAMOUNT",
	"VCHCURRENCY",
	"VCHDATE",
	"VCHIMAGE",
	"VCHNO",
	"VCHTYPE",
	"VCHDAY",
	"VCHTRXPLACE",
	"VCHYEAR",
] as const;

const HKB_BUDGET_COLUMNS = [
	"ID",
	"ACTIVE",
	"BUDGETMONTH",
	"BUDGETVALUE",
	"BUDGETYEAR",
	"CATEGORYID",
	"FLEX1",
	"FLEX2",
	"FLEX3",
	"FLEX4",
	"FLEX5",
	"FLEX6",
	"FLEX7",
	"SYNC",
] as const;

const EMPTY_TABLE_SQL = [
	"CREATE TABLE HKACTIVITY (ID INTEGER PRIMARY KEY AUTOINCREMENT)",
	"CREATE TABLE HKBEVENT (ID INTEGER PRIMARY KEY AUTOINCREMENT)",
	"CREATE TABLE HKBGOAL (ID INTEGER PRIMARY KEY AUTOINCREMENT)",
	"CREATE TABLE HKBGOALTRX (ID INTEGER PRIMARY KEY AUTOINCREMENT)",
	"CREATE TABLE HKBNOTIFICATIONS (ID INTEGER PRIMARY KEY AUTOINCREMENT)",
	"CREATE TABLE HKBPARTY (ID INTEGER PRIMARY KEY AUTOINCREMENT)",
	"CREATE TABLE HKBREMINDER (ID INTEGER PRIMARY KEY AUTOINCREMENT)",
	"CREATE TABLE COREAREA (ID INTEGER PRIMARY KEY AUTOINCREMENT)",
	"CREATE TABLE CORECITY (ID INTEGER PRIMARY KEY AUTOINCREMENT)",
	"CREATE TABLE CORECOUNTRY (ID INTEGER PRIMARY KEY AUTOINCREMENT)",
	"CREATE TABLE android_metadata (locale TEXT)",
] as const;

let sqlJsPromise: Promise<initSqlJs.SqlJsStatic> | undefined;

function normalizeCurrency(value: string | undefined): string {
	return value?.trim().toUpperCase() ?? "";
}

function getSqlWasmPath(file: string): string {
	if (file !== "sql-wasm.wasm") return file;
	if (typeof process !== "undefined" && process.versions?.node) {
		return `${process.cwd()}/node_modules/sql.js/dist/sql-wasm.wasm`;
	}
	return new URL("../../../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url).toString();
}

async function loadSqlJs(): Promise<initSqlJs.SqlJsStatic> {
	sqlJsPromise ??= import("sql.js").then((module) =>
		module.default({
			locateFile: getSqlWasmPath,
		})
	);
	return sqlJsPromise;
}

function sqlString(value: string | undefined): string {
	return value ?? "";
}

function sqlBoolean(value: boolean): number {
	return value ? 1 : 0;
}

function isActive(record: { deletedAt?: number }): number {
	return record.deletedAt ? 0 : 1;
}

function toSqlDateParts(timestamp: number) {
	const date = new Date(timestamp);
	const day = date.getDate();
	const month = date.getMonth() + 1;
	const year = date.getFullYear();
	const paddedDay = String(day).padStart(2, "0");
	const paddedMonth = String(month).padStart(2, "0");

	return {
		day,
		month,
		year,
		formatted: `${paddedDay}/${paddedMonth}/${year}`,
	};
}

function monthKey(timestamp: number): string {
	const date = new Date(timestamp);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function parseBudgetPeriod(period: string): { year: number; month: number } | undefined {
	const match = /^(\d{4})-(\d{2})$/.exec(period);
	if (!match) return undefined;

	const year = Number(match[1]);
	const month = Number(match[2]);
	if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
		return undefined;
	}
	return { year, month };
}

function sourceNumericId(
	sourceId: string | undefined,
	entity: "account" | "category" | "voucher" | "budget",
	currency: string
): number | undefined {
	if (!sourceId) return undefined;
	const parsed = parseSourceId(sourceId);
	if (parsed?.entity !== entity || parsed.currency !== currency) return undefined;

	const numeric = Number(parsed.id);
	if (!Number.isSafeInteger(numeric) || numeric <= 0) return undefined;
	return numeric;
}

function assignNumericIds<T extends { id: string; sourceId?: string }>(
	items: readonly T[],
	entity: "account" | "category" | "budget",
	currency: string
): Map<string, number> {
	const usedIds = new Set<number>();
	const ids = new Map<string, number>();

	for (const item of items) {
		const sourceId = sourceNumericId(item.sourceId, entity, currency);
		if (sourceId === undefined || usedIds.has(sourceId)) continue;
		ids.set(item.id, sourceId);
		usedIds.add(sourceId);
	}

	let nextId = 1;
	for (const item of items) {
		if (ids.has(item.id)) continue;
		while (usedIds.has(nextId)) nextId++;
		ids.set(item.id, nextId);
		usedIds.add(nextId);
	}

	return ids;
}

function makeVoucherIdAllocator(transactions: readonly Transaction[], currency: string) {
	const usedIds = new Set<number>();
	for (const transaction of transactions) {
		const sourceId = sourceNumericId(transaction.sourceId, "voucher", currency);
		if (sourceId !== undefined) usedIds.add(sourceId);
	}

	let nextId = 1;
	return (preferred?: number): number => {
		if (preferred !== undefined && !usedIds.has(preferred)) {
			usedIds.add(preferred);
			return preferred;
		}
		while (usedIds.has(nextId)) nextId++;
		usedIds.add(nextId);
		return nextId;
	};
}

function runInsert(
	database: SqlDatabase,
	tableName: string,
	columns: readonly string[],
	values: readonly SqlValue[]
) {
	const placeholders = columns.map(() => "?").join(", ");
	database.run(
		`INSERT INTO ${tableName} (${columns.join(", ")}) VALUES (${placeholders})`,
		values as SqlValue[]
	);
}

function createSchema(database: SqlDatabase) {
	database.run(`
		CREATE TABLE HKBACCOUNT (
			ID INTEGER PRIMARY KEY AUTOINCREMENT,
			ACCNATURE TEXT,
			ACCOUNTCURRENCY TEXT,
			ACCTYPE TEXT,
			ACTIVE INTEGER,
			BALANCEAMOUNT FLOAT,
			BANKNAME TEXT,
			BOXCOLOR TEXT,
			BOXICON TEXT,
			DESCR TEXT,
			FLEX1 TEXT,
			FLEX2 TEXT,
			FLEX3 TEXT,
			FLEX4 TEXT,
			FLEX5 TEXT,
			FLEX6 TEXT,
			GLACCNO TEXT,
			OPENINGBALANCE FLOAT,
			SYNC INTEGER,
			SYSTEMDEFINED INTEGER,
			TITLE TEXT,
			USERID INTEGER
		);

		CREATE TABLE HKBCATEGORY (
			ID INTEGER PRIMARY KEY AUTOINCREMENT,
			ACTIVE INTEGER,
			BALANCEAMOUNT FLOAT,
			BOXCOLOR TEXT,
			BOXICON TEXT,
			BUDGETAMOUNT FLOAT,
			CATTYPE TEXT,
			DESCR TEXT,
			FLEX1 TEXT,
			FLEX2 TEXT,
			FLEX3 TEXT,
			FLEX4 TEXT,
			FLEX5 TEXT,
			FLEX6 TEXT,
			GLACCNO TEXT,
			ISEXPENSE INTEGER,
			PARENTID INTEGER,
			SYNC INTEGER,
			SYSTEMDEFINED INTEGER,
			TITILE TEXT,
			USERID INTEGER
		);

		CREATE TABLE HKBVOUCHER (
			ID INTEGER PRIMARY KEY AUTOINCREMENT,
			ACCOUNTID INTEGER,
			ACCOUNTNAME TEXT,
			ACTIVE INTEGER,
			CATEGORYID INTEGER,
			CATEGRORYNAME TEXT,
			CREATEDON TEXT,
			DESCRIPTION TEXT,
			EVENTID INTEGER,
			EVENTNAME TEXT,
			FCAMOUNT FLOAT,
			FCCURRENCY TEXT,
			FCRATE TEXT,
			FLEX1 TEXT,
			FLEX2 TEXT,
			FLEX3 TEXT,
			FLEX4 TEXT,
			FLEX5 TEXT,
			FLEX6 TEXT,
			FLEX7 TEXT,
			FLEX8 TEXT,
			FLEX9 TEXT,
			FLEX10 TEXT,
			MONTH INTEGER,
			NOSERIAL INTEGER,
			PARTYID INTEGER,
			REFNO TEXT,
			SYNC INTEGER,
			TAG TEXT,
			TRAVELMODE INTEGER,
			TRAVELMODELOCATION TEXT,
			TRAVELMODEPLACE TEXT,
			UPDATEDON TEXT,
			USECASE TEXT,
			USERID INTEGER,
			VCHAMOUNT FLOAT,
			VCHCURRENCY TEXT,
			VCHDATE TEXT,
			VCHIMAGE TEXT,
			VCHNO TEXT,
			VCHTYPE TEXT,
			VCHDAY INTEGER,
			VCHTRXPLACE TEXT,
			VCHYEAR INTEGER
		);

		CREATE TABLE HKBBUDGET (
			ID INTEGER PRIMARY KEY AUTOINCREMENT,
			ACTIVE INTEGER,
			BUDGETMONTH INTEGER,
			BUDGETVALUE FLOAT,
			BUDGETYEAR INTEGER,
			CATEGORYID INTEGER,
			FLEX1 TEXT,
			FLEX2 TEXT,
			FLEX3 TEXT,
			FLEX4 TEXT,
			FLEX5 TEXT,
			FLEX6 TEXT,
			FLEX7 TEXT,
			SYNC INTEGER
		);
	`);

	for (const sql of EMPTY_TABLE_SQL) {
		database.run(sql);
	}
}

function budgetCurrency(budget: Budget, categoriesById: Map<string, Category>): string {
	const explicitCurrency = normalizeCurrency(budget.currency);
	if (explicitCurrency) return explicitCurrency;
	return normalizeCurrency(categoriesById.get(budget.categoryId)?.currency);
}

function budgetBelongsToCurrency(
	budget: Budget,
	currency: string,
	categoriesById: Map<string, Category>
): boolean {
	return budgetCurrency(budget, categoriesById) === currency;
}

function selectExportData(
	input: {
		accounts: Account[];
		categories: Category[];
		transactions: Transaction[];
		budgets: Budget[];
	},
	range: DateRange,
	options: HysabKytabSqliteExportOptions
): ExportSelection {
	const currency = normalizeCurrency(options.currency);
	const categoriesById = new Map(input.categories.map((category) => [category.id, category]));
	const rangeFrom = range.from.getTime();
	const rangeTo = range.to.getTime();
	const fromPeriod = monthKey(rangeFrom);
	const toPeriod = monthKey(rangeTo);
	const primaryAccountIds = new Set(
		input.accounts
			.filter(
				(account) =>
					normalizeCurrency(account.currency) === currency &&
					(options.includeArchivedAccounts || !account.isArchived)
			)
			.map((account) => account.id)
	);

	const transactions = input.transactions.filter((transaction) => {
		if (transaction.date < rangeFrom || transaction.date > rangeTo) return false;
		return (
			primaryAccountIds.has(transaction.accountId) ||
			Boolean(transaction.toAccountId && primaryAccountIds.has(transaction.toAccountId))
		);
	});
	const transactionAccountIds = new Set<string>();
	const transactionCategoryIds = new Set<string>();

	for (const transaction of transactions) {
		transactionAccountIds.add(transaction.accountId);
		if (transaction.toAccountId) transactionAccountIds.add(transaction.toAccountId);
		if (transaction.categoryId) transactionCategoryIds.add(transaction.categoryId);
	}

	const budgets = input.budgets.filter((budget) => {
		if (!budgetBelongsToCurrency(budget, currency, categoriesById)) return false;
		return budget.period >= fromPeriod && budget.period <= toPeriod;
	});
	const budgetCategoryIds = new Set(budgets.map((budget) => budget.categoryId));

	const accounts = input.accounts.filter(
		(account) => primaryAccountIds.has(account.id) || transactionAccountIds.has(account.id)
	);
	const categories = input.categories.filter((category) => {
		const categoryCurrency = normalizeCurrency(category.currency);
		return (
			categoryCurrency === currency ||
			transactionCategoryIds.has(category.id) ||
			budgetCategoryIds.has(category.id)
		);
	});

	return {
		accounts,
		categories,
		transactions,
		budgets,
	};
}

function insertAccounts(
	database: SqlDatabase,
	accounts: readonly Account[],
	accountIds: Map<string, number>
) {
	for (const account of accounts) {
		runInsert(database, "HKBACCOUNT", HKB_ACCOUNT_COLUMNS, [
			accountIds.get(account.id) ?? null,
			account.accountType === "liability" ? "Liability" : "Asset",
			normalizeCurrency(account.currency),
			account.accountType === "liability" ? "Liability" : "Asset",
			isActive(account),
			0,
			"",
			sqlString(account.color),
			sqlString(account.icon),
			"",
			account.id,
			sqlString(account.sourceId),
			sqlString(account.accountType),
			"",
			"",
			"",
			"",
			account.openingBalance,
			0,
			0,
			account.isArchived ? `${account.title} (Closed)` : account.title,
			1,
		]);
	}
}

function insertCategories(
	database: SqlDatabase,
	categories: readonly Category[],
	categoryIds: Map<string, number>
) {
	for (const category of categories) {
		const parentId = category.parentId ? (categoryIds.get(category.parentId) ?? null) : null;
		runInsert(database, "HKBCATEGORY", HKB_CATEGORY_COLUMNS, [
			categoryIds.get(category.id) ?? null,
			isActive(category),
			0,
			sqlString(category.color),
			sqlString(category.icon),
			0,
			category.type,
			"",
			category.id,
			normalizeCurrency(category.currency),
			sqlString(category.sourceId),
			"",
			"",
			"",
			"",
			sqlBoolean(category.type === "Expense"),
			parentId,
			0,
			0,
			category.title,
			1,
		]);
	}
}

function toVoucherRowValues(
	input: VoucherRowInput,
	accountIds: Map<string, number>,
	categoryIds: Map<string, number>
): SqlValue[] {
	const { day, month, year, formatted } = toSqlDateParts(input.transaction.date);
	const categoryId = input.category?.id ? (categoryIds.get(input.category.id) ?? null) : null;
	const tags = input.transaction.tags?.join(",") ?? "";
	const travelCurrency = input.transaction.travelCurrency
		? JSON.stringify(input.transaction.travelCurrency)
		: "";

	return [
		input.id,
		accountIds.get(input.account.id) ?? null,
		input.account.title,
		isActive(input.transaction),
		categoryId,
		input.category?.title ?? "",
		formatted,
		input.description ?? input.transaction.description ?? "",
		null,
		"",
		input.amount,
		normalizeCurrency(input.account.currency),
		"1",
		input.transaction.id,
		sqlString(input.transaction.sourceId),
		input.leg,
		JSON.stringify(input.transaction.tags ?? []),
		travelCurrency,
		"",
		"",
		"",
		"",
		"",
		month,
		input.id,
		null,
		input.refNo,
		0,
		tags,
		input.transaction.travelCurrency ? 1 : 0,
		input.transaction.travelCurrency?.location ?? "",
		input.transaction.place ?? "",
		formatted,
		input.type,
		1,
		input.amount,
		normalizeCurrency(input.account.currency),
		formatted,
		"",
		String(input.id),
		input.type,
		day,
		input.transaction.place ?? "",
		year,
	];
}

function insertVouchers(
	database: SqlDatabase,
	transactions: readonly Transaction[],
	accountsById: Map<string, Account>,
	categoriesById: Map<string, Category>,
	accountIds: Map<string, number>,
	categoryIds: Map<string, number>,
	currency: string
): { voucherRows: number; transferPairs: number } {
	const allocateVoucherId = makeVoucherIdAllocator(transactions, currency);
	let voucherRows = 0;
	let transferPairs = 0;

	for (const transaction of transactions) {
		const account = accountsById.get(transaction.accountId);
		if (!account) continue;
		const category = transaction.categoryId
			? categoriesById.get(transaction.categoryId)
			: undefined;

		if (transaction.type === "Transfer") {
			const toAccount = transaction.toAccountId
				? accountsById.get(transaction.toAccountId)
				: undefined;
			if (!toAccount) continue;

			const sourceId = allocateVoucherId(
				sourceNumericId(transaction.sourceId, "voucher", currency)
			);
			const destinationId = allocateVoucherId();
			const sourceDescription = transaction.description ?? `Transfer to ${toAccount.title}`;
			const destinationDescription = transaction.description ?? `Transfer from ${account.title}`;

			runInsert(
				database,
				"HKBVOUCHER",
				HKB_VOUCHER_COLUMNS,
				toVoucherRowValues(
					{
						id: sourceId,
						transaction,
						account,
						category,
						amount: -Math.abs(transaction.amount),
						type: "Transfer",
						refNo: String(destinationId),
						leg: "source",
						description: sourceDescription,
					},
					accountIds,
					categoryIds
				)
			);
			runInsert(
				database,
				"HKBVOUCHER",
				HKB_VOUCHER_COLUMNS,
				toVoucherRowValues(
					{
						id: destinationId,
						transaction,
						account: toAccount,
						category,
						amount: Math.abs(transaction.amount),
						type: "Transfer",
						refNo: String(sourceId),
						leg: "destination",
						description: destinationDescription,
					},
					accountIds,
					categoryIds
				)
			);
			voucherRows += 2;
			transferPairs++;
			continue;
		}

		const voucherId = allocateVoucherId(sourceNumericId(transaction.sourceId, "voucher", currency));
		const amount =
			transaction.type === "Expense" ? -Math.abs(transaction.amount) : Math.abs(transaction.amount);

		runInsert(
			database,
			"HKBVOUCHER",
			HKB_VOUCHER_COLUMNS,
			toVoucherRowValues(
				{
					id: voucherId,
					transaction,
					account,
					category,
					amount,
					type: transaction.type,
					refNo: "",
					leg: "",
				},
				accountIds,
				categoryIds
			)
		);
		voucherRows++;
	}

	return { voucherRows, transferPairs };
}

function insertBudgets(
	database: SqlDatabase,
	budgets: readonly Budget[],
	budgetIds: Map<string, number>,
	categoryIds: Map<string, number>,
	categoriesById: Map<string, Category>
) {
	for (const budget of budgets) {
		const period = parseBudgetPeriod(budget.period);
		if (!period) continue;

		runInsert(database, "HKBBUDGET", HKB_BUDGET_COLUMNS, [
			budgetIds.get(budget.id) ?? null,
			isActive(budget) && budget.active ? 1 : 0,
			period.month,
			budget.amount,
			period.year,
			categoryIds.get(budget.categoryId) ?? null,
			budget.id,
			budgetCurrency(budget, categoriesById),
			sqlString(budget.sourceId),
			"",
			"",
			"",
			"",
			0,
		]);
	}
}

export async function buildHysabKytabSqliteExport(
	userId: string,
	range: DateRange,
	options: HysabKytabSqliteExportOptions
): Promise<HysabKytabSqliteExportResult> {
	const currency = normalizeCurrency(options.currency);
	if (!currency) throw new Error("Choose a currency before exporting a Hysab Kytab database.");

	const [accounts, categories, transactions, budgets] = await Promise.all([
		db.accounts.where("userId").equals(userId).toArray(),
		db.categories.where("userId").equals(userId).toArray(),
		db.transactions.where("userId").equals(userId).toArray(),
		db.budgets.where("userId").equals(userId).toArray(),
	]);
	const selection = selectExportData({ accounts, categories, transactions, budgets }, range, {
		...options,
		currency,
	});
	const accountIds = assignNumericIds(selection.accounts, "account", currency);
	const categoryIds = assignNumericIds(selection.categories, "category", currency);
	const budgetIds = assignNumericIds(selection.budgets, "budget", currency);
	const accountsById = new Map(selection.accounts.map((account) => [account.id, account]));
	const categoriesById = new Map(selection.categories.map((category) => [category.id, category]));

	const SQL = await loadSqlJs();
	const sqlite = new SQL.Database();

	try {
		createSchema(sqlite);
		insertAccounts(sqlite, selection.accounts, accountIds);
		insertCategories(sqlite, selection.categories, categoryIds);
		const voucherSummary = insertVouchers(
			sqlite,
			selection.transactions,
			accountsById,
			categoriesById,
			accountIds,
			categoryIds,
			currency
		);
		insertBudgets(sqlite, selection.budgets, budgetIds, categoryIds, categoriesById);

		return {
			bytes: sqlite.export(),
			summary: {
				currency,
				accounts: selection.accounts.length,
				categories: selection.categories.length,
				transactions: selection.transactions.length,
				voucherRows: voucherSummary.voucherRows,
				transferPairs: voucherSummary.transferPairs,
				budgets: selection.budgets.length,
			},
		};
	} finally {
		sqlite.close();
	}
}
