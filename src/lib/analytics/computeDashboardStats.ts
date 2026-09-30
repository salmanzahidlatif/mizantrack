import {
	accountBalancesToRecord,
	computeAccountBalancesChunked,
	computeAccountBalances,
	getActiveUserAccounts,
	normalizeCurrencyCode,
} from "@/lib/analytics/balanceMath";
import {
	buildAnalyticsDataVersion,
	getAnalyticsSourceData,
	markDashboardStatsCacheValid,
} from "@/lib/analytics/cacheMetadata";
import { yieldAfterChunk, type AnalyticsChunkOptions } from "@/lib/analytics/chunking";

import type { Account, DashboardStats, Transaction } from "@/types";

export const DEFAULT_TREND_MONTHS = 6;

// Firestore rejects empty-string field names (`setDoc` errors with
// "Document fields must not be empty"), so the "all currencies combined"
// bucket in `perCurrency` must use a non-empty sentinel key instead of "".
export const ALL_CURRENCIES_KEY = "ALL";

const MS_PER_MINUTE = 60 * 1000;
const MONTH_LABELS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

interface DashboardMonthRange {
	startMs: number;
	endMs: number;
}

export interface DashboardStatsAggregationOptions {
	now?: Date;
	trendMonths?: number;
	timeZoneOffsetMinutes?: number;
}

/**
 * Deep-removes any `undefined` values from an object/array (Firestore's
 * `setDoc` rejects fields with `undefined`, only `null` or omission is
 * allowed). Used to clean stale cached `DashboardStats` records that were
 * computed by an older version of `computeDashboardStats` before optional
 * fields were properly omitted.
 */
function stripUndefinedDeep<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
	}

	if (value !== null && typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
			if (val === undefined) continue;
			result[key] = stripUndefinedDeep(val);
		}
		return result as T;
	}

	return value;
}

/**
 * Normalizes a `DashboardStats` object so `perCurrency` never has an empty
 * string key. Older cached records (computed before `ALL_CURRENCIES_KEY` was
 * introduced) may still have `perCurrency[""]` — Firestore's `setDoc` throws
 * "Document fields must not be empty" if pushed as-is. Safe to call on any
 * `DashboardStats`, including already-normalized ones (no-op in that case).
 * Also strips any stray `undefined` values left over from older cached
 * records (Firestore rejects those too, with "Unsupported field value").
 */
export function sanitizeDashboardStats(stats: DashboardStats): DashboardStats {
	const { analyticsCache: _analyticsCache, ...statsForRemote } = stats;
	let result = statsForRemote;

	if (Object.prototype.hasOwnProperty.call(stats.perCurrency, "")) {
		const { "": allCurrencies, ...rest } = stats.perCurrency;
		result = allCurrencies
			? {
					...stats,
					perCurrency: {
						...rest,
						[ALL_CURRENCIES_KEY]: rest[ALL_CURRENCIES_KEY] ?? allCurrencies,
					},
				}
			: { ...stats, perCurrency: rest };
	}

	return stripUndefinedDeep(result);
}

type TrendItem = DashboardStats["perCurrency"][string]["trend"][number];

interface AggregateState {
	accountIds: Set<string> | null;
	summary: DashboardStats["perCurrency"][string];
	trendMap: Map<string, TrendItem>;
}

export function getLocalTimeZoneOffsetMinutes(now = new Date()): number {
	return -now.getTimezoneOffset();
}

function shiftedUtcDate(ms: number, timeZoneOffsetMinutes: number): Date {
	return new Date(ms + timeZoneOffsetMinutes * MS_PER_MINUTE);
}

function getMonthStartMs(now: Date, timeZoneOffsetMinutes: number, monthOffset = 0): number {
	const shifted = shiftedUtcDate(now.getTime(), timeZoneOffsetMinutes);
	return (
		Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + monthOffset, 1) -
		timeZoneOffsetMinutes * MS_PER_MINUTE
	);
}

