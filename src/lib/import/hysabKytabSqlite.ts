import { v5 as uuidv5 } from "uuid";

import { scheduleAnalyticsRecompute } from "@/lib/analytics/scheduleRecompute";
import { db } from "@/lib/db/local";

import {
	normalizeHysabKytabColor,
	resolveHysabKytabAccountIcon,
	resolveHysabKytabCategoryIcon,
} from "./hysabKytabIcons";
import { buildHysabKytabSourceId, parseSourceId } from "./sourceId";

import type { Account, Budget, Category, Transaction } from "@/types";
import type initSqlJs from "sql.js";

type SqlDatabase = initSqlJs.Database;
type SqlValue = initSqlJs.SqlValue;
type SqlRow = Record<string, SqlValue>;

type DateParseSource = "with-time" | "date-only" | "parts";
type UnresolvedTransferDirection = "missing-destination" | "missing-source";
type HysabKytabResolutionMode = "counterparty" | "reclassified";

interface AccountDraft extends Account {
	expectedBalance: number;
	sourceAccountId?: string;
}

interface CategoryDraft extends Category {
	sourceCategoryId: string;
	sourceParentId?: string;
	active: boolean;
}

interface BudgetDraft extends Budget {
	sourceBudgetId: string;
}

type ImportedTransaction = Transaction & { currency: string };

interface TransactionDraft extends ImportedTransaction {
	sourceVoucherId: string;
	sourceVoucherIds: string[];
}

export interface HysabKytabAccountChoice {
	id: string;
	title: string;
	currency: string;
	isArchived: boolean;
	fallback?: boolean;
}

export interface HysabKytabUnresolvedTransfer {
	voucherId: string;
	sourceId: string;
	date: number;
	dateLabel: string;
	amount: number;
	signedAmount: number;
	accountId: string;
	accountTitle: string;
	description: string;
	direction: UnresolvedTransferDirection;
	reason: string;
}

export interface HysabKytabVerificationCheck {
	label: string;
	expected: number;
	actual: number;
	difference: number;
	passed: boolean;
}

export interface HysabKytabAccountVerification {
	accountId: string;
	title: string;
	expected: number;
	actual: number;
	difference: number;
	passed: boolean;
}

export interface HysabKytabVerificationReport {
	passed: boolean;
	checks: HysabKytabVerificationCheck[];
	accountBalances: HysabKytabAccountVerification[];
	sourceTransferLegNet: number;
	sourceTransferAnomalies: HysabKytabUnresolvedTransfer[];
	importedTransferNet: number;
	invalidImportedTransfers: number;
	extraAccountBalances: HysabKytabAccountVerification[];
	expectedNetWorthDifference: number;
	expectedNetWorthDifferenceReason?: string;
	reclassifiedUnpairedTransfers: number;
	reclassifiedIncomeDelta: number;
	reclassifiedExpenseDelta: number;
	reclassificationSummary?: string;
}

export interface HysabKytabSqliteImportSummary {
	currency: string;
	accounts: number;
	categories: number;
	budgets: number;
	activeVouchers: number;
	incomeRows: number;
	expenseRows: number;
	transferLegs: number;
	transfersPaired: number;
	unresolvedTransfers: number;
	incomeTotal: number;
	expenseTotal: number;
	sourceTransferLegNet: number;
	dateFormats: Record<DateParseSource, number>;
}

export interface HysabKytabSqliteImportPlan {
	kind: "sqlite";
	fileName: string;
	userId: string;
	currency: string;
	summary: HysabKytabSqliteImportSummary;
	unresolvedTransfers: HysabKytabUnresolvedTransfer[];
	accountChoices: HysabKytabAccountChoice[];
	fallbackAccount: HysabKytabAccountChoice;
}

interface InternalImportPlan extends HysabKytabSqliteImportPlan {
	accountDrafts: AccountDraft[];
	categoryDrafts: CategoryDraft[];
	transactionDrafts: TransactionDraft[];
	budgetDrafts: BudgetDraft[];
	expectedAccountBalances: Map<string, number>;
	sourceAccountIdByAppId: Map<string, string>;
	sourceTransferAnomalies: HysabKytabUnresolvedTransfer[];
	existingAccountsById: Map<string, Account>;
	existingCategoriesById: Map<string, Category>;
	existingTransactionsById: Map<string, Transaction>;
	existingBudgetsById: Map<string, Budget>;
}

export interface HysabKytabTransferResolutionInput {
	useFallbackForAll?: boolean;
	useReclassificationForAll?: boolean;
	byVoucherId?: Record<string, string>;
}

export interface HysabKytabSqliteImportResult {
	accounts: number;
	categories: number;
	budgets: number;
	transactions: number;
	transfersPaired: number;
	unmatchedTransferAdjustments?: number;
	unresolvedTransfersResolved: number;
	autoCreated: number;
	autoCreatedAccounts: string[];
	inserted: number;
	updated: number;
	unchanged: number;
	verification: HysabKytabVerificationReport;
	summary: HysabKytabSqliteImportSummary;
}

const HK_SQLITE_NAMESPACE = "e0dd2467-6f1c-55a2-94aa-87c2a274f166";
const FALLBACK_ACCOUNT_TITLE = "HK Unresolved Transfer Counterparty";
const FALLBACK_ACCOUNT_SOURCE_RECORD_ID = "missing-unresolved-transfers";
const CENT_TOLERANCE = 0.005;

export const HYSAB_KYTAB_RECLASSIFY_RESOLUTION = "__hk_reclassify_unpaired_transfer__";

const internalPlans = new WeakMap<HysabKytabSqliteImportPlan, InternalImportPlan>();
let sqlJsPromise: Promise<initSqlJs.SqlJsStatic> | undefined;

function getSqlWasmPath(file: string): string {
	if (!file.endsWith(".wasm")) return file;
	// Node (including jsdom tests) reads the binary straight from the package.
	if (typeof process !== "undefined" && process.versions?.node) {
		return `${process.cwd()}/node_modules/sql.js/dist/${file}`;
	}
	// In the browser sql.js fetches over HTTP, so it must come from public/.
	// Note the browser build asks for sql-wasm-browser.wasm, not sql-wasm.wasm.
	return `/${file}`;
}

async function loadSqlJs(): Promise<initSqlJs.SqlJsStatic> {
	sqlJsPromise ??= import("sql.js").then((module) =>
		module.default({
			locateFile: getSqlWasmPath,
		})
	);
	return sqlJsPromise;
}

