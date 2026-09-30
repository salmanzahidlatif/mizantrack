import { useCachedAnalyticsValue } from "@/hooks/useCachedAnalyticsValue";
import { getMonthlySummariesCacheKey } from "@/lib/analytics/cache";
import {
	aggregateMonthlySummariesChunked,
	type AnalyticsMonthSummaryItem,
	type MonthlySummariesQuery,
} from "@/lib/analytics/periodAnalytics";

export function useAnalyticsMonthSummaries(
	userId: string,
	query: MonthlySummariesQuery | undefined
): AnalyticsMonthSummaryItem[] | undefined {
	const cacheKey = query?.currency ? getMonthlySummariesCacheKey(query) : undefined;
	return useCachedAnalyticsValue({
		userId,
		namespace: "monthlySummaries",
		cacheKey,
		label: "month summaries",
		compute: (source) => {
			if (!query?.currency) throw new Error("Monthly summaries query is missing a currency.");
			return aggregateMonthlySummariesChunked(userId, source.accounts, source.transactions, query);
		},
		dependencies: [
			query?.currency,
			query?.months,
			query?.anchorDate?.getTime(),
			query?.mode,
			query?.timeZoneOffsetMinutes,
		],
	});
}