export function getDashboardMonthRange(
	now = new Date(),
	timeZoneOffsetMinutes = getLocalTimeZoneOffsetMinutes(now)
): DashboardMonthRange {
	return {
		startMs: getMonthStartMs(now, timeZoneOffsetMinutes),
		endMs: getMonthStartMs(now, timeZoneOffsetMinutes, 1) - 1,
	};
}

export function formatDashboardMonthLabel(
	dateMs: number,
	timeZoneOffsetMinutes = getLocalTimeZoneOffsetMinutes(new Date(dateMs))
): string {
	const shifted = shiftedUtcDate(dateMs, timeZoneOffsetMinutes);
	const month = MONTH_LABELS[shifted.getUTCMonth()];
	const year = String(shifted.getUTCFullYear()).slice(-2);
	return `${month} ${year}`;
}

function createAggregateState(
	now: Date,
	accountIds: Set<string> | null,
	trendMonths: number,
	timeZoneOffsetMinutes: number
): AggregateState {
	const trend: TrendItem[] = [];
	const trendMap = new Map<string, TrendItem>();

	for (let i = trendMonths - 1; i >= 0; i--) {
		const label = formatDashboardMonthLabel(
			getMonthStartMs(now, timeZoneOffsetMinutes, -i),
			timeZoneOffsetMinutes
		);
		const bucket: TrendItem = { month: label, income: 0, expense: 0 };
		trend.push(bucket);
		trendMap.set(label, bucket);
	}

	return {
		accountIds,
		summary: {
			monthIncome: 0,
			monthExpense: 0,
			trend,
		},
		trendMap,
	};
}

function sourceAccountMatchesCurrency(
	transaction: Transaction,
	accountIds: Set<string> | null
): boolean {
	if (!accountIds) return true;
	return accountIds.has(transaction.accountId);
}

function applyTransactionToAggregate(
	state: AggregateState,
	transaction: Transaction,
	monthStart: number,
	monthEnd: number,
	trendStart: number,
	trendEnd: number,
	timeZoneOffsetMinutes: number
) {
	if (transaction.date >= monthStart && transaction.date <= monthEnd) {
		if (transaction.type === "Income") {
			state.summary.monthIncome += transaction.amount;
		} else if (transaction.type === "Expense") {
			state.summary.monthExpense += transaction.amount;
		}
	}

	if (transaction.date < trendStart || transaction.date > trendEnd) return;

	const bucket = state.trendMap.get(
		formatDashboardMonthLabel(transaction.date, timeZoneOffsetMinutes)
	);
	if (!bucket) return;

	if (transaction.type === "Income") {
		bucket.income += transaction.amount;
	} else if (transaction.type === "Expense") {
		bucket.expense += transaction.amount;
	}
}

export function getMonthlySummaryFromDashboardStats(
	stats: DashboardStats,
	months = DEFAULT_TREND_MONTHS,
	currency?: string
): TrendItem[] {
	let currencyKey = ALL_CURRENCIES_KEY;
	if (currency) currencyKey = currency;
	const bucket = stats.perCurrency[currencyKey];
	if (!bucket) return [];
	return bucket.trend.slice(-months);
}