function normalizeCurrency(value: string | undefined): string {
	const currency = value?.trim().toUpperCase() ?? "";
	if (!/^[A-Z]{3}$/.test(currency)) {
		throw new Error("Choose a 3-letter currency before importing a Hysab Kytab database.");
	}
	return currency;
}

function stableId(userId: string, sourceId: string): string {
	return uuidv5(`${userId}|${sourceId}`, HK_SQLITE_NAMESPACE);
}

function text(value: SqlValue | undefined): string {
	return String(value ?? "").trim();
}

function nullableText(value: SqlValue | undefined): string | undefined {
	const output = text(value);
	return output.length > 0 ? output : undefined;
}

function hasText(value: string | undefined): boolean {
	return value !== undefined && value.trim().length > 0;
}

function numberValue(value: SqlValue | undefined): number {
	const output = Number(value ?? 0);
	return Number.isFinite(output) ? output : 0;
}

function integerText(value: SqlValue | undefined): string {
	return String(Math.trunc(numberValue(value)));
}

function cents(value: number): number {
	return Math.round(value * 100) / 100;
}

function sameMoney(left: number, right: number): boolean {
	return Math.abs(cents(left) - cents(right)) <= CENT_TOLERANCE;
}

function stripClosed(name: string): string {
	return name.replace(/\s*\(closed\)\s*$/i, "").trim();
}

function normalizeImportedTitle(name: string): string {
	return stripClosed(name)
		.replace(/~\d+~\d+$/g, "")
		.replace(/~/g, "-")
		.trim();
}

function normalizeLookup(name: string): string {
	return normalizeImportedTitle(name).toLowerCase().replace(/\s+/g, " ");
}

function missingAccountSourceRecordId(name: string): string {
	const normalized = normalizeLookup(name || "No Account")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `missing-${normalized || "no-account"}`;
}

function sourceBelongsTo(sourceId: string | undefined, currency: string, entity: string): boolean {
	if (!sourceId) return false;
	const parsed = parseSourceId(sourceId);
	return parsed?.currency === currency && parsed.entity === entity;
}

