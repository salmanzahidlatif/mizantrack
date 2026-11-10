import { getActiveUserAccounts, normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { yieldAfterChunk, type AnalyticsChunkOptions } from "@/lib/analytics/chunking";
import {
	UNCATEGORIZED_CATEGORY_ID,
	UNCATEGORIZED_CATEGORY_TITLE,
	type AnalyticsBreakdownType,
} from "@/lib/analytics/periodAnalytics";
import {
	resolveComparisonRangeBounds,
	resolveComparisonRanges,
	type ComparisonPresetId,
	type ComparisonRange,
} from "@/lib/comparisonPresets";

import type { Account, Category, Transaction } from "@/types";

const DEFAULT_TOP_COUNT = 5;

export interface ComparisonAnalyticsQuery {
	currency: string;
	presetId: ComparisonPresetId;
	now?: Date;
	customRange?: { from: Date; to: Date };
	fiscalYearStartMonth?: number;
	timeZoneOffsetMinutes?: number;
	/** How many entries to surface in topSavings/topIncreases. Default 5. */
	topCount?: number;
}

export interface CategoryComparisonItem {
	categoryId: string | null;
	title: string;
	icon?: string;
	color?: string;
	currentAmount: number;
	previousAmount: number;
	/** Raw current - previous. */
	delta: number;
	/**
	 * Money-in-your-pocket signed value.
	 * Expense rows: previousAmount - currentAmount (positive = spending less = saving).
	 * Income rows:  currentAmount - previousAmount (positive = earning more).
	 */
	savings: number;
	/** delta / previousAmount, or null when previousAmount === 0. */
	changeShare: number | null;
	/** True when this category exists in exactly one of the two periods. */
	isNew: boolean;
	isDropped: boolean;
}

export interface ComparisonTotals {
	currentIncome: number;
	previousIncome: number;
	currentExpense: number;
	previousExpense: number;
	currentNet: number;
	previousNet: number;
	incomeDelta: number;
	expenseDelta: number;
	netDelta: number;
	/** previousExpense - currentExpense. Positive = spending less overall. */
	expenseSavings: number;
	/** currentIncome - previousIncome. */
	incomeGrowth: number;
	currentTransactionCount: number;
	previousTransactionCount: number;
	/** currentNet - previousNet. Headline "how much better off am I". */
	totalBenefit: number;
}

export interface ComparisonAnalytics {
	currency: string;
	presetId: ComparisonPresetId;
	current: ComparisonRange;
	previous: ComparisonRange;
	totals: ComparisonTotals;
	/** All expense categories present in either period, sorted by savings desc. */
	expenseCategories: CategoryComparisonItem[];
	/** All income categories present in either period, sorted by savings desc. */
	incomeCategories: CategoryComparisonItem[];
	/** Expense rows with savings > 0, highest first, capped at topCount. */
	topSavings: CategoryComparisonItem[];
	/** Expense rows with savings < 0, most negative first, capped at topCount. */
	topIncreases: CategoryComparisonItem[];
}

interface ComparisonBucket {
	categoryId: string | null;
	title: string;
	icon?: string;
	color?: string;
	currentAmount: number;
	previousAmount: number;
	inCurrent: boolean;
	inPrevious: boolean;
}

interface ComparisonAccumulator {
	expense: Map<string, ComparisonBucket>;
	income: Map<string, ComparisonBucket>;
	currentIncome: number;
	previousIncome: number;
	currentExpense: number;
	previousExpense: number;
	currentTransactionCount: number;
	previousTransactionCount: number;
}

function assertCurrency(currency: string): string {
	const normalized = normalizeCurrencyCode(currency);
	if (!normalized) {
		throw new Error("Analytics queries require an explicit currency. Refusing to mix currencies.");
	}
	return normalized;
}

function getCurrencyAccountIds(userId: string, accounts: Account[], currency: string): Set<string> {
	const currencyAccountIds = new Set<string>();
	for (const account of getActiveUserAccounts(userId, accounts)) {
		if (normalizeCurrencyCode(account.currency) === currency) {
			currencyAccountIds.add(account.id);
		}
	}
	return currencyAccountIds;
}

function categoryMatchesBreakdown(
	category: Category | undefined,
	type: AnalyticsBreakdownType,
	currency: string
): category is Category {
	if (!category || category.deletedAt || category.type !== type) return false;
	return !category.currency || normalizeCurrencyCode(category.currency) === currency;
}

function createAccumulator(): ComparisonAccumulator {
	return {
		expense: new Map(),
		income: new Map(),
		currentIncome: 0,
		previousIncome: 0,
		currentExpense: 0,
		previousExpense: 0,
		currentTransactionCount: 0,
		previousTransactionCount: 0,
	};
}

function isWithin(range: ComparisonRange, dateMs: number): boolean {
	return dateMs >= range.fromMs && dateMs <= range.toMs;
}

function accumulateTransaction(
	accumulator: ComparisonAccumulator,
	transaction: Transaction,
	categoriesById: Map<string, Category>,
	currency: string,
	isCurrent: boolean
): void {
	const type: AnalyticsBreakdownType = transaction.type === "Income" ? "Income" : "Expense";
	const buckets = type === "Income" ? accumulator.income : accumulator.expense;
	const candidate = transaction.categoryId ? categoriesById.get(transaction.categoryId) : undefined;
	const category = categoryMatchesBreakdown(candidate, type, currency) ? candidate : undefined;
	const key = category?.id ?? UNCATEGORIZED_CATEGORY_ID;

	let bucket = buckets.get(key);
	if (!bucket) {
		bucket = category
			? {
					categoryId: category.id,
					title: category.title,
					icon: category.icon,
					color: category.color,
					currentAmount: 0,
					previousAmount: 0,
					inCurrent: false,
					inPrevious: false,
				}
			: {
					categoryId: null,
					title: UNCATEGORIZED_CATEGORY_TITLE,
					currentAmount: 0,
					previousAmount: 0,
					inCurrent: false,
					inPrevious: false,
				};
		buckets.set(key, bucket);
	}

	if (isCurrent) {
		bucket.currentAmount += transaction.amount;
		bucket.inCurrent = true;
		accumulator.currentTransactionCount++;
		if (type === "Income") {
			accumulator.currentIncome += transaction.amount;
		} else {
			accumulator.currentExpense += transaction.amount;
		}
		return;
	}

	bucket.previousAmount += transaction.amount;
	bucket.inPrevious = true;
	accumulator.previousTransactionCount++;
	if (type === "Income") {
		accumulator.previousIncome += transaction.amount;
	} else {
		accumulator.previousExpense += transaction.amount;
	}
}

function compareItems(first: CategoryComparisonItem, second: CategoryComparisonItem): number {
	return (
		second.savings - first.savings ||
		first.title.localeCompare(second.title) ||
		(first.categoryId ?? "").localeCompare(second.categoryId ?? "")
	);
}

function buildItems(
	buckets: Map<string, ComparisonBucket>,
	type: AnalyticsBreakdownType
): CategoryComparisonItem[] {
	return [...buckets.values()]
		.map((bucket) => {
			const delta = bucket.currentAmount - bucket.previousAmount;
			return {
				categoryId: bucket.categoryId,
				title: bucket.title,
				icon: bucket.icon,
				color: bucket.color,
				currentAmount: bucket.currentAmount,
				previousAmount: bucket.previousAmount,
				delta,
				savings: type === "Income" ? delta : -delta,
				changeShare: bucket.previousAmount === 0 ? null : delta / bucket.previousAmount,
				isNew: bucket.inCurrent && !bucket.inPrevious,
				isDropped: bucket.inPrevious && !bucket.inCurrent,
			} satisfies CategoryComparisonItem;
		})
		.sort(compareItems);
}

function buildResult(
	accumulator: ComparisonAccumulator,
	currency: string,
	presetId: ComparisonPresetId,
	current: ComparisonRange,
	previous: ComparisonRange,
	topCount: number
): ComparisonAnalytics {
	const currentNet = accumulator.currentIncome - accumulator.currentExpense;
	const previousNet = accumulator.previousIncome - accumulator.previousExpense;
	const expenseCategories = buildItems(accumulator.expense, "Expense");
	const incomeCategories = buildItems(accumulator.income, "Income");

	return {
		currency,
		presetId,
		current,
		previous,
		totals: {
			currentIncome: accumulator.currentIncome,
			previousIncome: accumulator.previousIncome,
			currentExpense: accumulator.currentExpense,
			previousExpense: accumulator.previousExpense,
			currentNet,
			previousNet,
			incomeDelta: accumulator.currentIncome - accumulator.previousIncome,
			expenseDelta: accumulator.currentExpense - accumulator.previousExpense,
			netDelta: currentNet - previousNet,
			expenseSavings: accumulator.previousExpense - accumulator.currentExpense,
			incomeGrowth: accumulator.currentIncome - accumulator.previousIncome,
			currentTransactionCount: accumulator.currentTransactionCount,
			previousTransactionCount: accumulator.previousTransactionCount,
			totalBenefit: currentNet - previousNet,
		},
		expenseCategories,
		incomeCategories,
		topSavings: expenseCategories.filter((item) => item.savings > 0).slice(0, topCount),
		topIncreases: expenseCategories
			.filter((item) => item.savings < 0)
			.sort(
				(first, second) =>
					first.savings - second.savings ||
					first.title.localeCompare(second.title) ||
					(first.categoryId ?? "").localeCompare(second.categoryId ?? "")
			)
			.slice(0, topCount),
	};
}

function resolveTopCount(topCount: number | undefined): number {
	return Math.max(0, Math.floor(topCount ?? DEFAULT_TOP_COUNT));
}

function resolveRanges(query: ComparisonAnalyticsQuery) {
	return resolveComparisonRanges({
		presetId: query.presetId,
		now: query.now,
		customRange: query.customRange,
		fiscalYearStartMonth: query.fiscalYearStartMonth,
		timeZoneOffsetMinutes: query.timeZoneOffsetMinutes,
	});
}

function isIncludedTransaction(
	transaction: Transaction,
	userId: string,
	accountIds: Set<string>
): boolean {
	return (
		transaction.userId === userId &&
		!transaction.deletedAt &&
		transaction.type !== "Transfer" &&
		accountIds.has(transaction.accountId)
	);
}

export function aggregateComparisonAnalytics(
	userId: string,
	accounts: Account[],
	categories: Category[],
	transactions: Transaction[],
	query: ComparisonAnalyticsQuery
): ComparisonAnalytics {
	const currency = assertCurrency(query.currency);
	const ranges = resolveRanges(query);
	const accountIds = getCurrencyAccountIds(userId, accounts, currency);
	const categoriesById = new Map(categories.map((category) => [category.id, category]));
	const accumulator = createAccumulator();

	for (const transaction of transactions) {
		if (!isIncludedTransaction(transaction, userId, accountIds)) continue;

		const isCurrent = isWithin(ranges.current, transaction.date);
		if (!isCurrent && !isWithin(ranges.previous, transaction.date)) continue;

		accumulateTransaction(accumulator, transaction, categoriesById, currency, isCurrent);
	}

	return buildResult(
		accumulator,
		currency,
		ranges.presetId,
		ranges.current,
		ranges.previous,
		resolveTopCount(query.topCount)
	);
}

export async function aggregateComparisonAnalyticsChunked(
	userId: string,
	accounts: Account[],
	categories: Category[],
	transactions: Transaction[],
	query: ComparisonAnalyticsQuery,
	options: AnalyticsChunkOptions = {}
): Promise<ComparisonAnalytics> {
	const currency = assertCurrency(query.currency);
	const ranges = resolveRanges(query);
	const accountIds = getCurrencyAccountIds(userId, accounts, currency);
	const categoriesById = new Map(categories.map((category) => [category.id, category]));
	const accumulator = createAccumulator();
	let processed = 0;

	for (const transaction of transactions) {
		processed++;
		await yieldAfterChunk(processed, options);

		if (!isIncludedTransaction(transaction, userId, accountIds)) continue;

		const isCurrent = isWithin(ranges.current, transaction.date);
		if (!isCurrent && !isWithin(ranges.previous, transaction.date)) continue;

		accumulateTransaction(accumulator, transaction, categoriesById, currency, isCurrent);
	}

	return buildResult(
		accumulator,
		currency,
		ranges.presetId,
		ranges.current,
		ranges.previous,
		resolveTopCount(query.topCount)
	);
}

/** Degenerate pickers can hand us an invalid Date; the key must still be computable. */
function toFiniteMs(date: Date): number | null {
	const ms = date?.getTime?.();
	return Number.isFinite(ms) ? (ms as number) : null;
}

function stableStringify(value: unknown): string {
	if (value === undefined) return "undefined";
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;

	const object = value as Record<string, unknown>;
	return `{${Object.keys(object)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`)
		.join(",")}}`;
}

/**
 * Runs during render (via `useComparisonAnalytics`), so it must never throw: the window is
 * resolved from numeric bounds only, keeping date formatting off this path. The bounds are
 * day-precise, so a period-to-date window naturally invalidates the key when the day rolls over.
 */
export function getComparisonAnalyticsCacheKey(query: ComparisonAnalyticsQuery): string {
	const ranges = resolveComparisonRangeBounds({
		presetId: query.presetId,
		now: query.now,
		customRange: query.customRange,
		fiscalYearStartMonth: query.fiscalYearStartMonth,
		timeZoneOffsetMinutes: query.timeZoneOffsetMinutes,
	});

	return stableStringify({
		currency: normalizeCurrencyCode(query.currency),
		presetId: query.presetId,
		customRange: query.customRange
			? { from: toFiniteMs(query.customRange.from), to: toFiniteMs(query.customRange.to) }
			: undefined,
		fiscalYearStartMonth: query.fiscalYearStartMonth,
		timeZoneOffsetMinutes: query.timeZoneOffsetMinutes,
		topCount: resolveTopCount(query.topCount),
		current: { fromMs: ranges.current.fromMs, toMs: ranges.current.toMs },
		previous: { fromMs: ranges.previous.fromMs, toMs: ranges.previous.toMs },
	});
}
