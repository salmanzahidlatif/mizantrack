import { invalidateAnalyticsCache } from "@/lib/analytics/cache";
import { scheduleAnalyticsRecompute } from "@/lib/analytics/scheduleRecompute";
import { getCurrencyByCode } from "@/lib/currencies";
import { CORE_SYNC_TABLES, type SyncableTable } from "@/lib/db/sync";

import { db } from "./local";

import type { Account, Transaction } from "@/types";

type ResetLocalDataScope =
	| { type: "all" }
	| { type: "currency"; currency: string; enabledCurrencies?: readonly string[] };

export interface ResetLocalDataPreview {
	scope: "all" | "currency";
	currency?: string;
	accountsDeleted: number;
	categoriesDeleted: number;
	transactionsDeleted: number;
	dashboardStatsCleared: number;
	categoriesReseeded: number;
	sharedCategoriesKept: number;
	otherCurrencyCategoriesKept: number;
	accountsKeptBlankCurrency: number;
	accountsKeptUnknownCurrency: number;
	accountsKeptNonEnabledCurrency: number;
	transactionsDeletedCrossCurrencyTransfers: number;
	goldItemsKept: number;
	zakatCalculationsKept: number;
	zakatPaymentsKept: number;
	syncTablesReset: SyncableTable[];
}

export interface ResetLocalDataResult extends ResetLocalDataPreview {}

interface ResetLocalDataPlan extends ResetLocalDataPreview {
	accountIdsToDelete: string[];
	categoryIdsToDelete: string[];
	transactionIdsToDelete: string[];
}

function normalizeCurrency(value: string | undefined): string {
	return value?.trim().toUpperCase() ?? "";
}

function getPerTableSyncKey(table: SyncableTable): string {
	return `lastSync:${table}`;
}

function getPerTableMigrationKey(table: SyncableTable): string {
	return `syncedAtMigration:${table}:v1`;
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values)];
}

async function getEnabledCurrencySet(
	userId: string,
	explicitEnabledCurrencies: readonly string[] | undefined
): Promise<Set<string>> {
	const config = explicitEnabledCurrencies ? undefined : await db.dbConfig.get(userId);
	const enabledCurrencies =
		explicitEnabledCurrencies ??
		config?.enabledCurrencies ??
		(config?.currency ? [config.currency] : []);

	return new Set(enabledCurrencies.map(normalizeCurrency).filter(Boolean));
}

async function resetSyncPullState(tables: readonly SyncableTable[]): Promise<void> {
	await db.syncMeta.bulkDelete(tables.map(getPerTableMigrationKey));
	await db.syncMeta.bulkPut([
		{ id: "lastSync", timestamp: 0 },
		...tables.map((table) => ({ id: getPerTableSyncKey(table), timestamp: 0 })),
	]);
}

function isKnownCurrency(currency: string): boolean {
	return Boolean(getCurrencyByCode(currency));
}

function countAccountsKeptForSafety(
	accounts: Account[],
	targetCurrency: string | undefined,
	enabledCurrencies: Set<string>
) {
	let blank = 0;
	let unknown = 0;
	let nonEnabled = 0;

	for (const account of accounts) {
		const currency = normalizeCurrency(account.currency);
		if (!currency) {
			blank++;
			continue;
		}
		if (!isKnownCurrency(currency)) {
			unknown++;
			continue;
		}
		if (
			targetCurrency &&
			enabledCurrencies.size > 0 &&
			!enabledCurrencies.has(currency) &&
			currency !== targetCurrency
		) {
			nonEnabled++;
		}
	}

	return { blank, unknown, nonEnabled };
}

function isTargetAccount(account: Account, targetCurrency: string, enabledCurrencies: Set<string>) {
	const currency = normalizeCurrency(account.currency);
	if (!currency) return false;
	if (!isKnownCurrency(currency)) return false;
	if (enabledCurrencies.size > 0 && !enabledCurrencies.has(currency)) return false;
	return currency === targetCurrency;
}

function transactionTouchesAccountIds(transaction: Transaction, accountIds: Set<string>): boolean {
	return (
		accountIds.has(transaction.accountId) ||
		Boolean(transaction.toAccountId && accountIds.has(transaction.toAccountId))
	);
}

function isCrossCurrencyTransferDeleted(
	transaction: Transaction,
	accountIdsToDelete: Set<string>,
	accountsById: Map<string, Account>,
	targetCurrency: string
): boolean {
	if (transaction.type !== "Transfer") return false;
	const sourceIsTarget = accountIdsToDelete.has(transaction.accountId);
	const destinationIsTarget = Boolean(
		transaction.toAccountId && accountIdsToDelete.has(transaction.toAccountId)
	);
	if (sourceIsTarget === destinationIsTarget) return false;

	const otherAccountId = sourceIsTarget ? transaction.toAccountId : transaction.accountId;
	if (!otherAccountId) return false;

	const otherAccount = accountsById.get(otherAccountId);
	const otherCurrency = normalizeCurrency(otherAccount?.currency);
	return otherCurrency !== targetCurrency;
}

