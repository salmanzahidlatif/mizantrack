import { getActiveUserAccounts, normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { yieldAfterChunk, type AnalyticsChunkOptions } from "@/lib/analytics/chunking";
import {
	getLocalTimeZoneOffsetMinutes,
	getMonthKey,
	getPeriodRange,
	getPeriodRangeOffset,
	type PeriodRange,
} from "@/lib/dateRange";
import { detectSalaryCategories } from "@/lib/salaryCategories";

import type { Account, Category, Transaction } from "@/types";

export type SalaryProgressionInterval = "monthly" | "quarterly" | "yearly";

export interface SalaryProgressionQuery {
	currency: string;
	/** Default "yearly". */
	interval?: SalaryProgressionInterval;
	/** Trailing window in years. Omit or 0 = all time, starting at the first salary transaction. */
	years?: number;
	now?: Date;
	timeZoneOffsetMinutes?: number;
	/** 1-12. Only affects "yearly" bucketing when provided. */
	fiscalYearStartMonth?: number;
	/** Explicit category ids. When provided, overrides auto-detection entirely. */
	categoryIds?: string[];
	/** Default true. When false, ALL Income counts as salary. */
	autoDetect?: boolean;
	/** Minimum run-rate increase to flag a hike. Default 0.05 (5%). */
	hikeThreshold?: number;
}

export interface SalaryProgressionPoint {
	/** Stable bucket key: "2026-04" | "2026-Q2" | "2026". */
	key: string;
	/** Human label: "Apr 26" | "Q2 26" | "2026". */
	label: string;
	fromMs: number;
	toMs: number;
	/** Total salary income in this bucket. */
	total: number;
	/** Months in the bucket that contained at least one salary transaction. */
	monthsWithIncome: number;
	/**
	 * Calendar months this bucket actually covers, clamped to employment start and `now`.
	 * This is the run-rate denominator — paying a salary early (e.g. June's pay on 29 May)
	 * must not shrink it and fake a raise.
	 */
	monthsCovered: number;
	/** Monthly run-rate: total / monthsCovered, or 0 when the bucket covers nothing. */
	average: number;
	transactionCount: number;
	/** True when the bucket extends past `now` and is therefore still in progress. */
	isPartial: boolean;
	/** total - previous bucket total. */
	delta: number;
	/** delta / previous total, or null when the previous total is 0. */
	growthShare: number | null;
	/** average - previous non-empty bucket average. */
	averageDelta: number;
	/** averageDelta / previous non-empty average, or null when 0. */
	averageGrowthShare: number | null;
	/** True when the run-rate rose by at least hikeThreshold and the new level held. */
	isHike: boolean;
}

export interface SalaryHike {
	key: string;
	label: string;
	atMs: number;
	fromAverage: number;
	toAverage: number;
	/** Fractional increase, e.g. 0.15 for a 15% raise. */
	share: number;
}

export interface SalaryProgressionAnalytics {
	currency: string;
	interval: SalaryProgressionInterval;
	points: SalaryProgressionPoint[];
	/** Category ids actually used for the aggregation. */
	usedCategoryIds: string[];
	/** True when auto-detection found nothing and the engine fell back to all Income. */
	usedFallbackAllIncome: boolean;
	firstSalaryMs?: number;
	lastSalaryMs?: number;
	totalEarned: number;
	/** Monthly run-rate of the first non-empty bucket. */
	startingAverage: number;
	/** Monthly run-rate of the latest non-empty bucket. */
	latestAverage: number;
	/** (latestAverage - startingAverage) / startingAverage, or null when starting is 0. */
	overallGrowthShare: number | null;
	/** Compound annual growth rate of the monthly run-rate, or null when not computable. */
	cagr: number | null;
	hikes: SalaryHike[];
}

const DEFAULT_INTERVAL: SalaryProgressionInterval = "yearly";
const DEFAULT_HIKE_THRESHOLD = 0.05;
const MONTHS_PER_YEAR = 12;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_YEAR = 365.2425 * 24 * 60 * 60 * 1000;
/** Hard cap so a pathological date can never emit an unbounded series. */
const MAX_BUCKET_COUNT = 600;
/** Below this elapsed span a compound annual rate is meaningless noise. */
const MIN_CAGR_YEARS = 0.5;
/**
 * Monthly buckets are noisy — a bonus or a double-paid month looks exactly like a raise.
 * A monthly hike is only reported once the elevated run-rate survives into a later bucket.
 */
const MONTHLY_HIKE_CONFIRMATION_BUCKETS = 2;

interface BucketAccumulator {
	key: string;
	label: string;
	fromMs: number;
	toMs: number;
	total: number;
	transactionCount: number;
	monthKeys: Set<string>;
}

interface SalaryCategorySelection {
	/** `null` means "every Income transaction counts". */
	categoryIdSet: Set<string> | null;
	usedCategoryIds: string[];
	usedFallbackAllIncome: boolean;
}

function assertCurrency(currency: string): string {
	const normalized = normalizeCurrencyCode(currency);
	if (!normalized) {
		throw new Error("Analytics queries require an explicit currency. Refusing to mix currencies.");
	}
	return normalized;
}

function toFiniteNumber(value: number): number {
	// `value === 0` also catches -0, which would otherwise render as "-0".
	if (!Number.isFinite(value)) return 0;
	return value === 0 ? 0 : value;
}

function toFiniteShare(value: number): number | null {
	if (!Number.isFinite(value)) return null;
	return value === 0 ? 0 : value;
}

/** Safe ratio: null whenever the denominator cannot produce a meaningful share. */
function safeShare(numerator: number, denominator: number): number | null {
	if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
		return null;
	}
	return toFiniteShare(numerator / denominator);
}