function dateLabel(timestamp: number): string {
	const date = new Date(timestamp);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
		date.getDate()
	).padStart(2, "0")}`;
}

function parseVoucherDate(row: SqlRow): { timestamp: number; source: DateParseSource } {
	const raw = text(row.VCHDATE);
	const withTime = /^(\d{1,2})\s+\d{1,2}:\d{2}:\d{2}\/(\d{1,2})\/(\d{4})$/.exec(raw);
	if (withTime) {
		return {
			timestamp: new Date(
				Number(withTime[3]),
				Number(withTime[2]) - 1,
				Number(withTime[1])
			).getTime(),
			source: "with-time",
		};
	}

	const dateOnly = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
	if (dateOnly) {
		return {
			timestamp: new Date(
				Number(dateOnly[3]),
				Number(dateOnly[2]) - 1,
				Number(dateOnly[1])
			).getTime(),
			source: "date-only",
		};
	}

	const year = numberValue(row.VCHYEAR);
	const month = numberValue(row.MONTH);
	const day = numberValue(row.VCHDAY);
	if (year > 0 && month > 0 && day > 0) {
		return {
			timestamp: new Date(year, month - 1, day).getTime(),
			source: "parts",
		};
	}

	throw new Error(`Voucher ${text(row.ID)} has no usable date.`);
}

function monthPeriod(year: number, month: number): string {
	return `${Math.trunc(year)}-${String(Math.trunc(month)).padStart(2, "0")}`;
}

function queryRows(database: SqlDatabase, sql: string): SqlRow[] {
	const result = database.exec(sql)[0];
	if (!result) return [];
	return result.values.map((values) =>
		Object.fromEntries(result.columns.map((column, index) => [column, values[index] ?? null]))
	);
}

function assertRequiredTables(database: SqlDatabase): void {
	const tables = new Set(
		queryRows(database, "SELECT name FROM sqlite_master WHERE type = 'table'").map((row) =>
			text(row.name)
		)
	);
	for (const table of ["HKBACCOUNT", "HKBCATEGORY", "HKBVOUCHER", "HKBBUDGET"]) {
		if (!tables.has(table)) {
			throw new Error(`Hysab Kytab table ${table} was not found in this database.`);
		}
	}
}

function mapBySourceId<T extends { sourceId?: string }>(
	records: T[],
	currency: string,
	entity: "account" | "category" | "voucher" | "budget"
): Map<string, T> {
	const output = new Map<string, T>();
	for (const record of records) {
		if (sourceBelongsTo(record.sourceId, currency, entity)) output.set(record.sourceId!, record);
	}
	return output;
}

function chooseAccountId(
	userId: string,
	sourceId: string,
	title: string,
	currency: string,
	existingBySource: Map<string, Account>,
	existingAccounts: Account[],
	claimedAccountIds: Set<string>
): string {
	const sourceMatch = existingBySource.get(sourceId);
	if (sourceMatch) return sourceMatch.id;

	const lookup = normalizeLookup(title);
	const nameMatch = existingAccounts.find(
		(account) =>
			!claimedAccountIds.has(account.id) &&
			!account.deletedAt &&
			normalizeLookup(account.title) === lookup &&
			account.currency.toUpperCase() === currency
	);
	if (nameMatch) return nameMatch.id;

	return stableId(userId, sourceId);
}

function chooseCategoryId(
	userId: string,
	sourceId: string,
	title: string,
	type: Category["type"],
	currency: string,
	existingBySource: Map<string, Category>,
	existingCategories: Category[],
	claimedCategoryIds: Set<string>
): string {
	const sourceMatch = existingBySource.get(sourceId);
	if (sourceMatch) return sourceMatch.id;

	const lookup = normalizeLookup(title);
	const nameMatch = existingCategories.find(
		(category) =>
			!claimedCategoryIds.has(category.id) &&
			!category.deletedAt &&
			normalizeLookup(category.title) === lookup &&
			category.type === type &&
			(!category.currency || category.currency.toUpperCase() === currency)
	);
	if (nameMatch) return nameMatch.id;

	return stableId(userId, sourceId);
}

function chooseBudgetId(
	userId: string,
	sourceId: string,
	categoryId: string,
	period: string,
	currency: string,
	existingBySource: Map<string, Budget>,
	existingBudgets: Budget[],
	claimedBudgetIds: Set<string>
): string {
	const sourceMatch = existingBySource.get(sourceId);
	if (sourceMatch) return sourceMatch.id;

	const periodMatch = existingBudgets.find(
		(budget) =>
			!claimedBudgetIds.has(budget.id) &&
			!budget.deletedAt &&
			budget.categoryId === categoryId &&
			budget.period === period &&
			(!budget.currency || budget.currency.toUpperCase() === currency)
	);
	if (periodMatch) return periodMatch.id;

	return stableId(userId, sourceId);
}

function chooseTransactionId(
	userId: string,
	sourceId: string,
	existingBySource: Map<string, Transaction>
): string {
	return existingBySource.get(sourceId)?.id ?? stableId(userId, sourceId);
}

function meaningfulRecord<T extends Record<string, unknown>>(record: T | undefined): T | undefined {
	if (!record) return undefined;
	const copy = { ...record };
	delete copy.updatedAt;
	delete copy.pendingSync;
	return copy;
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function recordsEqual<T extends Record<string, unknown>>(left: T | undefined, right: T): boolean {
	return stableStringify(meaningfulRecord(left)) === stableStringify(meaningfulRecord(right));
}

async function putIfChanged<T extends { id: string; updatedAt: number } & Record<string, unknown>>(
	table: { put: (record: T) => Promise<unknown> },
	existing: T | undefined,
	next: T,
	now: number
): Promise<"inserted" | "updated" | "unchanged"> {
	if (!existing) {
		await table.put(next);
		return "inserted";
	}

	const stableNext = { ...next, updatedAt: existing.updatedAt };
	if (recordsEqual(existing, stableNext)) return "unchanged";

	await table.put({ ...next, updatedAt: now });
	return "updated";
}

function addWriteResult(
	counts: { inserted: number; updated: number; unchanged: number },
	result: "inserted" | "updated" | "unchanged"
): void {
	counts[result]++;
}

function sourceAccountBalanceMap(accounts: AccountDraft[]): Map<string, number> {
	return new Map(
		accounts
			.filter((account) => account.sourceAccountId)
			.map((account) => [account.id, cents(account.expectedBalance)])
	);
}

function transactionAccountBalance(
	account: Account,
	transactions: ImportedTransaction[],
	accountsById: Map<string, Account>
): number {
	let balance = account.openingBalance;
	for (const transaction of transactions) {
		if (transaction.deletedAt) continue;
		if (transaction.type === "Income" && transaction.accountId === account.id) {
			balance += transaction.amount;
		} else if (transaction.type === "Expense" && transaction.accountId === account.id) {
			balance -= transaction.amount;
		} else if (transaction.type === "Transfer") {
			if (transaction.accountId === account.id) balance -= transaction.amount;
			if (transaction.toAccountId === account.id) {
				const source = accountsById.get(transaction.accountId);
				if (!source || source.currency === account.currency) balance += transaction.amount;
			}
		}
	}
	return cents(balance);
}

async function verifyImport(
	plan: InternalImportPlan,
	fallbackAccountId: string | undefined,
	reclassification: {
		count: number;
		incomeDelta: number;
		expenseDelta: number;
	}
): Promise<HysabKytabVerificationReport> {
	const [accounts, transactions] = await Promise.all([
		db.accounts.where("userId").equals(plan.userId).toArray(),
		db.transactions.where("userId").equals(plan.userId).toArray(),
	]);
	const importedTransactions = transactions.filter(
		(transaction) =>
			!transaction.deletedAt && sourceBelongsTo(transaction.sourceId, plan.currency, "voucher")
	) as ImportedTransaction[];
	const accountsById = new Map(accounts.map((account) => [account.id, account]));
	const incomeActual = cents(
		importedTransactions
			.filter((transaction) => transaction.type === "Income")
			.reduce((sum, transaction) => sum + transaction.amount, 0)
	);
	const expenseActual = cents(
		importedTransactions
			.filter((transaction) => transaction.type === "Expense")
			.reduce((sum, transaction) => sum + transaction.amount, 0)
	);
	let importedTransferNet = 0;
	let invalidImportedTransfers = 0;
	for (const transaction of importedTransactions) {
		if (transaction.type !== "Transfer") continue;
		importedTransferNet -= transaction.amount;
		if (!transaction.toAccountId || !accountsById.has(transaction.toAccountId)) {
			invalidImportedTransfers++;
			continue;
		}
		importedTransferNet += transaction.amount;
	}
	importedTransferNet = cents(importedTransferNet);
	const expectedIncome = cents(plan.summary.incomeTotal + reclassification.incomeDelta);
	const expectedExpense = cents(plan.summary.expenseTotal + reclassification.expenseDelta);

	const checks: HysabKytabVerificationCheck[] = [
		{
			label:
				reclassification.expenseDelta > 0
					? "Expense total after unpaired-transfer reclassification"
					: "Expense total",
			expected: expectedExpense,
			actual: expenseActual,
			difference: cents(expenseActual - expectedExpense),
			passed: sameMoney(expenseActual, expectedExpense),
		},
		{
			label:
				reclassification.incomeDelta > 0
					? "Income total after unpaired-transfer reclassification"
					: "Income total",
			expected: expectedIncome,
			actual: incomeActual,
			difference: cents(incomeActual - expectedIncome),
			passed: sameMoney(incomeActual, expectedIncome),
		},
		{
			label: "Imported transfer net",
			expected: 0,
			actual: importedTransferNet,
			difference: importedTransferNet,
			passed: sameMoney(importedTransferNet, 0) && invalidImportedTransfers === 0,
		},
	];

	const expectedBalances = sourceAccountBalanceMap(plan.accountDrafts);
	const accountBalances = [...expectedBalances.entries()]
		.map(([accountId, expected]) => {
			const account = accountsById.get(accountId);
			const actual = account
				? transactionAccountBalance(account, importedTransactions, accountsById)
				: 0;
			return {
				accountId,
				title: account?.title ?? accountId,
				expected,
				actual,
				difference: cents(actual - expected),
				passed: sameMoney(actual, expected),
			};
		})
		.sort(
			(a, b) => Math.abs(b.difference) - Math.abs(a.difference) || a.title.localeCompare(b.title)
		);
	const extraAccountBalances =
		fallbackAccountId && accountsById.has(fallbackAccountId)
			? [
					{
						accountId: fallbackAccountId,
						title: accountsById.get(fallbackAccountId)!.title,
						expected: 0,
						actual: transactionAccountBalance(
							accountsById.get(fallbackAccountId)!,
							importedTransactions,
							accountsById
						),
						difference: transactionAccountBalance(
							accountsById.get(fallbackAccountId)!,
							importedTransactions,
							accountsById
						),
						passed: true,
					},
				]
			: [];
	const expectedNetWorthDifference = cents(
		extraAccountBalances.reduce((sum, account) => sum + account.actual, 0)
	);
	const reclassificationSummary =
		reclassification.count > 0
			? `${reclassification.count} unpaired transfer${
					reclassification.count === 1 ? " was" : "s were"
				} reclassified at your instruction, changing income by ${reclassification.incomeDelta.toFixed(
					2
				)} ${plan.currency} and expenses by ${reclassification.expenseDelta.toFixed(2)} ${
					plan.currency
				}.`
			: undefined;

	return {
		passed:
			checks.every((check) => check.passed) && accountBalances.every((account) => account.passed),
		checks,
		accountBalances,
		sourceTransferLegNet: cents(plan.summary.sourceTransferLegNet),
		sourceTransferAnomalies: plan.sourceTransferAnomalies,
		importedTransferNet,
		invalidImportedTransfers,
		extraAccountBalances,
		expectedNetWorthDifference,
		reclassifiedUnpairedTransfers: reclassification.count,
		reclassifiedIncomeDelta: cents(reclassification.incomeDelta),
		reclassifiedExpenseDelta: cents(reclassification.expenseDelta),
		...(reclassificationSummary ? { reclassificationSummary } : {}),
		...(expectedNetWorthDifference !== 0
			? {
					expectedNetWorthDifferenceReason: `Resolved orphaned transfer legs are balanced against the fallback counterparty account, so MizanTrack net worth is ${Math.abs(
						expectedNetWorthDifference
					).toFixed(2)} ${plan.currency} lower than Hysab Kytab's inflated source total.`,
				}
			: {}),
	};
}