async function buildAllResetPlan(userId: string): Promise<ResetLocalDataPlan> {
	const [
		accounts,
		categories,
		transactions,
		dashboardStats,
		goldItemsKept,
		zakatCalculationsKept,
		zakatPaymentsKept,
	] = await Promise.all([
		db.accounts.where("userId").equals(userId).toArray(),
		db.categories.where("userId").equals(userId).toArray(),
		db.transactions.where("userId").equals(userId).toArray(),
		db.dashboardStats.get(userId),
		db.goldItems.where("userId").equals(userId).count(),
		db.zakatCalculations.where("userId").equals(userId).count(),
		db.zakatPayments.where("userId").equals(userId).count(),
	]);

	return {
		scope: "all",
		accountsDeleted: accounts.length,
		categoriesDeleted: categories.length,
		transactionsDeleted: transactions.length,
		dashboardStatsCleared: dashboardStats ? 1 : 0,
		categoriesReseeded: 0,
		sharedCategoriesKept: 0,
		otherCurrencyCategoriesKept: 0,
		accountsKeptBlankCurrency: 0,
		accountsKeptUnknownCurrency: 0,
		accountsKeptNonEnabledCurrency: 0,
		transactionsDeletedCrossCurrencyTransfers: 0,
		goldItemsKept,
		zakatCalculationsKept,
		zakatPaymentsKept,
		syncTablesReset: [...CORE_SYNC_TABLES],
		accountIdsToDelete: accounts.map((account) => account.id),
		categoryIdsToDelete: categories.map((category) => category.id),
		transactionIdsToDelete: transactions.map((transaction) => transaction.id),
	};
}

async function buildCurrencyResetPlan(
	userId: string,
	currency: string,
	explicitEnabledCurrencies?: readonly string[]
): Promise<ResetLocalDataPlan> {
	const targetCurrency = normalizeCurrency(currency);
	if (!targetCurrency) {
		throw new Error("Choose a currency before resetting local data.");
	}
	if (!isKnownCurrency(targetCurrency)) {
		throw new Error(`${targetCurrency} is not a recognized currency in MizanTrack.`);
	}

	const enabledCurrencies = await getEnabledCurrencySet(userId, explicitEnabledCurrencies);
	if (enabledCurrencies.size > 0 && !enabledCurrencies.has(targetCurrency)) {
		throw new Error(
			`${targetCurrency} is not enabled in Settings. Enable it before using a scoped reset.`
		);
	}

	const [
		accounts,
		categories,
		transactions,
		dashboardStats,
		goldItemsKept,
		zakatCalculationsKept,
		zakatPaymentsKept,
	] = await Promise.all([
		db.accounts.where("userId").equals(userId).toArray(),
		db.categories.where("userId").equals(userId).toArray(),
		db.transactions.where("userId").equals(userId).toArray(),
		db.dashboardStats.get(userId),
		db.goldItems.where("userId").equals(userId).count(),
		db.zakatCalculations.where("userId").equals(userId).count(),
		db.zakatPayments.where("userId").equals(userId).count(),
	]);

	const accountsById = new Map(accounts.map((account) => [account.id, account]));
	const accountIdsToDelete = accounts
		.filter((account) => isTargetAccount(account, targetCurrency, enabledCurrencies))
		.map((account) => account.id);
	const accountIdDeleteSet = new Set(accountIdsToDelete);
	const categoryIdsToDelete = categories
		.filter((category) => normalizeCurrency(category.currency) === targetCurrency)
		.map((category) => category.id);
	const transactionIdsToDelete = transactions
		.filter((transaction) => transactionTouchesAccountIds(transaction, accountIdDeleteSet))
		.map((transaction) => transaction.id);
	const transactionIdDeleteSet = new Set(transactionIdsToDelete);
	const keptAccountsForSafety = countAccountsKeptForSafety(
		accounts,
		targetCurrency,
		enabledCurrencies
	);

	return {
		scope: "currency",
		currency: targetCurrency,
		accountsDeleted: accountIdsToDelete.length,
		categoriesDeleted: categoryIdsToDelete.length,
		transactionsDeleted: transactionIdsToDelete.length,
		dashboardStatsCleared: dashboardStats ? 1 : 0,
		categoriesReseeded: 0,
		sharedCategoriesKept: categories.filter((category) => !normalizeCurrency(category.currency))
			.length,
		otherCurrencyCategoriesKept: categories.filter((category) => {
			const categoryCurrency = normalizeCurrency(category.currency);
			return Boolean(categoryCurrency && categoryCurrency !== targetCurrency);
		}).length,
		accountsKeptBlankCurrency: keptAccountsForSafety.blank,
		accountsKeptUnknownCurrency: keptAccountsForSafety.unknown,
		accountsKeptNonEnabledCurrency: keptAccountsForSafety.nonEnabled,
		transactionsDeletedCrossCurrencyTransfers: transactions.filter(
			(transaction) =>
				transactionIdDeleteSet.has(transaction.id) &&
				isCrossCurrencyTransferDeleted(
					transaction,
					accountIdDeleteSet,
					accountsById,
					targetCurrency
				)
		).length,
		goldItemsKept,
		zakatCalculationsKept,
		zakatPaymentsKept,
		syncTablesReset: [...CORE_SYNC_TABLES],
		accountIdsToDelete,
		categoryIdsToDelete,
		transactionIdsToDelete,
	};
}