export function aggregateDashboardStats(
	userId: string,
	accounts: Account[],
	transactions: Transaction[],
	options: DashboardStatsAggregationOptions = {}
): DashboardStats {
	const now = options.now ?? new Date();
	const trendMonths = Math.max(1, Math.floor(options.trendMonths ?? DEFAULT_TREND_MONTHS));
	const timeZoneOffsetMinutes = options.timeZoneOffsetMinutes ?? getLocalTimeZoneOffsetMinutes(now);
	const { startMs: monthStart, endMs: monthEnd } = getDashboardMonthRange(
		now,
		timeZoneOffsetMinutes
	);
	const trendStart = getMonthStartMs(now, timeZoneOffsetMinutes, -(trendMonths - 1));
	const trendEnd = monthEnd;

	const activeAccounts = getActiveUserAccounts(userId, accounts);
	const balanceComputation = computeAccountBalances(userId, accounts, transactions);
	const accountById = balanceComputation.accountById;
	const currencyAccountIds = new Map<string, Set<string>>();
	const accountCurrencyById = new Map<string, string>();

	for (const account of activeAccounts) {
		const accountCurrency = normalizeCurrencyCode(account.currency);
		if (!accountCurrency) continue;
		accountCurrencyById.set(account.id, accountCurrency);
		if (!currencyAccountIds.has(accountCurrency)) {
			currencyAccountIds.set(accountCurrency, new Set());
		}
		currencyAccountIds.get(accountCurrency)!.add(account.id);
	}

	const activeTransactions = transactions.filter((transaction) => {
		if (transaction.deletedAt) return false;
		return accountById.has(transaction.accountId);
	});

	const aggregates = new Map<string, AggregateState>();
	aggregates.set(
		ALL_CURRENCIES_KEY,
		createAggregateState(now, null, trendMonths, timeZoneOffsetMinutes)
	);
	for (const [currency, accountIds] of currencyAccountIds.entries()) {
		aggregates.set(
			currency,
			createAggregateState(now, accountIds, trendMonths, timeZoneOffsetMinutes)
		);
	}

	for (const transaction of activeTransactions) {
		const allCurrencies = aggregates.get(ALL_CURRENCIES_KEY);
		if (allCurrencies) {
			applyTransactionToAggregate(
				allCurrencies,
				transaction,
				monthStart,
				monthEnd,
				trendStart,
				trendEnd,
				timeZoneOffsetMinutes
			);
		}

		const currency = accountCurrencyById.get(transaction.accountId);
		const currencyState = currency ? aggregates.get(currency) : undefined;
		if (currencyState && sourceAccountMatchesCurrency(transaction, currencyState.accountIds)) {
			applyTransactionToAggregate(
				currencyState,
				transaction,
				monthStart,
				monthEnd,
				trendStart,
				trendEnd,
				timeZoneOffsetMinutes
			);
		}
	}

	const recent = [...activeTransactions]
		.sort((a, b) => b.date - a.date)
		.slice(0, 20)
		.map((transaction) => {
			const account = accountById.get(transaction.accountId);

			// Firestore's setDoc() rejects any field whose value is `undefined`
			// (it requires the key to be omitted entirely instead), so optional
			// fields must only be included when actually present.
			return {
				id: transaction.id,
				type: transaction.type,
				date: transaction.date,
				amount: transaction.amount,
				...(transaction.description !== undefined && { description: transaction.description }),
				...(transaction.place !== undefined && { place: transaction.place }),
				accountId: transaction.accountId,
				accountTitle: account?.title ?? "—",
				accountCurrency: account?.currency ?? "",
				...(transaction.toAccountId !== undefined && { toAccountId: transaction.toAccountId }),
			};
		});

	const perCurrency = Object.fromEntries(
		[...aggregates.entries()].map(([currency, state]) => [currency, state.summary])
	) as DashboardStats["perCurrency"];

	return {
		id: userId,
		updatedAt: Date.now(),
		balances: accountBalancesToRecord(balanceComputation.balances),
		perCurrency,
		recent,
		...(balanceComputation.warnings.length > 0 && { warnings: balanceComputation.warnings }),
	};
}

