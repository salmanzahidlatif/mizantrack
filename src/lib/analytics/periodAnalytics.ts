import {
	computeAccountBalances,
	getActiveUserAccounts,
	normalizeCurrencyCode,
	type BalanceWarning,
} from "@/lib/analytics/balanceMath";
import {
	getAccountsAnalyticsCacheKey,
	getMonthlySummariesCacheKey,
	getOrComputeCachedAnalyticsValue,
	getPeriodAnalyticsCacheKey,
} from "@/lib/analytics/cache";
import {
	formatMonthLabel,
	getDateRange,
	getMonthRange,
	getMonthRangeOffset,
	getMonthStripRanges,
	resolveAnalyticsPeriod,
	type AnalyticsInterval,
	type ResolvedAnalyticsPeriod,
} from "@/lib/dateRange";

import type { Account, Category, DateRange, Transaction } from "@/types";

export const UNCATEGORIZED_CATEGORY_ID = "__uncategorized__";
export const UNCATEGORIZED_CATEGORY_TITLE = "Uncategorized";

export type AnalyticsBreakdownType = "Expense" | "Income";
export type MonthlySummaryMode = "ending" | "around";

export interface PeriodAnalyticsQuery {
	currency: string;
	interval?: AnalyticsInterval;
	anchorDate?: Date;
	fiscalYearStartMonth?: number;
	customRange?: DateRange;
	now?: Date;
	timeZoneOffsetMinutes?: number;
}

export interface CategoryBreakdownItem {
	categoryId: string | null;
	title: string;
	color?: string;
	icon?: string;
	amount: number;
	share: number;
}

export interface PeriodAnalytics {
	userId: string;
	currency: string;
	period: ResolvedAnalyticsPeriod;
	income: number;
	expense: number;
	net: number;
	incomeBreakdown: CategoryBreakdownItem[];
	expenseBreakdown: CategoryBreakdownItem[];
	transactionCount: number;
}

export interface MonthlySummariesQuery {
	currency: string;
	months?: number;
	anchorDate?: Date;
	mode?: MonthlySummaryMode;
	timeZoneOffsetMinutes?: number;
}

export interface AnalyticsMonthSummaryItem {
	month: string;
	key: string;
	label: string;
	from: Date;
	to: Date;
	fromMs: number;
	toMs: number;
	income: number;
	expense: number;
	net: number;
	hasData: boolean;
	currency: string;
}

export interface AccountsAnalyticsQuery {
	currency: string;
	enabledCurrencies?: string[];
	period?: Omit<PeriodAnalyticsQuery, "currency">;
	asOf?: Date;
	timeZoneOffsetMinutes?: number;
}

export interface AccountBalanceBreakdownItem {
	accountId: string;
	title: string;
	currency: string;
	color?: string;
	icon?: string;
	isArchived: boolean;
	accountType: Account["accountType"];
	balance: number;
}

export interface AccountsAnalytics {
	userId: string;
	currency: string;
	asOf: Date;
	period: ResolvedAnalyticsPeriod;
	netWorth: number;
	inflow: number;
	outflow: number;
	netFlow: number;
	/** Account balances whose normalized currency exactly matches `currency`. Safe to total. */
	accounts: AccountBalanceBreakdownItem[];
	/** Computed balances for every active account. For diagnostics only; never sum for display. */
	allAccounts: AccountBalanceBreakdownItem[];
	/**
	 * Active accounts with blank, unknown, or disabled currency codes that cannot be safely
	 * included in a selected-currency total. Show separately so they remain reachable.
	 */
	unscopedAccounts: AccountBalanceBreakdownItem[];
	warnings: Array<
		| BalanceWarning
		| {
				code: "account_currency_unscoped";
				accountId: string;
				message: string;
		  }
	>;
}

interface AccountScope {
	accounts: Account[];
	currencyAccountIds: Set<string>;
	unscopedAccountIds: Set<string>;
}

function assertCurrency(currency: string): string {
	const normalized = normalizeCurrencyCode(currency);
	if (!normalized) {
		throw new Error("Analytics queries require an explicit currency. Refusing to mix currencies.");
	}
	return normalized;
}