function createUnresolvedTransfer(
	row: SqlRow,
	account: AccountDraft,
	reason: string
): HysabKytabUnresolvedTransfer {
	const parsedDate = parseVoucherDate(row);
	const signedAmount = numberValue(row.VCHAMOUNT);
	const voucherId = integerText(row.ID);
	const currency = account.currency;

	return {
		voucherId,
		sourceId: buildHysabKytabSourceId(currency, "voucher", voucherId),
		date: parsedDate.timestamp,
		dateLabel: dateLabel(parsedDate.timestamp),
		amount: Math.abs(signedAmount),
		signedAmount,
		accountId: account.id,
		accountTitle: account.title,
		description: nullableText(row.DESCRIPTION) ?? "",
		direction: signedAmount < 0 ? "missing-destination" : "missing-source",
		reason,
	};
}

function unresolvedTransferReason(
	row: SqlRow,
	activeVoucherById: Map<string, SqlRow>,
	allTransferVoucherById: Map<string, SqlRow>,
	sameAccountPair = false
): string {
	if (sameAccountPair) {
		return "Its resolved counterparty uses the same source and destination account, which MizanTrack does not allow.";
	}

	const voucherId = integerText(row.ID);
	const refNo = text(row.REFNO);
	if (!refNo) return "REFNO is empty, so no counterparty voucher is identified.";
	if (refNo === voucherId) {
		return "REFNO points to this same voucher, so this is a single orphaned transfer leg.";
	}

	const activeCounterpart = activeVoucherById.get(refNo);
	const anyTransferCounterpart = allTransferVoucherById.get(refNo);
	if (!activeCounterpart) {
		if (anyTransferCounterpart && numberValue(anyTransferCounterpart.ACTIVE) !== 1) {
			return `REFNO points to voucher ${refNo}, but that counterpart is deleted/inactive.`;
		}
		return `REFNO points to voucher ${refNo}, but no active transfer counterpart exists.`;
	}
	if (text(activeCounterpart.VCHTYPE) !== "Transfer") {
		return `REFNO points to voucher ${refNo}, but that row is not a transfer.`;
	}
	if (text(activeCounterpart.REFNO) !== voucherId) {
		return `REFNO points to voucher ${refNo}, but that row does not point back to ${voucherId}.`;
	}
	if (!sameMoney(numberValue(row.VCHAMOUNT) + numberValue(activeCounterpart.VCHAMOUNT), 0)) {
		return `REFNO points to voucher ${refNo}, but the two amounts do not offset.`;
	}
	return `Voucher ${voucherId} could not be paired safely.`;
}

function accountChoice(account: AccountDraft | Account, fallback = false): HysabKytabAccountChoice {
	return {
		id: account.id,
		title: account.title,
		currency: account.currency,
		isArchived: account.isArchived,
		...(fallback ? { fallback: true } : {}),
	};
}

function buildFallbackAccount(
	userId: string,
	currency: string,
	existingAccounts: Account[]
): AccountDraft {
	const sourceId = buildHysabKytabSourceId(currency, "account", FALLBACK_ACCOUNT_SOURCE_RECORD_ID);
	const existingBySource = existingAccounts.find((account) => account.sourceId === sourceId);
	const existingByTitle = existingAccounts.find(
		(account) =>
			!account.deletedAt &&
			normalizeLookup(account.title) === normalizeLookup(FALLBACK_ACCOUNT_TITLE) &&
			account.currency.toUpperCase() === currency
	);
	const existing = existingBySource ?? existingByTitle;

	return {
		...(existing ?? {}),
		id: existing?.id ?? stableId(userId, sourceId),
		userId,
		title: FALLBACK_ACCOUNT_TITLE,
		openingBalance: 0,
		currency,
		isArchived: true,
		sourceId,
		updatedAt: existing?.updatedAt ?? Date.now(),
		expectedBalance: 0,
	};
}

function resolveAccountFromVoucher(
	row: SqlRow,
	userId: string,
	currency: string,
	accountBySourceRecordId: Map<string, AccountDraft>,
	accountByName: Map<string, AccountDraft>,
	accountDrafts: AccountDraft[],
	existingAccounts: Account[],
	existingAccountsBySource: Map<string, Account>,
	claimedAccountIds: Set<string>
): AccountDraft {
	const sourceAccountId = integerText(row.ACCOUNTID);
	const bySource = accountBySourceRecordId.get(sourceAccountId);
	if (bySource) return bySource;

	const accountName = normalizeImportedTitle(text(row.ACCOUNTNAME) || "No Account");
	const byName = accountByName.get(normalizeLookup(accountName));
	if (byName) return byName;

	const sourceRecordId = missingAccountSourceRecordId(accountName);
	const sourceId = buildHysabKytabSourceId(currency, "account", sourceRecordId);
	const id = chooseAccountId(
		userId,
		sourceId,
		accountName,
		currency,
		existingAccountsBySource,
		existingAccounts,
		claimedAccountIds
	);
	claimedAccountIds.add(id);
	const existing = existingAccounts.find((account) => account.id === id);
	const account: AccountDraft = {
		...(existing ?? {}),
		id,
		userId,
		title: accountName,
		openingBalance: existing?.openingBalance ?? 0,
		currency,
		isArchived: true,
		sourceId,
		updatedAt: existing?.updatedAt ?? Date.now(),
		expectedBalance: 0,
	};
	accountDrafts.push(account);
	accountBySourceRecordId.set(sourceRecordId, account);
	accountByName.set(normalizeLookup(accountName), account);
	return account;
}

