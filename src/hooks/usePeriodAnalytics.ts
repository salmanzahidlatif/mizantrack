import { useCachedAnalyticsValue } from "@/hooks/useCachedAnalyticsValue";
import { getPeriodAnalyticsCacheKey } from "@/lib/analytics/cache";
import {
	aggregatePeriodAnalyticsChunked,
	type PeriodAnalytics,
	type PeriodAnalyticsQuery,
} from "@/lib/analytics/periodAnalytics";

export function usePeriodAnalytics(
	userId: string,
	query: PeriodAnalyticsQuery | undefined
): PeriodAnalytics | undefined {
	const cacheKey = query?.currency ? getPeriodAnalyticsCacheKey(query) : undefined;
	return useCachedAnalyticsValue({
		userId,
		namespace: "periods",
		cacheKey,
		label: "period analytics",
		compute: (source) => {
			if (!query?.currency) throw new Error("Period analytics query is missing a currency.");
			return aggregatePeriodAnalyticsChunked(
				userId,
				source.accounts,
				source.categories,
				source.transactions,
				query
			);
		},
		dependencies: [
			query?.currency,
			query?.interval,
			query?.anchorDate?.getTime(),
			query?.fiscalYearStartMonth,
			query?.customRange?.from.getTime(),
			query?.customRange?.to.getTime(),
			query?.now?.getTime(),
			query?.timeZoneOffsetMinutes,
		],
	});
}
