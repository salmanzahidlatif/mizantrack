import { getActiveUserAccounts, normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { yieldAfterChunk, type AnalyticsChunkOptions } from "@/lib/analytics/chunking";
import {
	attributeSalaryPayments,
	getMonthIndex,
	getMonthStartMs,
} from "@/lib/analytics/salaryAttribution";
import {
	getLocalTimeZoneOffsetMinutes,
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
	/** True when a confirmed salary raise took effect inside this bucket. */
	isHike: boolean;
}

export interface SalaryHike {
	/** Month the raise took effect: "2025-04". */
	key: string;
	/** Month label: "Apr 25". */
	label: string;
	/** Key of the chart bucket containing the raise month, for placing markers. */
	bucketKey: string;
	atMs: number;
	/** Typical monthly salary before the raise (median of the preceding months). */
	fromAverage: number;
	/** Confirmed monthly salary after the raise. */
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
	/**
	 * Payments counted in a different month from the one they were credited in, because
	 * their description named that month or they were paid early/late into an empty month.
	 */
	reattributedPaymentCount: number;
	firstSalaryMs?: number;
	lastSalaryMs?: number;
	totalEarned: number;
	/**
	 * Typical monthly salary at the start: median of the first few paid months. A median
	 * keeps a prorated joining month or a catch-up payment from skewing the baseline.
	 */
	startingAverage: number;
	/** Typical monthly salary now: median of the latest few paid months. */
	latestAverage: number;
	/** (latestAverage - startingAverage) / startingAverage, or null when starting is 0. */
	overallGrowthShare: number | null;
	/** Compound annual growth rate of the monthly salary, or null when not computable. */
	cagr: number | null;
	hikes: SalaryHike[];
}

const DEFAULT_INTERVAL: SalaryProgressionInterval = "yearly";
const DEFAULT_HIKE_THRESHOLD = 0.05;
const MONTHS_PER_YEAR = 12;
const MS_PER_YEAR = 365.2425 * 24 * 60 * 60 * 1000;
/** Hard cap so a pathological date can never emit an unbounded series. */
const MAX_BUCKET_COUNT = 600;
/** Below this elapsed span a compound annual rate is meaningless noise. */
const MIN_CAGR_YEARS = 0.5;
/**
 * Raises are detected on the monthly salary series, whatever the chart interval.
 * The baseline is the median of the last few paid months, so a single bonus month or a
 * month holding only a small side payment can never become the "before" figure.
 */
const HIKE_BASELINE_MONTHS = 3;
/** The start of employment is noisy (prorated pay, arrears), so look at more months. */
const STARTING_SALARY_MONTHS = 6;
const LATEST_SALARY_MONTHS = 3;
/**
 * The latest month is reported as-is unless it strays this far from the recent median,
 * which marks it as a bonus or a short month rather than the current salary level.
 */
const LATEST_OUTLIER_SHARE = 0.25;

interface BucketAccumulator {
	key: string;
	label: string;
	fromMs: number;
	toMs: number;
	total: number;
	transactionCount: number;
	monthIndices: Set<number>;
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

/**
 * Calendar months a bucket covers, clamped so partial buckets stay honest:
 * months before employment started and months that have not been paid yet are excluded.
 * `coverageEndMs` stops before the current month until this month's salary has arrived,
 * otherwise the latest bucket looks like a pay cut every month before payday.
 */
function countCoveredMonths(
	fromMs: number,
	toMs: number,
	firstSalaryMs: number | undefined,
	coverageEndMs: number,
	timeZoneOffsetMinutes: number
): number {
	const start = firstSalaryMs === undefined ? fromMs : Math.max(fromMs, firstSalaryMs);
	const end = Math.min(toMs, coverageEndMs);
	if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;

	const months =
		getMonthIndex(end, timeZoneOffsetMinutes) - getMonthIndex(start, timeZoneOffsetMinutes) + 1;
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
	firstSalaryMs: number | undefined;
	nowMs: number;
	coverageEndMs: number;
	timeZoneOffsetMinutes: number;
	hikeMonthStartMs: number[];
}

function buildPoints(
	buckets: BucketAccumulator[],
	options: BuildPointsOptions
): SalaryProgressionPoint[] {
	const { firstSalaryMs, nowMs, coverageEndMs, timeZoneOffsetMinutes, hikeMonthStartMs } = options;
	const points: SalaryProgressionPoint[] = [];
	let previousTotal: number | undefined;
	let previousAverage: number | undefined;

	for (const bucket of buckets) {
		const monthsWithIncome = bucket.monthIndices.size;
		const total = toFiniteNumber(bucket.total);
		const hasIncome = bucket.transactionCount > 0;
		const coveredMonths = countCoveredMonths(
			bucket.fromMs,
			bucket.toMs,
			firstSalaryMs,
			coverageEndMs,
			timeZoneOffsetMinutes
		);
		// A funded bucket always covers at least the month its payment is attributed to.
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

		points.push({
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
			isHike: hikeMonthStartMs.some((ms) => ms >= bucket.fromMs && ms <= bucket.toMs),
		});

		previousTotal = total;
		if (monthsWithIncome > 0) previousAverage = average;
	}

	return points;
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

interface MonthlySalary {
	monthIndex: number;
	total: number;
}

/**
 * Current monthly salary. The newest month wins so a raise shows immediately, unless it
 * is far off the recent median (a bonus month, or a month short of its payment).
 */
function getLatestSalaryLevel(values: number[]): number {
	const latest = values[values.length - 1];
	if (latest === undefined) return 0;

	const recentMedian = median(values.slice(-LATEST_SALARY_MONTHS));
	if (recentMedian <= 0) return latest;
	return Math.abs(latest - recentMedian) / recentMedian <= LATEST_OUTLIER_SHARE
		? latest
		: recentMedian;
}

interface DetectedHike {
	month: MonthlySalary;
	fromAverage: number;
	toAverage: number;
	share: number;
}

/**
 * Raises on the monthly salary series. A month counts as a raise only when it clears the
 * threshold against the median of the preceding paid months AND the next paid month holds
 * that level too. The raise size uses the lower of the two months, so a bonus landing in
 * the raise month cannot inflate it. After a raise the baseline resets to the new level.
 */
function detectHikes(months: MonthlySalary[], hikeThreshold: number): DetectedHike[] {
	const hikes: DetectedHike[] = [];
	let baselineWindow: number[] = [];

	for (let index = 0; index < months.length; index++) {
		const month = months[index]!;
		const next = months[index + 1];

		if (baselineWindow.length >= HIKE_BASELINE_MONTHS && next) {
			const baseline = median(baselineWindow);
			const required = baseline * (1 + hikeThreshold);
			if (baseline > 0 && month.total >= required && next.total >= required) {
				const level = Math.min(month.total, next.total);
				const share = safeShare(level - baseline, baseline);
				if (share !== null && share >= hikeThreshold) {
					hikes.push({ month, fromAverage: baseline, toAverage: level, share });
					baselineWindow = Array.from({ length: HIKE_BASELINE_MONTHS }, () => level);
					continue;
				}
			}
		}

		baselineWindow.push(month.total);
		if (baselineWindow.length > HIKE_BASELINE_MONTHS) baselineWindow.shift();
	}

	return hikes;
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
	matchedTransactions: Transaction[]
): SalaryProgressionAnalytics {
	const now = query.now ?? new Date();
	const nowMs = now.getTime();
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
		reattributedPaymentCount: 0,
		totalEarned: 0,
		startingAverage: 0,
		latestAverage: 0,
		overallGrowthShare: null,
		cagr: null,
		hikes: [],
	};

	const attributions = attributeSalaryPayments(matchedTransactions, {
		nowMs,
		timeZoneOffsetMinutes,
	});
	const payments = matchedTransactions
		.map((transaction) => {
			const attribution = attributions.get(transaction.id);
			return {
				amount: transaction.amount,
				effectiveMs: attribution?.effectiveMs ?? transaction.date,
				monthIndex:
					attribution?.monthIndex ?? getMonthIndex(transaction.date, timeZoneOffsetMinutes),
				moved: attribution !== undefined && attribution.reason !== "credited",
			};
		})
		.sort((a, b) => a.effectiveMs - b.effectiveMs);

	const firstSalaryMs = payments[0]?.effectiveMs;
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
		monthIndices: new Set<number>(),
	}));

	let totalEarned = 0;
	let reattributedPaymentCount = 0;
	let windowFirstMs: number | undefined;
	let windowLastMs: number | undefined;
	const monthlyTotals = new Map<number, number>();

	for (const payment of payments) {
		const bucket = findBucket(buckets, payment.effectiveMs);
		if (!bucket) continue;

		bucket.total += payment.amount;
		bucket.transactionCount++;
		bucket.monthIndices.add(payment.monthIndex);
		totalEarned += payment.amount;
		monthlyTotals.set(
			payment.monthIndex,
			(monthlyTotals.get(payment.monthIndex) ?? 0) + payment.amount
		);
		if (payment.moved) reattributedPaymentCount++;

		windowFirstMs ??= payment.effectiveMs;
		windowLastMs = payment.effectiveMs;
	}

	const nowMonthIndex = getMonthIndex(nowMs, timeZoneOffsetMinutes);
	const coverageEndMs = monthlyTotals.has(nowMonthIndex)
		? nowMs
		: getMonthStartMs(nowMonthIndex, timeZoneOffsetMinutes) - 1;

	const monthlySeries: MonthlySalary[] = [...monthlyTotals.entries()]
		.map(([monthIndex, total]) => ({ monthIndex, total: toFiniteNumber(total) }))
		.sort((a, b) => a.monthIndex - b.monthIndex);

	const hikes: SalaryHike[] = detectHikes(monthlySeries, hikeThreshold).map((hike) => {
		const atMs = getMonthStartMs(hike.month.monthIndex, timeZoneOffsetMinutes);
		const range = getPeriodRangeFor(new Date(atMs), "monthly", undefined, timeZoneOffsetMinutes);
		return {
			key: range.key,
			label: range.shortLabel,
			bucketKey: findBucket(buckets, atMs)?.key ?? range.key,
			atMs,
			fromAverage: toFiniteNumber(hike.fromAverage),
			toAverage: toFiniteNumber(hike.toAverage),
			share: hike.share,
		};
	});

	const points = buildPoints(buckets, {
		firstSalaryMs,
		nowMs,
		coverageEndMs,
		timeZoneOffsetMinutes,
		hikeMonthStartMs: hikes.map((hike) => hike.atMs),
	});

	const monthlyValues = monthlySeries.map((month) => month.total);
	const startingAverage = toFiniteNumber(median(monthlyValues.slice(0, STARTING_SALARY_MONTHS)));
	const latestAverage = toFiniteNumber(getLatestSalaryLevel(monthlyValues));
	const firstMonth = monthlySeries[0];
	const lastMonth = monthlySeries[monthlySeries.length - 1];

	return {
		...base,
		points,
		hikes,
		reattributedPaymentCount,
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
			firstMonth && getMonthStartMs(firstMonth.monthIndex, timeZoneOffsetMinutes),
			lastMonth && getMonthStartMs(lastMonth.monthIndex, timeZoneOffsetMinutes)
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

	const matchedTransactions = transactions.filter((transaction) =>
		isSalaryTransaction(transaction, userId, accountIds, selection.categoryIdSet)
	);

	return buildAnalytics(currency, query, selection, matchedTransactions);
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
	let processed = 0;

	for (const transaction of transactions) {
		processed++;
		await yieldAfterChunk(processed, options);

		if (isSalaryTransaction(transaction, userId, accountIds, selection.categoryIdSet)) {
			matchedTransactions.push(transaction);
		}
	}

	return buildAnalytics(currency, query, selection, matchedTransactions);
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