/** Absolute calendar-month index (year * 12 + month) in the user's local time zone. */
function getAbsoluteMonthIndex(ms: number, timeZoneOffsetMinutes: number): number {
	const shifted = new Date(ms + timeZoneOffsetMinutes * MS_PER_MINUTE);
	return shifted.getUTCFullYear() * MONTHS_PER_YEAR + shifted.getUTCMonth();
}

/**
 * Calendar months a bucket covers, clamped so partial buckets stay honest:
 * months before employment started and months that have not happened yet are excluded.
 */
function countCoveredMonths(
	fromMs: number,
	toMs: number,
	firstSalaryMs: number | undefined,
	nowMs: number,
	timeZoneOffsetMinutes: number
): number {
	const start = firstSalaryMs === undefined ? fromMs : Math.max(fromMs, firstSalaryMs);
	const end = Math.min(toMs, nowMs);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;

	const months =
		getAbsoluteMonthIndex(end, timeZoneOffsetMinutes) -
		getAbsoluteMonthIndex(start, timeZoneOffsetMinutes) +
		1;
	return Number.isFinite(months) ? Math.max(0, months) : 0;
}

function uniqueSortedIds(ids: string[]): string[] {
	return [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))].sort();
}

function resolveInterval(query: SalaryProgressionQuery): SalaryProgressionInterval {
	return query.interval ?? DEFAULT_INTERVAL;
}

function resolveTimeZoneOffsetMinutes(query: SalaryProgressionQuery, now: Date): number {
	return query.timeZoneOffsetMinutes ?? getLocalTimeZoneOffsetMinutes(now);
}

function resolveFiscalYearStartMonth(query: SalaryProgressionQuery): number | undefined {
	if (query.fiscalYearStartMonth === undefined) return undefined;
	const month = Math.floor(query.fiscalYearStartMonth);
	if (!Number.isFinite(month)) return undefined;
	return Math.min(12, Math.max(1, month));
}