async function buildResetPlan(
	userId: string,
	scope: ResetLocalDataScope
): Promise<ResetLocalDataPlan> {
	if (scope.type === "all") return buildAllResetPlan(userId);
	return buildCurrencyResetPlan(userId, scope.currency, scope.enabledCurrencies);
}

function toResult(plan: ResetLocalDataPlan): ResetLocalDataResult {
	const {
		accountIdsToDelete: _accountIdsToDelete,
		categoryIdsToDelete: _categoryIdsToDelete,
		transactionIdsToDelete: _transactionIdsToDelete,
		...result
	} = plan;
	return result;
}

export async function getResetLocalFinancialDataPreview(
	userId: string,
	scope: ResetLocalDataScope
): Promise<ResetLocalDataPreview> {
	return toResult(await buildResetPlan(userId, scope));
}

async function executeResetLocalFinancialData(
	userId: string,
	scope: ResetLocalDataScope
): Promise<ResetLocalDataResult> {
	const plan = await db.transaction(
		"rw",
		[
			db.accounts,
			db.categories,
			db.transactions,
			db.dashboardStats,
			db.syncMeta,
			db.dbConfig,
			db.goldItems,
			db.zakatCalculations,
			db.zakatPayments,
		],
		async () => {
			const resetPlan = await buildResetPlan(userId, scope);

			await Promise.all([
				resetPlan.accountIdsToDelete.length > 0
					? db.accounts.bulkDelete(resetPlan.accountIdsToDelete)
					: Promise.resolve(),
				resetPlan.categoryIdsToDelete.length > 0
					? db.categories.bulkDelete(resetPlan.categoryIdsToDelete)
					: Promise.resolve(),
				resetPlan.transactionIdsToDelete.length > 0
					? db.transactions.bulkDelete(resetPlan.transactionIdsToDelete)
					: Promise.resolve(),
				db.dashboardStats.delete(userId),
			]);

			await resetSyncPullState(resetPlan.syncTablesReset);

			return resetPlan;
		}
	);

	const result = { ...toResult(plan), categoriesReseeded: 0 };
	await invalidateAnalyticsCache(userId);
	scheduleAnalyticsRecompute(userId);

	return result;
}

/**
 * Wipes this user's accounts, categories, and transactions from the local
 * IndexedDB cache — equivalent to what a browser user gets from manually
 * clearing site data, but reachable from inside the app (needed on PWA/mobile
 * installs where there's no easy way to clear IndexedDB manually).
 *
 * Does NOT touch Firebase. Sync cursors and one-time syncedAt migration
 * markers are reset so the next sync re-pulls remote records instead of
 * treating the local wipe as a deletion to propagate.
 *
 * Does NOT touch Zakat data (`goldItems`, `zakatCalculations`,
 * `zakatPayments`), `dbConfig` (settings/PIN/prefs), or unrelated `syncMeta`
 * keys.
 */
export async function resetLocalFinancialData(userId: string): Promise<ResetLocalDataResult> {
	return executeResetLocalFinancialData(userId, { type: "all" });
}

/**
 * Clears only the local cache records that are safely attributable to one
 * enabled currency:
 * - accounts whose normalized currency exactly matches the target;
 * - transactions touching those accounts, including cross-currency transfers,
 *   so no transaction can point at a missing account;
 * - categories explicitly tagged with the target currency.
 *
 * Blank, unknown, and non-enabled account currencies are kept deliberately.
 * This performs local hard deletes, not `deletedAt` tombstones, so sync has no
 * deletion to push; the per-table cursors/migration markers are reset to make
 * the next sync re-pull remote data.
 */
export async function resetLocalFinancialDataForCurrency(
	userId: string,
	currency: string,
	enabledCurrencies?: readonly string[]
): Promise<ResetLocalDataResult> {
	const uniqueEnabledCurrencies = enabledCurrencies ? unique(enabledCurrencies) : undefined;
	return executeResetLocalFinancialData(userId, {
		type: "currency",
		currency,
		enabledCurrencies: uniqueEnabledCurrencies,
	});
}