export async function aggregateDashboardStatsChunked(
	userId: string,
	accounts: Account[],
	transactions: Transaction[],
	options: DashboardStatsAggregationOptions & AnalyticsChunkOptions = {}
): Promise<DashboardStats> {
	const now = options.now ?? new Date();
	const trendMonths = Math.max(1, Math.floor(options.trendMonths ?? DEFAULT_TREND_MONTHS));
	const timeZoneOffsetMinutes = options.timeZoneOffsetMinutes ?? getLocalTimeZoneOffsetMinutes(now);
	const { startMs: monthStart, endMs: monthEnd } = getDashboardMonthRange(
		now,
		timeZoneOffsetMinutes
	);
	const trendStart = getMonthStartMs(now, timeZoneOffsetMinutes, -(trendMonths - 1));
	const trendEnd = monthEnd;

	const activeAccounts = getActiveUserAccounts(userId, accounts);
	const balanceComputation = await computeAccountBalancesChunked(userId, accounts, transactions, {
		...options,
	});
	const accountById = balanceComputation.accountById;
	const currencyAccountIds = new Map<string, Set<string>>();
	const accountCurrencyById = new Map<string, string>();

	for (const account of activeAccounts) {
		const accountCurrency = normalizeCurrencyCode(account.currency);
		if (!accountCurrency) continue;
		accountCurrencyById.set(account.id, accountCurrency);
		if (!currencyAccountIds.has(accountCurrency)) {
			currencyAccountIds.set(accountCurrency, new Set());
		}
		currencyAccountIds.get(accountCurrency)!.add(account.id);
	}

	const activeTransactions: Transaction[] = [];
	const aggregates = new Map<string, AggregateState>();
	aggregates.set(
		ALL_CURRENCIES_KEY,
		createAggregateState(now, null, trendMonths, timeZoneOffsetMinutes)
	);
	for (const [currency, accountIds] of currencyAccountIds.entries()) {
		aggregates.set(
			currency,
			createAggregateState(now, accountIds, trendMonths, timeZoneOffsetMinutes)
		);
	}

	let processed = 0;
	for (const transaction of transactions) {
		processed++;
		await yieldAfterChunk(processed, options);

		if (transaction.deletedAt || !accountById.has(transaction.accountId)) continue;
		activeTransactions.push(transaction);

		const allCurrencies = aggregates.get(ALL_CURRENCIES_KEY);
		if (allCurrencies) {
			applyTransactionToAggregate(
				allCurrencies,
				transaction,
				monthStart,
				monthEnd,
				trendStart,
				trendEnd,
				timeZoneOffsetMinutes
			);
		}

		const currency = accountCurrencyById.get(transaction.accountId);
		const currencyState = currency ? aggregates.get(currency) : undefined;
		if (currencyState && sourceAccountMatchesCurrency(transaction, currencyState.accountIds)) {
			applyTransactionToAggregate(
				currencyState,
				transaction,
				monthStart,
				monthEnd,
				trendStart,
				trendEnd,
				timeZoneOffsetMinutes
			);
		}
	}

	const recent = [...activeTransactions]
		.sort((a, b) => b.date - a.date)
		.slice(0, 20)
		.map((transaction) => {
			const account = accountById.get(transaction.accountId);

			return {
				id: transaction.id,
				type: transaction.type,
				date: transaction.date,
				amount: transaction.amount,
				...(transaction.description !== undefined && { description: transaction.description }),
				...(transaction.place !== undefined && { place: transaction.place }),
				accountId: transaction.accountId,
				accountTitle: account?.title ?? "—",
				accountCurrency: account?.currency ?? "",
				...(transaction.toAccountId !== undefined && { toAccountId: transaction.toAccountId }),
			};
		});

	const perCurrency = Object.fromEntries(
		[...aggregates.entries()].map(([currency, state]) => [currency, state.summary])
	) as DashboardStats["perCurrency"];

	return {
		id: userId,
		updatedAt: Date.now(),
		balances: accountBalancesToRecord(balanceComputation.balances),
		perCurrency,
		recent,
		...(balanceComputation.warnings.length > 0 && { warnings: balanceComputation.warnings }),
	};
}

export async function computeDashboardStats(
	userId: string,
	options: DashboardStatsAggregationOptions & AnalyticsChunkOptions = {}
): Promise<DashboardStats> {
	const source = await getAnalyticsSourceData(userId);
	const dataVersion = buildAnalyticsDataVersion(source);

	return markDashboardStatsCacheValid(
		await aggregateDashboardStatsChunked(userId, source.accounts, source.transactions, options),
		dataVersion
	);
}