function resolveHikeThreshold(query: SalaryProgressionQuery): number {
	const threshold = query.hikeThreshold;
	if (threshold === undefined || !Number.isFinite(threshold)) return DEFAULT_HIKE_THRESHOLD;
	return Math.max(0, threshold);
}

function resolveYears(query: SalaryProgressionQuery): number {
	const years = query.years;
	if (years === undefined || !Number.isFinite(years)) return 0;
	return Math.max(0, Math.floor(years));
}

function getCurrencyAccountIds(userId: string, accounts: Account[], currency: string): Set<string> {
	const accountIds = new Set<string>();
	for (const account of getActiveUserAccounts(userId, accounts)) {
		if (normalizeCurrencyCode(account.currency) === currency) accountIds.add(account.id);
	}
	return accountIds;
}

function resolveCategorySelection(
	userId: string,
	categories: Category[],
	currency: string,
	query: SalaryProgressionQuery
): SalaryCategorySelection {
	const explicitIds = uniqueSortedIds(query.categoryIds ?? []);
	if (explicitIds.length > 0) {
		return {
			categoryIdSet: new Set(explicitIds),
			usedCategoryIds: explicitIds,
			usedFallbackAllIncome: false,
		};
	}

	if (query.autoDetect === false) {
		return { categoryIdSet: null, usedCategoryIds: [], usedFallbackAllIncome: false };
	}

	const detectedIds = uniqueSortedIds(
		detectSalaryCategories(userId, categories, currency).categoryIds
	);
	if (detectedIds.length === 0) {
		return { categoryIdSet: null, usedCategoryIds: [], usedFallbackAllIncome: true };
	}

	return {
		categoryIdSet: new Set(detectedIds),
		usedCategoryIds: detectedIds,
		usedFallbackAllIncome: false,
	};
}

function isSalaryTransaction(
	transaction: Transaction,
	userId: string,
	accountIds: Set<string>,
	categoryIdSet: Set<string> | null
): boolean {
	if (transaction.userId !== userId || transaction.deletedAt) return false;
	if (transaction.type !== "Income") return false;
	if (!accountIds.has(transaction.accountId)) return false;
	if (!categoryIdSet) return true;
	return Boolean(transaction.categoryId) && categoryIdSet.has(transaction.categoryId!);
}

function getPeriodRangeFor(
	date: Date,
	interval: SalaryProgressionInterval,
	fiscalYearStartMonth: number | undefined,
	timeZoneOffsetMinutes: number
): PeriodRange {
	return getPeriodRange(date, { interval, fiscalYearStartMonth, timeZoneOffsetMinutes });
}

function getWindowStartDate(
	now: Date,
	years: number,
	firstSalaryMs: number | undefined,
	timeZoneOffsetMinutes: number
): Date | undefined {
	if (years > 0) {
		return getPeriodRangeOffset(now, -years * MONTHS_PER_YEAR, {
			interval: "monthly",
			timeZoneOffsetMinutes,
		}).from;
	}
	return firstSalaryMs === undefined ? undefined : new Date(firstSalaryMs);
}

function buildBucketRanges(
	startDate: Date,
	now: Date,
	interval: SalaryProgressionInterval,
	fiscalYearStartMonth: number | undefined,
	timeZoneOffsetMinutes: number
): PeriodRange[] {
	const first = getPeriodRangeFor(startDate, interval, fiscalYearStartMonth, timeZoneOffsetMinutes);
	const last = getPeriodRangeFor(now, interval, fiscalYearStartMonth, timeZoneOffsetMinutes);
	const ranges: PeriodRange[] = [];

	// Walk backwards from the newest bucket so the cap always keeps the most recent window.
	let current = last;
	while (current.fromMs >= first.fromMs && ranges.length < MAX_BUCKET_COUNT) {
		ranges.push(current);
		const previous = getPeriodRangeOffset(current.from, -1, {
			interval,
			fiscalYearStartMonth,
			timeZoneOffsetMinutes,
		});
		if (previous.fromMs >= current.fromMs) break;
		current = previous;
	}

	if (ranges.length === 0) return [first];
	return ranges.reverse();
}