function resolvePeriod(
	query: Omit<PeriodAnalyticsQuery, "currency"> = {}
): ResolvedAnalyticsPeriod {
	return resolveAnalyticsPeriod({
		interval: query.interval ?? (query.customRange ? "custom" : "monthly"),
		anchorDate: query.anchorDate ?? query.now,
		fiscalYearStartMonth: query.fiscalYearStartMonth,
		customRange: query.customRange,
		now: query.now,
		timeZoneOffsetMinutes: query.timeZoneOffsetMinutes,
	});
}

function getAccountScope(
	userId: string,
	accounts: Account[],
	currency: string,
	enabledCurrencies: string[] = []
): AccountScope {
	const activeAccounts = getActiveUserAccounts(userId, accounts);
	const normalizedCurrency = normalizeCurrencyCode(currency);
	const enabledCurrencySet = new Set(enabledCurrencies.map(normalizeCurrencyCode).filter(Boolean));
	const currencyAccountIds = new Set<string>();
	const unscopedAccountIds = new Set<string>();

	for (const account of activeAccounts) {
		const accountCurrency = normalizeCurrencyCode(account.currency);
		const isCurrencyMatch = accountCurrency === normalizedCurrency;
		if (isCurrencyMatch) {
			currencyAccountIds.add(account.id);
		}
		if (
			!isCurrencyMatch &&
			(!accountCurrency ||
				(enabledCurrencySet.size > 0 && !enabledCurrencySet.has(accountCurrency)))
		) {
			unscopedAccountIds.add(account.id);
		}
	}

	return {
		accounts: activeAccounts,
		currencyAccountIds,
		unscopedAccountIds,
	};
}

function categoryMatchesBreakdown(
	category: Category | undefined,
	type: AnalyticsBreakdownType,
	currency: string
): category is Category {
	if (!category || category.deletedAt || category.type !== type) return false;
	return !category.currency || normalizeCurrencyCode(category.currency) === currency;
}

function buildBreakdown(
	transactions: Transaction[],
	categories: Category[],
	type: AnalyticsBreakdownType,
	currency: string,
	total: number
): CategoryBreakdownItem[] {
	const categoriesById = new Map(categories.map((category) => [category.id, category]));
	const buckets = new Map<
		string,
		{
			categoryId: string | null;
			title: string;
			color?: string;
			icon?: string;
			amount: number;
		}
	>();

	for (const transaction of transactions) {
		if (transaction.type !== type) continue;

		const category = categoryMatchesBreakdown(
			transaction.categoryId ? categoriesById.get(transaction.categoryId) : undefined,
			type,
			currency
		)
			? categoriesById.get(transaction.categoryId!)
			: undefined;
		const key = category?.id ?? UNCATEGORIZED_CATEGORY_ID;
		const current =
			buckets.get(key) ??
			(category
				? {
						categoryId: category.id,
						title: category.title,
						color: category.color,
						icon: category.icon,
						amount: 0,
					}
				: {
						categoryId: null,
						title: UNCATEGORIZED_CATEGORY_TITLE,
						amount: 0,
					});

		current.amount += transaction.amount;
		buckets.set(key, current);
	}

	return [...buckets.values()]
		.map((item) => ({
			...item,
			share: total > 0 ? item.amount / total : 0,
		}))
		.sort((a, b) => b.amount - a.amount || a.title.localeCompare(b.title));
}

function filterPeriodTransactions(
	userId: string,
	transactions: Transaction[],
	accountIds: Set<string>,
	period: ResolvedAnalyticsPeriod
): Transaction[] {
	return transactions.filter(
		(transaction) =>
			transaction.userId === userId &&
			!transaction.deletedAt &&
			transaction.date >= period.fromMs &&
			transaction.date <= period.toMs &&
			accountIds.has(transaction.accountId)
	);
}

