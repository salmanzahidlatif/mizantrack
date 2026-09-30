import {
	ANALYTICS_CACHE_LOGIC_VERSION,
	buildAnalyticsDataVersion,
	getAnalyticsSourceData,
	isDashboardStatsCacheValid,
	markDashboardStatsCacheValid,
	type AnalyticsSourceData,
} from "@/lib/analytics/cacheMetadata";
import { aggregateDashboardStats } from "@/lib/analytics/computeDashboardStats";
import { getDateRange, resolveAnalyticsPeriod, type AnalyticsInterval } from "@/lib/dateRange";
import { db } from "@/lib/db/local";

import type {
	AccountsAnalytics,
	AccountsAnalyticsQuery,
	AnalyticsMonthSummaryItem,
	MonthlySummariesQuery,
	PeriodAnalytics,
	PeriodAnalyticsQuery,
} from "@/lib/analytics/periodAnalytics";
import type { DateRange, DashboardStats } from "@/types";

type AnalyticsCacheNamespace = "accounts" | "periods" | "monthlySummaries";

type CachedAnalyticsValueByNamespace = {
	accounts: AccountsAnalytics;
	periods: PeriodAnalytics;
	monthlySummaries: AnalyticsMonthSummaryItem[];
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function normalizeCacheCurrency(currency: string): string {
	return currency.trim().toUpperCase();
}

function dateMs(date: Date | undefined): number | undefined {
	return date?.getTime();
}

function rangeMs(range: DateRange | undefined) {
	if (!range) return undefined;
	return {
		from: range.from.getTime(),
		to: range.to.getTime(),
	};
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

function getEndOfAsOfDayMs(asOf: Date, timeZoneOffsetMinutes?: number): number {
	return getDateRange("today", 1, undefined, {
		now: asOf,
		timeZoneOffsetMinutes,
	}).to.getTime();
}

function getResolvedPeriodKey(
	query: Omit<PeriodAnalyticsQuery, "currency"> = {},
	fallbackInterval?: AnalyticsInterval
) {
	const period = resolveAnalyticsPeriod({
		interval: query.interval ?? fallbackInterval ?? (query.customRange ? "custom" : "monthly"),
		anchorDate: query.anchorDate ?? query.now,
		fiscalYearStartMonth: query.fiscalYearStartMonth,
		customRange: query.customRange,
		now: query.now,
		timeZoneOffsetMinutes: query.timeZoneOffsetMinutes,
	});

	return {
		interval: period.interval,
		fromMs: period.fromMs,
		toMs: period.toMs,
		label: period.label,
		timeZoneOffsetMinutes: query.timeZoneOffsetMinutes,
	};
}

export function getPeriodAnalyticsCacheKey(query: PeriodAnalyticsQuery): string {
	return stableStringify({
		currency: normalizeCacheCurrency(query.currency),
		period: getResolvedPeriodKey(query),
		fiscalYearStartMonth: query.fiscalYearStartMonth,
	});
}

export function getMonthlySummariesCacheKey(query: MonthlySummariesQuery): string {
	return stableStringify({
		currency: normalizeCacheCurrency(query.currency),
		months: Math.max(1, Math.floor(query.months ?? 6)),
		anchorDate: dateMs(query.anchorDate),
		mode: query.mode ?? "ending",
		timeZoneOffsetMinutes: query.timeZoneOffsetMinutes,
	});
}

export function getAccountsAnalyticsCacheKey(query: AccountsAnalyticsQuery): string {
	const asOf = query.asOf ?? new Date();
	const period = getResolvedPeriodKey(query.period, "monthly");

	return stableStringify({
		currency: normalizeCacheCurrency(query.currency),
		enabledCurrencies: [...(query.enabledCurrencies ?? [])].map(normalizeCacheCurrency).sort(),
		asOfDay: Math.floor(getEndOfAsOfDayMs(asOf, query.timeZoneOffsetMinutes) / MS_PER_DAY),
		asOfMs: getEndOfAsOfDayMs(asOf, query.timeZoneOffsetMinutes),
		period,
		customRange: rangeMs(query.period?.customRange),
		timeZoneOffsetMinutes: query.timeZoneOffsetMinutes,
	});
}

function buildValidDashboardStats(
	userId: string,
	source: AnalyticsSourceData,
	dataVersion: string
): DashboardStats {
	const stats = aggregateDashboardStats(userId, source.accounts, source.transactions);
	return markDashboardStatsCacheValid(
		{
			...stats,
			analyticsCache: undefined,
		},
		dataVersion
	);
}

export async function getOrComputeDashboardStats(userId: string): Promise<DashboardStats> {
	const source = await getAnalyticsSourceData(userId);
	const dataVersion = buildAnalyticsDataVersion(source);
	const existing = await db.dashboardStats.get(userId);
	if (isDashboardStatsCacheValid(existing, dataVersion)) return existing;

	const stats = buildValidDashboardStats(userId, source, dataVersion);
	await db.dashboardStats.put(stats);
	return stats;
}

export async function getValidDashboardStats(userId: string): Promise<DashboardStats | undefined> {
	const source = await getAnalyticsSourceData(userId);
	const dataVersion = buildAnalyticsDataVersion(source);
	const existing = await db.dashboardStats.get(userId);
	if (isDashboardStatsCacheValid(existing, dataVersion)) return existing;
	return undefined;
}

export async function getOrComputeCachedAnalyticsValue<TNamespace extends AnalyticsCacheNamespace>(
	userId: string,
	namespace: TNamespace,
	key: string,
	compute: (
		source: AnalyticsSourceData
	) =>
		| CachedAnalyticsValueByNamespace[TNamespace]
		| Promise<CachedAnalyticsValueByNamespace[TNamespace]>
): Promise<CachedAnalyticsValueByNamespace[TNamespace]> {
	const source = await getAnalyticsSourceData(userId);
	const dataVersion = buildAnalyticsDataVersion(source);
	const existing = await db.dashboardStats.get(userId);
	const cachedEntry = existing?.analyticsCache?.[namespace]?.[key];

	if (
		isDashboardStatsCacheValid(existing, dataVersion) &&
		cachedEntry?.logicVersion === ANALYTICS_CACHE_LOGIC_VERSION &&
		cachedEntry.dataVersion === dataVersion
	) {
		return cachedEntry.value as CachedAnalyticsValueByNamespace[TNamespace];
	}

	const value = await compute(source);
	const baseStats = isDashboardStatsCacheValid(existing, dataVersion)
		? existing
		: buildValidDashboardStats(userId, source, dataVersion);
	const analyticsCache = {
		...baseStats.analyticsCache,
		[namespace]: {
			...(baseStats.analyticsCache?.[namespace] ?? {}),
			[key]: {
				logicVersion: ANALYTICS_CACHE_LOGIC_VERSION,
				dataVersion,
				key,
				updatedAt: Date.now(),
				value,
			},
		},
	};

	await db.dashboardStats.put({
		...baseStats,
		analyticsCache,
	});

	return value;
}

export async function invalidateAnalyticsCache(userId: string): Promise<void> {
	if (!userId) return;
	if (typeof db.dashboardStats?.get !== "function") return;

	const existing = await db.dashboardStats.get(userId);
	if (!existing) return;

	await db.dashboardStats.put({
		...existing,
		logicVersion: ANALYTICS_CACHE_LOGIC_VERSION,
		cacheStatus: "recomputing",
		cacheUpdatedAt: Date.now(),
	});
}

export async function clearAnalyticsCache(userId: string): Promise<void> {
	if (!userId) return;
	if (typeof db.dashboardStats?.delete !== "function") return;
	await db.dashboardStats.delete(userId);
}

export function stripAnalyticsQueryCache(stats: DashboardStats): DashboardStats {
	const { analyticsCache: _analyticsCache, ...rest } = stats;
	return rest;
}