export function isHysabKytabSqliteFile(file: File): boolean {
	return /\.db$/i.test(file.name) || file.type === "application/x-sqlite3";
}

export async function prepareHysabKytabSqliteImport(
	file: File,
	userId: string,
	targetCurrency: string
): Promise<HysabKytabSqliteImportPlan> {
	const currency = normalizeCurrency(targetCurrency);
	const SQL = await loadSqlJs();
	const database = new SQL.Database(new Uint8Array(await file.arrayBuffer()));
	try {
		assertRequiredTables(database);

		const [existingAccounts, existingCategories, existingTransactions, existingBudgets] =
			await Promise.all([
				db.accounts.where("userId").equals(userId).toArray(),
				db.categories.where("userId").equals(userId).toArray(),
				db.transactions.where("userId").equals(userId).toArray(),
				db.budgets.where("userId").equals(userId).toArray(),
			]);
		const existingAccountsBySource = mapBySourceId(existingAccounts, currency, "account");
		const existingCategoriesBySource = mapBySourceId(existingCategories, currency, "category");
		const existingTransactionsBySource = mapBySourceId(existingTransactions, currency, "voucher");
		const existingBudgetsBySource = mapBySourceId(existingBudgets, currency, "budget");
		const existingAccountsById = new Map(existingAccounts.map((account) => [account.id, account]));
		const existingCategoriesById = new Map(
			existingCategories.map((category) => [category.id, category])
		);
		const existingTransactionsById = new Map(
			existingTransactions.map((transaction) => [transaction.id, transaction])
		);
		const existingBudgetsById = new Map(existingBudgets.map((budget) => [budget.id, budget]));
		const claimedAccountIds = new Set<string>();
		const claimedCategoryIds = new Set<string>();
		const claimedBudgetIds = new Set<string>();

		const accountRows = queryRows(database, "SELECT * FROM HKBACCOUNT ORDER BY ID");
		const accountDrafts: AccountDraft[] = [];
		const accountBySourceRecordId = new Map<string, AccountDraft>();
		const accountByName = new Map<string, AccountDraft>();

		for (const row of accountRows) {
			const sourceAccountId = integerText(row.ID);
			const sourceId = buildHysabKytabSourceId(currency, "account", sourceAccountId);
			const title = normalizeImportedTitle(text(row.TITLE) || `Account ${sourceAccountId}`);
			const id = chooseAccountId(
				userId,
				sourceId,
				title,
				currency,
				existingAccountsBySource,
				existingAccounts,
				claimedAccountIds
			);
			claimedAccountIds.add(id);
			const existing = existingAccountsById.get(id);
			const importedIcon = resolveHysabKytabAccountIcon(title, {
				boxIcon: nullableText(row.BOXICON),
				accountType: nullableText(row.ACCTYPE),
				bankName: nullableText(row.BANKNAME),
				currency,
			});
			const importedColor = normalizeHysabKytabColor(nullableText(row.BOXCOLOR));
			const account: AccountDraft = {
				...(existing ?? {}),
				id,
				userId,
				title,
				openingBalance: numberValue(row.OPENINGBALANCE),
				currency,
				...(hasText(existing?.icon) ? {} : { icon: importedIcon }),
				...(hasText(existing?.color) || !importedColor ? {} : { color: importedColor }),
				isArchived: numberValue(row.ACTIVE) !== 1,
				sourceId,
				updatedAt: existing?.updatedAt ?? Date.now(),
				expectedBalance: numberValue(row.OPENINGBALANCE),
				sourceAccountId,
			};
			accountDrafts.push(account);
			accountBySourceRecordId.set(sourceAccountId, account);
			if (!accountByName.has(normalizeLookup(title)))
				accountByName.set(normalizeLookup(title), account);
		}

		const categoryRows = queryRows(database, "SELECT * FROM HKBCATEGORY ORDER BY ID");
		const categoryDrafts: CategoryDraft[] = [];
		const categoryBySourceRecordId = new Map<string, CategoryDraft>();

		for (const row of categoryRows) {
			const sourceCategoryId = integerText(row.ID);
			const sourceId = buildHysabKytabSourceId(currency, "category", sourceCategoryId);
			const title = normalizeImportedTitle(text(row.TITILE) || `Category ${sourceCategoryId}`);
			const type: Category["type"] = numberValue(row.ISEXPENSE) === 1 ? "Expense" : "Income";
			const id = chooseCategoryId(
				userId,
				sourceId,
				title,
				type,
				currency,
				existingCategoriesBySource,
				existingCategories,
				claimedCategoryIds
			);
			claimedCategoryIds.add(id);
			const existing = existingCategoriesById.get(id);
			const active = numberValue(row.ACTIVE) === 1;
			const importedIcon = resolveHysabKytabCategoryIcon(title, nullableText(row.BOXICON));
			const importedColor = normalizeHysabKytabColor(nullableText(row.BOXCOLOR));
			const category: CategoryDraft = {
				...(existing ?? {}),
				id,
				userId,
				title,
				type,
				currency,
				...(hasText(existing?.icon) ? {} : { icon: importedIcon }),
				...(hasText(existing?.color) || !importedColor ? {} : { color: importedColor }),
				sourceId,
				updatedAt: existing?.updatedAt ?? Date.now(),
				...(active ? { deletedAt: undefined } : { deletedAt: existing?.deletedAt ?? Date.now() }),
				sourceCategoryId,
				sourceParentId: numberValue(row.PARENTID) > 0 ? integerText(row.PARENTID) : undefined,
				active,
			};
			categoryDrafts.push(category);
			categoryBySourceRecordId.set(sourceCategoryId, category);
		}

		for (const category of categoryDrafts) {
			const parent = category.sourceParentId
				? categoryBySourceRecordId.get(category.sourceParentId)
				: undefined;
			if (parent) category.parentId = parent.id;
		}

		const voucherRows = queryRows(
			database,
			"SELECT * FROM HKBVOUCHER WHERE ACTIVE = 1 ORDER BY ID"
		);
		const voucherById = new Map(voucherRows.map((row) => [integerText(row.ID), row]));
		const allTransferVoucherById = new Map(
			queryRows(database, "SELECT * FROM HKBVOUCHER WHERE VCHTYPE = 'Transfer' ORDER BY ID").map(
				(row) => [integerText(row.ID), row]
			)
		);
		const processedTransferVoucherIds = new Set<string>();
		const transactionDrafts: TransactionDraft[] = [];
		const unresolvedTransfers: HysabKytabUnresolvedTransfer[] = [];
		const sourceTransferAnomalies: HysabKytabUnresolvedTransfer[] = [];
		const dateFormats: Record<DateParseSource, number> = {
			"with-time": 0,
			"date-only": 0,
			parts: 0,
		};
		let incomeTotal = 0;
		let expenseTotal = 0;
		let sourceTransferLegNet = 0;
		let incomeRows = 0;
		let expenseRows = 0;
		let transferLegs = 0;
		let transfersPaired = 0;

		for (const row of voucherRows) {
			const parsedDate = parseVoucherDate(row);
			dateFormats[parsedDate.source]++;
			const account = resolveAccountFromVoucher(
				row,
				userId,
				currency,
				accountBySourceRecordId,
				accountByName,
				accountDrafts,
				existingAccounts,
				existingAccountsBySource,
				claimedAccountIds
			);
			account.expectedBalance = cents(account.expectedBalance + numberValue(row.VCHAMOUNT));
		}

		for (const row of voucherRows) {
			const voucherType = text(row.VCHTYPE);
			const amount = numberValue(row.VCHAMOUNT);
			if (voucherType === "Income") {
				incomeRows++;
				incomeTotal += Math.abs(amount);
			} else if (voucherType === "Expense") {
				expenseRows++;
				expenseTotal += Math.abs(amount);
			} else if (voucherType === "Transfer") {
				transferLegs++;
				sourceTransferLegNet += amount;
			}
		}

		for (const row of voucherRows) {
			if (text(row.VCHTYPE) === "Transfer") continue;
			const sourceVoucherId = integerText(row.ID);
			const sourceId = buildHysabKytabSourceId(currency, "voucher", sourceVoucherId);
			const parsedDate = parseVoucherDate(row);
			const account = resolveAccountFromVoucher(
				row,
				userId,
				currency,
				accountBySourceRecordId,
				accountByName,
				accountDrafts,
				existingAccounts,
				existingAccountsBySource,
				claimedAccountIds
			);
			const sourceCategoryId = integerText(row.CATEGORYID);
			const category = categoryBySourceRecordId.get(sourceCategoryId);
			const type = text(row.VCHTYPE) as "Income" | "Expense";
			transactionDrafts.push({
				...(existingTransactionsBySource.get(sourceId) ?? {}),
				id: chooseTransactionId(userId, sourceId, existingTransactionsBySource),
				userId,
				type,
				date: parsedDate.timestamp,
				amount: Math.abs(numberValue(row.VCHAMOUNT)),
				description: nullableText(row.DESCRIPTION) ?? "",
				accountId: account.id,
				...(category ? { categoryId: category.id } : {}),
				...(nullableText(row.TAG)
					? {
							tags: nullableText(row.TAG)!
								.split(",")
								.map((tag) => tag.trim())
								.filter(Boolean),
						}
					: { tags: [] }),
				...(nullableText(row.VCHTRXPLACE) ? { place: nullableText(row.VCHTRXPLACE) } : {}),
				currency,
				sourceId,
				updatedAt: existingTransactionsBySource.get(sourceId)?.updatedAt ?? Date.now(),
				sourceVoucherId,
				sourceVoucherIds: [sourceVoucherId],
			});
		}

		for (const row of voucherRows) {
			if (text(row.VCHTYPE) !== "Transfer") continue;
			const voucherId = integerText(row.ID);
			if (processedTransferVoucherIds.has(voucherId)) continue;

			const refNo = text(row.REFNO);
			const counterpart = voucherById.get(refNo);
			const amount = numberValue(row.VCHAMOUNT);
			const counterpartAmount = counterpart ? numberValue(counterpart.VCHAMOUNT) : 0;
			const mutual =
				counterpart &&
				integerText(counterpart.ID) !== voucherId &&
				text(counterpart.REFNO) === voucherId &&
				text(counterpart.VCHTYPE) === "Transfer";
			const amountMatched = mutual && sameMoney(amount + counterpartAmount, 0);

			if (counterpart && mutual && amountMatched) {
				const sourceRow = amount < 0 ? row : counterpart;
				const destinationRow = amount < 0 ? counterpart : row;
				const sourceVoucherId = integerText(sourceRow.ID);
				const destinationVoucherId = integerText(destinationRow.ID);
				const sourceId = buildHysabKytabSourceId(currency, "voucher", sourceVoucherId);
				const parsedDate = parseVoucherDate(sourceRow);
				const sourceAccount = resolveAccountFromVoucher(
					sourceRow,
					userId,
					currency,
					accountBySourceRecordId,
					accountByName,
					accountDrafts,
					existingAccounts,
					existingAccountsBySource,
					claimedAccountIds
				);
				const destinationAccount = resolveAccountFromVoucher(
					destinationRow,
					userId,
					currency,
					accountBySourceRecordId,
					accountByName,
					accountDrafts,
					existingAccounts,
					existingAccountsBySource,
					claimedAccountIds
				);
				if (sourceAccount.id === destinationAccount.id) {
					const unresolved = createUnresolvedTransfer(
						row,
						amount < 0 ? sourceAccount : destinationAccount,
						unresolvedTransferReason(row, voucherById, allTransferVoucherById, true)
					);
					unresolvedTransfers.push(unresolved);
					sourceTransferAnomalies.push(unresolved);
					processedTransferVoucherIds.add(voucherId);
					continue;
				}
				transactionDrafts.push({
					...(existingTransactionsBySource.get(sourceId) ?? {}),
					id: chooseTransactionId(userId, sourceId, existingTransactionsBySource),
					userId,
					type: "Transfer",
					date: parsedDate.timestamp,
					amount: Math.abs(numberValue(sourceRow.VCHAMOUNT)),
					description:
						nullableText(sourceRow.DESCRIPTION) ??
						nullableText(destinationRow.DESCRIPTION) ??
						`Transfer to ${destinationAccount.title}`,
					accountId: sourceAccount.id,
					toAccountId: destinationAccount.id,
					currency,
					sourceId,
					updatedAt: existingTransactionsBySource.get(sourceId)?.updatedAt ?? Date.now(),
					sourceVoucherId,
					sourceVoucherIds: [sourceVoucherId, destinationVoucherId],
				});
				processedTransferVoucherIds.add(sourceVoucherId);
				processedTransferVoucherIds.add(destinationVoucherId);
				transfersPaired++;
				continue;
			}

			const account = resolveAccountFromVoucher(
				row,
				userId,
				currency,
				accountBySourceRecordId,
				accountByName,
				accountDrafts,
				existingAccounts,
				existingAccountsBySource,
				claimedAccountIds
			);
			const unresolved = createUnresolvedTransfer(
				row,
				account,
				unresolvedTransferReason(row, voucherById, allTransferVoucherById)
			);
			unresolvedTransfers.push(unresolved);
			sourceTransferAnomalies.push(unresolved);
			processedTransferVoucherIds.add(voucherId);
		}

		const budgetRows = queryRows(database, "SELECT * FROM HKBBUDGET ORDER BY ID");
		const budgetDrafts: BudgetDraft[] = [];
		for (const row of budgetRows) {
			const sourceBudgetId = integerText(row.ID);
			const sourceId = buildHysabKytabSourceId(currency, "budget", sourceBudgetId);
			const sourceCategoryId = integerText(row.CATEGORYID);
			const category = categoryBySourceRecordId.get(sourceCategoryId);
			if (!category) continue;
			const period = monthPeriod(numberValue(row.BUDGETYEAR), numberValue(row.BUDGETMONTH));
			const id = chooseBudgetId(
				userId,
				sourceId,
				category.id,
				period,
				currency,
				existingBudgetsBySource,
				existingBudgets,
				claimedBudgetIds
			);
			claimedBudgetIds.add(id);
			const existing = existingBudgetsById.get(id);
			budgetDrafts.push({
				...(existing ?? {}),
				id,
				userId,
				categoryId: category.id,
				period,
				amount: Math.abs(numberValue(row.BUDGETVALUE)),
				currency,
				active: numberValue(row.ACTIVE) === 1,
				sourceId,
				updatedAt: existing?.updatedAt ?? Date.now(),
				sourceBudgetId,
			});
		}

		const fallbackDraft = buildFallbackAccount(userId, currency, existingAccounts);
		const choicesById = new Map<string, HysabKytabAccountChoice>();
		for (const account of [...accountDrafts, ...existingAccounts]) {
			if (account.deletedAt) continue;
			if (normalizeCurrency(account.currency) !== currency) continue;
			choicesById.set(account.id, accountChoice(account));
		}
		choicesById.set(fallbackDraft.id, accountChoice(fallbackDraft, true));

		const publicPlan: HysabKytabSqliteImportPlan = {
			kind: "sqlite",
			fileName: file.name,
			userId,
			currency,
			summary: {
				currency,
				accounts: accountRows.length,
				categories: categoryRows.length,
				budgets: budgetRows.length,
				activeVouchers: voucherRows.length,
				incomeRows,
				expenseRows,
				transferLegs,
				transfersPaired,
				unresolvedTransfers: unresolvedTransfers.length,
				incomeTotal: cents(incomeTotal),
				expenseTotal: cents(expenseTotal),
				sourceTransferLegNet: cents(sourceTransferLegNet),
				dateFormats,
			},
			unresolvedTransfers,
			accountChoices: [...choicesById.values()].sort(
				(a, b) =>
					Number(a.fallback ?? false) - Number(b.fallback ?? false) ||
					a.title.localeCompare(b.title)
			),
			fallbackAccount: accountChoice(fallbackDraft, true),
		};
		const internalPlan: InternalImportPlan = {
			...publicPlan,
			accountDrafts,
			categoryDrafts,
			transactionDrafts,
			budgetDrafts,
			expectedAccountBalances: sourceAccountBalanceMap(accountDrafts),
			sourceAccountIdByAppId: new Map(
				accountDrafts
					.filter((account) => account.sourceAccountId)
					.map((account) => [account.id, account.sourceAccountId!])
			),
			sourceTransferAnomalies,
			existingAccountsById,
			existingCategoriesById,
			existingTransactionsById,
			existingBudgetsById,
		};
		internalPlans.set(publicPlan, internalPlan);
		return publicPlan;
	} finally {
		database.close();
	}
}