export function aggregatePeriodAnalytics(
	userId: string,
	accounts: Account[],
	categories: Category[],
	transactions: Transaction[],
	query: PeriodAnalyticsQuery
): PeriodAnalytics {
	const currency = assertCurrency(query.currency);
	const period = resolvePeriod(query);
	const scope = getAccountScope(userId, accounts, currency);
	const periodTransactions = filterPeriodTransactions(
		userId,
		transactions,
		scope.currencyAccountIds,
		period
	);

	let income = 0;
	let expense = 0;
	let transactionCount = 0;
	for (const transaction of periodTransactions) {
		if (transaction.type === "Income") {
			income += transaction.amount;
			transactionCount++;
		} else if (transaction.type === "Expense") {
			expense += transaction.amount;
			transactionCount++;
		}
	}

	return {
		userId,
		currency,
		period,
		income,
		expense,
		net: income - expense,
		incomeBreakdown: buildBreakdown(periodTransactions, categories, "Income", currency, income),
		expenseBreakdown: buildBreakdown(periodTransactions, categories, "Expense", currency, expense),
		transactionCount,
	};
}

export async function getPeriodAnalytics(
	userId: string,
	query: PeriodAnalyticsQuery
): Promise<PeriodAnalytics> {
	const currency = assertCurrency(query.currency);
	const normalizedQuery = { ...query, currency };
	return getOrComputeCachedAnalyticsValue(
		userId,
		"periods",
		getPeriodAnalyticsCacheKey(normalizedQuery),
		(source) =>
			aggregatePeriodAnalytics(userId, source.accounts, source.categories, source.transactions, {
				...normalizedQuery,
			})
	);
}

function getMonthlyRanges(query: MonthlySummariesQuery) {
	const months = Math.max(1, Math.floor(query.months ?? 6));
	const anchorDate = query.anchorDate ?? new Date();

	if (query.mode === "around") {
		return getMonthStripRanges(anchorDate, {
			months,
			timeZoneOffsetMinutes: query.timeZoneOffsetMinutes,
		});
	}

	return Array.from({ length: months }, (_, index) => {
		const offset = index - (months - 1);
		return getMonthRangeOffset(anchorDate, offset, {
			timeZoneOffsetMinutes: query.timeZoneOffsetMinutes,
		});
	});
}

export function aggregateMonthlySummaries(
	userId: string,
	accounts: Account[],
	transactions: Transaction[],
	query: MonthlySummariesQuery
): AnalyticsMonthSummaryItem[] {
	const currency = assertCurrency(query.currency);
	const ranges = getMonthlyRanges(query);
	const scope = getAccountScope(userId, accounts, currency);
	const summaries = new Map(
		ranges.map((range) => [
			range.key,
			{
				month: range.shortLabel,
				key: range.key,
				label: range.label,
				from: range.from,
				to: range.to,
				fromMs: range.fromMs,
				toMs: range.toMs,
				income: 0,
				expense: 0,
				net: 0,
				hasData: false,
				currency,
			},
		])
	);

	for (const transaction of transactions) {
		if (
			transaction.userId !== userId ||
			transaction.deletedAt ||
			!scope.currencyAccountIds.has(transaction.accountId) ||
			transaction.type === "Transfer"
		) {
			continue;
		}

		const key = getMonthRange(new Date(transaction.date), {
			timeZoneOffsetMinutes: query.timeZoneOffsetMinutes,
		}).key;
		const summary = summaries.get(key);
		if (!summary) continue;

		if (transaction.type === "Income") {
			summary.income += transaction.amount;
		} else if (transaction.type === "Expense") {
			summary.expense += transaction.amount;
		}
		summary.net = summary.income - summary.expense;
		summary.hasData = summary.income > 0 || summary.expense > 0;
	}

	return ranges.map((range) => summaries.get(range.key)!);
}

export async function getMonthlySummaries(
	userId: string,
	query: MonthlySummariesQuery
): Promise<AnalyticsMonthSummaryItem[]> {
	const currency = assertCurrency(query.currency);
	const normalizedQuery = { ...query, currency };
	return getOrComputeCachedAnalyticsValue(
		userId,
		"monthlySummaries",
		getMonthlySummariesCacheKey(normalizedQuery),
		(source) =>
			aggregateMonthlySummaries(userId, source.accounts, source.transactions, {
				...normalizedQuery,
			})
	);
}

function getEndOfAsOfDay(asOf: Date, timeZoneOffsetMinutes?: number): Date {
	return getDateRange("today", 1, undefined, {
		now: asOf,
		timeZoneOffsetMinutes,
	}).to;
}