function findBucket(buckets: BucketAccumulator[], dateMs: number): BucketAccumulator | undefined {
	let low = 0;
	let high = buckets.length - 1;
	let found: BucketAccumulator | undefined;

	while (low <= high) {
		const mid = (low + high) >> 1;
		const candidate = buckets[mid];
		if (!candidate) break;

		if (candidate.fromMs <= dateMs) {
			found = candidate;
			low = mid + 1;
		} else {
			high = mid - 1;
		}
	}

	if (!found) return undefined;
	return dateMs <= found.toMs ? found : undefined;
}

interface BuildPointsOptions {
	hikeThreshold: number;
	interval: SalaryProgressionInterval;
	firstSalaryMs: number | undefined;
	nowMs: number;
	timeZoneOffsetMinutes: number;
}

interface HikeCandidate {
	index: number;
	fromAverage: number;
	share: number;
}

/**
 * A monthly raise only counts once the elevated run-rate persists into a later funded
 * bucket. Without this a one-off bonus month reads as a permanent raise.
 */
function isSustainedHike(
	points: SalaryProgressionPoint[],
	candidate: HikeCandidate,
	hikeThreshold: number
): boolean {
	const requiredLevel = candidate.fromAverage * (1 + hikeThreshold);
	let confirmed = 1;

	for (let index = candidate.index + 1; index < points.length; index++) {
		const next = points[index];
		if (!next || next.monthsWithIncome === 0) continue;
		if (next.average < requiredLevel) return false;

		confirmed++;
		if (confirmed >= MONTHLY_HIKE_CONFIRMATION_BUCKETS) return true;
	}

	return false;
}

function buildPoints(
	buckets: BucketAccumulator[],
	options: BuildPointsOptions
): { points: SalaryProgressionPoint[]; hikes: SalaryHike[] } {
	const { hikeThreshold, interval, firstSalaryMs, nowMs, timeZoneOffsetMinutes } = options;
	const points: SalaryProgressionPoint[] = [];
	const candidates: HikeCandidate[] = [];
	let previousTotal: number | undefined;
	let previousAverage: number | undefined;

	for (const bucket of buckets) {
		const monthsWithIncome = bucket.monthKeys.size;
		const total = toFiniteNumber(bucket.total);
		const hasIncome = bucket.transactionCount > 0;
		const coveredMonths = countCoveredMonths(
			bucket.fromMs,
			bucket.toMs,
			firstSalaryMs,
			nowMs,
			timeZoneOffsetMinutes
		);
		// A funded bucket always covers at least the month its payment landed in.
		const monthsCovered = hasIncome ? Math.max(1, coveredMonths) : coveredMonths;
		const average = monthsCovered > 0 ? toFiniteNumber(total / monthsCovered) : 0;

		const delta = previousTotal === undefined ? 0 : toFiniteNumber(total - previousTotal);
		const growthShare = previousTotal === undefined ? null : safeShare(delta, previousTotal);

		// Empty buckets have no run-rate, so comparing them would fabricate a crash-and-recover
		// pattern. They stay neutral and the next funded bucket compares to the last funded one.
		const comparable = monthsWithIncome > 0 && previousAverage !== undefined;
		const averageDelta = comparable ? toFiniteNumber(average - previousAverage!) : 0;
		const averageGrowthShare =
			comparable && previousAverage! > 0 ? safeShare(averageDelta, previousAverage!) : null;

		const point: SalaryProgressionPoint = {
			key: bucket.key,
			label: bucket.label,
			fromMs: bucket.fromMs,
			toMs: bucket.toMs,
			total,
			monthsWithIncome,
			monthsCovered,
			average,
			transactionCount: bucket.transactionCount,
			isPartial: bucket.toMs > nowMs,
			delta,
			growthShare,
			averageDelta,
			averageGrowthShare,
			isHike: false,
		};
		points.push(point);

		if (averageGrowthShare !== null && averageGrowthShare >= hikeThreshold) {
			candidates.push({
				index: points.length - 1,
				fromAverage: previousAverage!,
				share: averageGrowthShare,
			});
		}

		previousTotal = total;
		if (monthsWithIncome > 0) previousAverage = average;
	}

	const hikes: SalaryHike[] = [];
	for (const candidate of candidates) {
		if (interval === "monthly" && !isSustainedHike(points, candidate, hikeThreshold)) continue;

		const point = points[candidate.index];
		if (!point) continue;

		point.isHike = true;
		hikes.push({
			key: point.key,
			label: point.label,
			atMs: point.fromMs,
			fromAverage: candidate.fromAverage,
			toAverage: point.average,
			share: candidate.share,
		});
	}

	return { points, hikes };
}