function internalPlanFor(plan: HysabKytabSqliteImportPlan): InternalImportPlan {
	const internal = internalPlans.get(plan);
	if (!internal) {
		throw new Error("This import plan is no longer available. Please choose the .db file again.");
	}
	return internal;
}

function resolutionMode(
	unresolved: HysabKytabUnresolvedTransfer,
	resolutions: HysabKytabTransferResolutionInput
): HysabKytabResolutionMode {
	if (resolutions.useReclassificationForAll === true) return "reclassified";
	if (resolutions.useFallbackForAll === true) return "counterparty";
	const selected = resolutions.byVoucherId?.[unresolved.voucherId];
	if (selected === HYSAB_KYTAB_RECLASSIFY_RESOLUTION) return "reclassified";
	return "counterparty";
}

function resolvedCounterpartyId(
	unresolved: HysabKytabUnresolvedTransfer,
	resolutions: HysabKytabTransferResolutionInput,
	fallbackAccountId: string
): string {
	if (resolutions.useFallbackForAll === true) return fallbackAccountId;
	if (resolutions.useReclassificationForAll === true) {
		throw new Error(`Unresolved transfer ${unresolved.voucherId} is being reclassified.`);
	}
	const selected = resolutions.byVoucherId?.[unresolved.voucherId];
	if (!selected) {
		throw new Error(`Choose an account for unresolved transfer ${unresolved.voucherId}.`);
	}
	if (selected === HYSAB_KYTAB_RECLASSIFY_RESOLUTION) {
		throw new Error(`Unresolved transfer ${unresolved.voucherId} is being reclassified.`);
	}
	if (selected === unresolved.accountId) {
		throw new Error(
			`Unresolved transfer ${unresolved.voucherId} cannot use the same source and destination account.`
		);
	}
	return selected;
}

