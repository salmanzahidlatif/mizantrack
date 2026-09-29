import { useDeferredLiveQuery } from "@/hooks/useDeferredLiveQuery";
import {
	getMonthlySummaries,
	type AnalyticsMonthSummaryItem,
	type MonthlySummariesQuery,
} from "@/lib/analytics/periodAnalytics";

export function useAnalyticsMonthSummaries(
	userId: string,
	query: MonthlySummariesQuery | undefined
): AnalyticsMonthSummaryItem[] | undefined {
	return useDeferredLiveQuery(
		async () => {
			if (!userId || !query?.currency) return undefined;
			return getMonthlySummaries(userId, query);
		},
		[
			userId,
			query?.currency,
			query?.months,
			query?.anchorDate?.getTime(),
			query?.mode,
			query?.timeZoneOffsetMinutes,
		],
		{ label: "month summaries" }
	);
}