function computeCagr(
	startingAverage: number,
	latestAverage: number,
	firstFundedFromMs: number | undefined,
	lastFundedFromMs: number | undefined
): number | null {
	if (startingAverage <= 0 || latestAverage <= 0) return null;
	if (firstFundedFromMs === undefined || lastFundedFromMs === undefined) return null;

	const elapsedYears = (lastFundedFromMs - firstFundedFromMs) / MS_PER_YEAR;
	if (!Number.isFinite(elapsedYears) || elapsedYears < MIN_CAGR_YEARS) return null;

	return toFiniteShare((latestAverage / startingAverage) ** (1 / elapsedYears) - 1);
}

function buildAnalytics(
	currency: string,
	query: SalaryProgressionQuery,
	selection: SalaryCategorySelection,
	matchedTransactions: Transaction[],
	firstSalaryMs: number | undefined
): SalaryProgressionAnalytics {
	const now = query.now ?? new Date();
	const interval = resolveInterval(query);
	const timeZoneOffsetMinutes = resolveTimeZoneOffsetMinutes(query, now);
	const fiscalYearStartMonth = resolveFiscalYearStartMonth(query);
	const hikeThreshold = resolveHikeThreshold(query);
	const years = resolveYears(query);

	const base: SalaryProgressionAnalytics = {
		currency,
		interval,
		points: [],
		usedCategoryIds: selection.usedCategoryIds,
		usedFallbackAllIncome: selection.usedFallbackAllIncome,
		totalEarned: 0,
		startingAverage: 0,
		latestAverage: 0,
		overallGrowthShare: null,
		cagr: null,
		hikes: [],
	};

	const windowStart = getWindowStartDate(now, years, firstSalaryMs, timeZoneOffsetMinutes);
	if (!windowStart) return base;

	const buckets: BucketAccumulator[] = buildBucketRanges(
		windowStart,
		now,
		interval,
		fiscalYearStartMonth,
		timeZoneOffsetMinutes
	).map((range) => ({
		key: range.key,
		label: range.shortLabel,
		fromMs: range.fromMs,
		toMs: range.toMs,
		total: 0,
		transactionCount: 0,
		monthKeys: new Set<string>(),
	}));

	let totalEarned = 0;
	let windowFirstMs: number | undefined;
	let windowLastMs: number | undefined;

	for (const transaction of matchedTransactions) {
		const bucket = findBucket(buckets, transaction.date);
		if (!bucket) continue;

		bucket.total += transaction.amount;
		bucket.transactionCount++;
		bucket.monthKeys.add(getMonthKey(new Date(transaction.date), { timeZoneOffsetMinutes }));
		totalEarned += transaction.amount;

		if (windowFirstMs === undefined || transaction.date < windowFirstMs) {
			windowFirstMs = transaction.date;
		}
		if (windowLastMs === undefined || transaction.date > windowLastMs) {
			windowLastMs = transaction.date;
		}
	}

	const { points, hikes } = buildPoints(buckets, {
		hikeThreshold,
		interval,
		firstSalaryMs,
		nowMs: now.getTime(),
		timeZoneOffsetMinutes,
	});
	const fundedPoints = points.filter((point) => point.monthsWithIncome > 0);
	const startingAverage = fundedPoints[0]?.average ?? 0;
	const latestAverage = fundedPoints[fundedPoints.length - 1]?.average ?? 0;

	return {
		...base,
		points,
		hikes,
		firstSalaryMs: windowFirstMs,
		lastSalaryMs: windowLastMs,
		totalEarned: toFiniteNumber(totalEarned),
		startingAverage,
		latestAverage,
		overallGrowthShare:
			startingAverage > 0 ? safeShare(latestAverage - startingAverage, startingAverage) : null,
		cagr: computeCagr(
			startingAverage,
			latestAverage,
			fundedPoints[0]?.fromMs,
			fundedPoints[fundedPoints.length - 1]?.fromMs
		),
	};
}

