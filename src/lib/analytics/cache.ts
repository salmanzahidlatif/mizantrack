import {
	ANALYTICS_CACHE_LOGIC_VERSION,
	buildAnalyticsDataVersion,
	getAnalyticsDataVersion,
	getAnalyticsSourceData,
	isDashboardStatsCacheValid,
	markDashboardStatsCacheValid,
	type AnalyticsSourceData,
} from "@/lib/analytics/cacheMetadata";
import { aggregateDashboardStatsChunked } from "@/lib/analytics/computeDashboardStats";
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

export type CachedAnalyticsReadState<TNamespace extends AnalyticsCacheNamespace> = {
	value: CachedAnalyticsValueByNamespace[TNamespace] | undefined;
	cacheStatus: DashboardStats["cacheStatus"] | "missing" | "invalid";
	cacheUpdatedAt?: number;
	dataVersion?: string;
	token: string;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const activeAnalyticsComputations = new Map<string, Promise<unknown>>();

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

async function buildValidDashboardStats(
	userId: string,
	source: AnalyticsSourceData,
	dataVersion: string
): Promise<DashboardStats> {
	const stats = await aggregateDashboardStatsChunked(userId, source.accounts, source.transactions);
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

	const stats = await buildValidDashboardStats(userId, source, dataVersion);
	await db.dashboardStats.put(stats);
	return stats;
}

function isStoredDashboardStatsCacheValid(
	stats: DashboardStats | undefined
): stats is DashboardStats & { dataVersion: string } {
	return (
		stats?.logicVersion === ANALYTICS_CACHE_LOGIC_VERSION &&
		typeof stats.dataVersion === "string" &&
		stats.cacheStatus === "valid"
	);
}

export async function getValidDashboardStats(userId: string): Promise<DashboardStats | undefined> {
	const [existing, dataVersion] = await Promise.all([
		db.dashboardStats.get(userId),
		getAnalyticsDataVersion(userId),
	]);
	if (isStoredDashboardStatsCacheValid(existing) && existing.dataVersion === dataVersion) {
		return existing;
	}
	return undefined;
}

function getActiveComputationKey(
	userId: string,
	namespace: AnalyticsCacheNamespace,
	key: string
): string {
	return `${userId}\u001f${namespace}\u001f${key}`;
}

function readCachedEntry<TNamespace extends AnalyticsCacheNamespace>(
	stats: DashboardStats | undefined,
	namespace: TNamespace,
	key: string,
	dataVersion?: string
): CachedAnalyticsValueByNamespace[TNamespace] | undefined {
	if (!stats || !isStoredDashboardStatsCacheValid(stats)) return undefined;
	if (dataVersion !== undefined && stats.dataVersion !== dataVersion) return undefined;
	const cachedEntry = stats.analyticsCache?.[namespace]?.[key];

	if (
		cachedEntry?.logicVersion === ANALYTICS_CACHE_LOGIC_VERSION &&
		cachedEntry.dataVersion === stats.dataVersion
	) {
		return cachedEntry.value as CachedAnalyticsValueByNamespace[TNamespace];
	}

	return undefined;
}

export async function getCachedAnalyticsValue<TNamespace extends AnalyticsCacheNamespace>(
	userId: string,
	namespace: TNamespace,
	key: string
): Promise<CachedAnalyticsValueByNamespace[TNamespace] | undefined> {
	const [stats, dataVersion] = await Promise.all([
		db.dashboardStats.get(userId),
		getAnalyticsDataVersion(userId),
	]);
	return readCachedEntry(stats, namespace, key, dataVersion);
}

export async function getCachedAnalyticsReadState<TNamespace extends AnalyticsCacheNamespace>(
	userId: string,
	namespace: TNamespace,
	key: string
): Promise<CachedAnalyticsReadState<TNamespace>> {
	const [stats, dataVersion] = await Promise.all([
		db.dashboardStats.get(userId),
		getAnalyticsDataVersion(userId),
	]);
	const value = readCachedEntry(stats, namespace, key, dataVersion);
	let status: CachedAnalyticsReadState<TNamespace>["cacheStatus"];
	if (!stats) {
		status = "missing";
	} else if (isStoredDashboardStatsCacheValid(stats)) {
		status = stats.dataVersion === dataVersion ? "valid" : "invalid";
	} else {
		status = stats.cacheStatus ?? "invalid";
	}
	const entry = stats?.analyticsCache?.[namespace]?.[key];

	return {
		value,
		cacheStatus: status,
		cacheUpdatedAt: stats?.cacheUpdatedAt,
		dataVersion: stats?.dataVersion,
		token: stableStringify({
			status,
			statsLogicVersion: stats?.logicVersion,
			dataVersion: stats?.dataVersion,
			currentDataVersion: dataVersion,
			cacheUpdatedAt: stats?.cacheUpdatedAt,
			entryLogicVersion: entry?.logicVersion,
			entryDataVersion: entry?.dataVersion,
			entryUpdatedAt: entry?.updatedAt,
		}),
	};
}

async function computeCachedAnalyticsValue<TNamespace extends AnalyticsCacheNamespace>(
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
	const existingCached = readCachedEntry(existing, namespace, key);
	if (isDashboardStatsCacheValid(existing, dataVersion) && existingCached) return existingCached;

	const value = await compute(source);
	const verifiedDataVersion = await getAnalyticsDataVersion(userId);
	if (verifiedDataVersion !== dataVersion) {
		return computeCachedAnalyticsValue(userId, namespace, key, compute);
	}

	const latest = await db.dashboardStats.get(userId);
	const baseStats = isDashboardStatsCacheValid(latest, dataVersion)
		? latest
		: await buildValidDashboardStats(userId, source, dataVersion);
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
	const activeKey = getActiveComputationKey(userId, namespace, key);
	const active = activeAnalyticsComputations.get(activeKey) as
		| Promise<CachedAnalyticsValueByNamespace[TNamespace]>
		| undefined;
	if (active) return active;

	const run = computeCachedAnalyticsValue(userId, namespace, key, compute).finally(() => {
		activeAnalyticsComputations.delete(activeKey);
	});
	activeAnalyticsComputations.set(activeKey, run);
	return run;
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