function buildResolvedTransferDrafts(
	plan: InternalImportPlan,
	resolutions: HysabKytabTransferResolutionInput,
	fallbackAccountId: string
): {
	drafts: TransactionDraft[];
	reclassification: { count: number; incomeDelta: number; expenseDelta: number };
} {
	const reclassification = { count: 0, incomeDelta: 0, expenseDelta: 0 };
	const drafts = plan.unresolvedTransfers.map((unresolved): TransactionDraft => {
		const existing = [...plan.existingTransactionsById.values()].find(
			(transaction) => transaction.sourceId === unresolved.sourceId
		);
		const id = existing?.id ?? stableId(plan.userId, unresolved.sourceId);

		if (resolutionMode(unresolved, resolutions) === "reclassified") {
			const type: "Income" | "Expense" = unresolved.signedAmount >= 0 ? "Income" : "Expense";
			reclassification.count++;
			if (type === "Income") {
				reclassification.incomeDelta = cents(reclassification.incomeDelta + unresolved.amount);
			} else {
				reclassification.expenseDelta = cents(reclassification.expenseDelta + unresolved.amount);
			}

			return {
				...(existing ?? {}),
				id,
				userId: plan.userId,
				type,
				date: unresolved.date,
				amount: unresolved.amount,
				description:
					unresolved.description || `[HK unpaired transfer reclassified as ${type.toLowerCase()}]`,
				accountId: unresolved.accountId,
				currency: plan.currency,
				sourceId: unresolved.sourceId,
				updatedAt: existing?.updatedAt ?? Date.now(),
				sourceVoucherId: unresolved.voucherId,
				sourceVoucherIds: [unresolved.voucherId],
			};
		}

		const counterpartyId = resolvedCounterpartyId(unresolved, resolutions, fallbackAccountId);
		return {
			...(existing ?? {}),
			id,
			userId: plan.userId,
			type: "Transfer" as const,
			date: unresolved.date,
			amount: unresolved.amount,
			description: unresolved.description || "[HK unresolved transfer]",
			accountId:
				unresolved.direction === "missing-destination" ? unresolved.accountId : counterpartyId,
			toAccountId:
				unresolved.direction === "missing-destination" ? counterpartyId : unresolved.accountId,
			currency: plan.currency,
			sourceId: unresolved.sourceId,
			updatedAt: existing?.updatedAt ?? Date.now(),
			sourceVoucherId: unresolved.voucherId,
			sourceVoucherIds: [unresolved.voucherId],
		};
	});
	return { drafts, reclassification };
}