export function aggregateSalaryProgression(
	userId: string,
	accounts: Account[],
	categories: Category[],
	transactions: Transaction[],
	query: SalaryProgressionQuery
): SalaryProgressionAnalytics {
	const currency = assertCurrency(query.currency);
	const accountIds = getCurrencyAccountIds(userId, accounts, currency);
	const selection = resolveCategorySelection(userId, categories, currency, query);

	const matchedTransactions: Transaction[] = [];
	let firstSalaryMs: number | undefined;

	for (const transaction of transactions) {
		if (!isSalaryTransaction(transaction, userId, accountIds, selection.categoryIdSet)) continue;

		matchedTransactions.push(transaction);
		if (firstSalaryMs === undefined || transaction.date < firstSalaryMs) {
			firstSalaryMs = transaction.date;
		}
	}

	return buildAnalytics(currency, query, selection, matchedTransactions, firstSalaryMs);
}

export async function aggregateSalaryProgressionChunked(
	userId: string,
	accounts: Account[],
	categories: Category[],
	transactions: Transaction[],
	query: SalaryProgressionQuery,
	options: AnalyticsChunkOptions = {}
): Promise<SalaryProgressionAnalytics> {
	const currency = assertCurrency(query.currency);
	const accountIds = getCurrencyAccountIds(userId, accounts, currency);
	const selection = resolveCategorySelection(userId, categories, currency, query);

	const matchedTransactions: Transaction[] = [];
	let firstSalaryMs: number | undefined;
	let processed = 0;

	for (const transaction of transactions) {
		processed++;
		await yieldAfterChunk(processed, options);

		if (!isSalaryTransaction(transaction, userId, accountIds, selection.categoryIdSet)) continue;

		matchedTransactions.push(transaction);
		if (firstSalaryMs === undefined || transaction.date < firstSalaryMs) {
			firstSalaryMs = transaction.date;
		}
	}

	return buildAnalytics(currency, query, selection, matchedTransactions, firstSalaryMs);
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

/** Deterministic cache key for the analytics cache layer. */
export function getSalaryProgressionCacheKey(query: SalaryProgressionQuery): string {
	const now = query.now ?? new Date();
	const interval = resolveInterval(query);
	const timeZoneOffsetMinutes = resolveTimeZoneOffsetMinutes(query, now);
	const fiscalYearStartMonth = resolveFiscalYearStartMonth(query);

	return stableStringify({
		currency: normalizeCurrencyCode(query.currency),
		interval,
		years: resolveYears(query),
		nowKey: getPeriodRangeFor(now, interval, fiscalYearStartMonth, timeZoneOffsetMinutes).key,
		fiscalYearStartMonth,
		categoryIds: uniqueSortedIds(query.categoryIds ?? []),
		autoDetect: query.autoDetect !== false,
		hikeThreshold: resolveHikeThreshold(query),
		timeZoneOffsetMinutes,
	});
}
