import { useCachedAnalyticsValue } from "@/hooks/useCachedAnalyticsValue";
import { getComparisonAnalyticsCacheKey } from "@/lib/analytics/cache";
import {
	aggregateComparisonAnalyticsChunked,
	type ComparisonAnalytics,
	type ComparisonAnalyticsQuery,
} from "@/lib/analytics/comparisonAnalytics";

export function useComparisonAnalytics(
	userId: string,
	query: ComparisonAnalyticsQuery | undefined
): ComparisonAnalytics | undefined {
	const cacheKey = query?.currency ? getComparisonAnalyticsCacheKey(query) : undefined;
	return useCachedAnalyticsValue({
		userId,
		namespace: "comparisons",
		cacheKey,
		label: "comparison analytics",
		compute: (source) => {
			if (!query?.currency) throw new Error("Comparison analytics query is missing a currency.");
			return aggregateComparisonAnalyticsChunked(
				userId,
				source.accounts,
				source.categories,
				source.transactions,
				query
			);
		},
		dependencies: [
			query?.currency,
			query?.presetId,
			query?.now?.getTime(),
			query?.customRange?.from.getTime(),
			query?.customRange?.to.getTime(),
			query?.fiscalYearStartMonth,
			query?.timeZoneOffsetMinutes,
			query?.topCount,
		],
	});
}