export async function commitHysabKytabSqliteImport(
	plan: HysabKytabSqliteImportPlan,
	resolutions: HysabKytabTransferResolutionInput = {}
): Promise<HysabKytabSqliteImportResult> {
	const internal = internalPlanFor(plan);
	const fallbackDraft = buildFallbackAccount(internal.userId, internal.currency, [
		...internal.existingAccountsById.values(),
	]);
	const usesFallback = internal.unresolvedTransfers.some(
		(unresolved) =>
			resolutions.useFallbackForAll === true ||
			resolutions.byVoucherId?.[unresolved.voucherId] === fallbackDraft.id
	);
	const resolvedTransfers = buildResolvedTransferDrafts(internal, resolutions, fallbackDraft.id);
	const resolvedTransferDrafts = resolvedTransfers.drafts;
	const allAccountDrafts = usesFallback
		? [...internal.accountDrafts, fallbackDraft]
		: internal.accountDrafts;
	const allTransactionDrafts = [...internal.transactionDrafts, ...resolvedTransferDrafts];
	const autoCreatedAccounts = allAccountDrafts
		.filter(
			(account) =>
				!internal.existingAccountsById.has(account.id) &&
				(!account.sourceAccountId || account.id === fallbackDraft.id)
		)
		.map((account) => account.title);
	const writeCounts = { inserted: 0, updated: 0, unchanged: 0 };
	const fallbackAccountId: string | undefined = usesFallback ? fallbackDraft.id : undefined;

	await db.transaction("rw", db.accounts, db.categories, db.transactions, db.budgets, async () => {
		const now = Date.now();
		for (const account of allAccountDrafts) {
			const {
				expectedBalance: _expectedBalance,
				sourceAccountId: _sourceAccountId,
				...record
			} = account;
			addWriteResult(
				writeCounts,
				await putIfChanged(
					db.accounts as unknown as {
						put: (record: Account & Record<string, unknown>) => Promise<unknown>;
					},
					internal.existingAccountsById.get(record.id) as
						| (Account & Record<string, unknown>)
						| undefined,
					record as Account & Record<string, unknown>,
					now
				)
			);
		}

		for (const category of internal.categoryDrafts) {
			const {
				sourceCategoryId: _sourceCategoryId,
				sourceParentId: _sourceParentId,
				active: _active,
				...record
			} = category;
			addWriteResult(
				writeCounts,
				await putIfChanged(
					db.categories as unknown as {
						put: (record: Category & Record<string, unknown>) => Promise<unknown>;
					},
					internal.existingCategoriesById.get(record.id) as
						| (Category & Record<string, unknown>)
						| undefined,
					record as Category & Record<string, unknown>,
					now
				)
			);
		}

		for (const transaction of allTransactionDrafts) {
			const {
				sourceVoucherId: _sourceVoucherId,
				sourceVoucherIds: _sourceVoucherIds,
				...record
			} = transaction;
			addWriteResult(
				writeCounts,
				await putIfChanged(
					db.transactions as unknown as {
						put: (record: ImportedTransaction & Record<string, unknown>) => Promise<unknown>;
					},
					internal.existingTransactionsById.get(record.id) as
						| (ImportedTransaction & Record<string, unknown>)
						| undefined,
					record as ImportedTransaction & Record<string, unknown>,
					now
				)
			);
		}

		for (const budget of internal.budgetDrafts) {
			const { sourceBudgetId: _sourceBudgetId, ...record } = budget;
			addWriteResult(
				writeCounts,
				await putIfChanged(
					db.budgets as unknown as {
						put: (record: Budget & Record<string, unknown>) => Promise<unknown>;
					},
					internal.existingBudgetsById.get(record.id) as
						| (Budget & Record<string, unknown>)
						| undefined,
					record as Budget & Record<string, unknown>,
					now
				)
			);
		}
	});

	const verification = await verifyImport(
		internal,
		fallbackAccountId,
		resolvedTransfers.reclassification
	);
	scheduleAnalyticsRecompute(internal.userId);

	return {
		accounts: internal.accountDrafts.length + (usesFallback ? 1 : 0),
		categories: internal.categoryDrafts.length,
		budgets: internal.budgetDrafts.length,
		transactions: allTransactionDrafts.length,
		transfersPaired: internal.summary.transfersPaired,
		unresolvedTransfersResolved: resolvedTransferDrafts.length,
		autoCreated: autoCreatedAccounts.length,
		autoCreatedAccounts,
		inserted: writeCounts.inserted,
		updated: writeCounts.updated,
		unchanged: writeCounts.unchanged,
		verification,
		summary: internal.summary,
	};
}

export async function importHysabKytabSqlite(
	file: File,
	userId: string,
	targetCurrency: string
): Promise<HysabKytabSqliteImportResult> {
	const plan = await prepareHysabKytabSqliteImport(file, userId, targetCurrency);
	if (plan.unresolvedTransfers.length > 0) {
		throw new Error("Resolve unresolved Hysab Kytab transfers before importing this database.");
	}
	return commitHysabKytabSqliteImport(plan);
}