function getAccountCurrencyWarnings(
	accounts: Account[],
	query: AccountsAnalyticsQuery
): AccountsAnalytics["warnings"] {
	const enabledCurrencies = new Set((query.enabledCurrencies ?? []).map(normalizeCurrencyCode));
	const warnings: AccountsAnalytics["warnings"] = [];

	for (const account of accounts) {
		const accountCurrency = normalizeCurrencyCode(account.currency);
		if (!accountCurrency) {
			warnings.push({
				code: "account_currency_unscoped",
				accountId: account.id,
				message:
					"Account has no valid currency, so it is shown separately under Other / Unknown currency and excluded from single-currency totals.",
			});
			continue;
		}

		if (enabledCurrencies.size > 0 && !enabledCurrencies.has(accountCurrency)) {
			warnings.push({
				code: "account_currency_unscoped",
				accountId: account.id,
				message:
					"Account currency is not enabled in preferences, so it is shown separately under Other / Unknown currency unless that currency is selected directly.",
			});
		}
	}

	return warnings;
}

export function aggregateAccountsAnalytics(
	userId: string,
	accounts: Account[],
	transactions: Transaction[],
	query: AccountsAnalyticsQuery
): AccountsAnalytics {
	const currency = assertCurrency(query.currency);
	const asOf = query.asOf ?? new Date();
	const period = resolvePeriod(query.period);
	const scope = getAccountScope(userId, accounts, currency, query.enabledCurrencies);
	const asOfMs = getEndOfAsOfDay(asOf, query.timeZoneOffsetMinutes).getTime();
	const balanceComputation = computeAccountBalances(userId, accounts, transactions, { asOfMs });
	const balances = balanceComputation.balances;
	const accountCurrencyWarnings = getAccountCurrencyWarnings(scope.accounts, query);

	let inflow = 0;
	let outflow = 0;
	for (const transaction of transactions) {
		if (transaction.userId !== userId || transaction.deletedAt) continue;

		const isSourceInCurrency = scope.currencyAccountIds.has(transaction.accountId);
		if (
			isSourceInCurrency &&
			transaction.date >= period.fromMs &&
			transaction.date <= period.toMs
		) {
			if (transaction.type === "Income") inflow += transaction.amount;
			if (transaction.type === "Expense") outflow += transaction.amount;
		}
	}

	const allAccountBalances = scope.accounts
		.map((account) => ({
			accountId: account.id,
			title: account.title,
			currency: normalizeCurrencyCode(account.currency) || currency,
			color: account.color,
			icon: account.icon,
			isArchived: account.isArchived,
			accountType: account.accountType,
			balance: balances.get(account.id) ?? account.openingBalance,
		}))
		.sort((a, b) => b.balance - a.balance || a.title.localeCompare(b.title));
	const accountBalances = allAccountBalances.filter((account) =>
		scope.currencyAccountIds.has(account.accountId)
	);
	const unscopedAccountBalances = allAccountBalances.filter((account) =>
		scope.unscopedAccountIds.has(account.accountId)
	);
	const netWorth = accountBalances.reduce((sum, account) => sum + account.balance, 0);

	return {
		userId,
		currency,
		asOf,
		period,
		netWorth,
		inflow,
		outflow,
		netFlow: inflow - outflow,
		accounts: accountBalances,
		allAccounts: allAccountBalances,
		unscopedAccounts: unscopedAccountBalances,
		warnings: [...balanceComputation.warnings, ...accountCurrencyWarnings],
	};
}

export async function getAccountsAnalytics(
	userId: string,
	query: AccountsAnalyticsQuery
): Promise<AccountsAnalytics> {
	const currency = assertCurrency(query.currency);
	const asOf = query.asOf ?? new Date();
	const normalizedQuery = { ...query, currency, asOf };
	return getOrComputeCachedAnalyticsValue(
		userId,
		"accounts",
		getAccountsAnalyticsCacheKey(normalizedQuery),
		(source) =>
			aggregateAccountsAnalytics(userId, source.accounts, source.transactions, {
				...normalizedQuery,
			})
	);
}

export function getMonthLabelForDate(date: Date, timeZoneOffsetMinutes?: number): string {
	return formatMonthLabel(date, { timeZoneOffsetMinutes });
}
