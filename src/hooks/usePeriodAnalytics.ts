import { useDeferredLiveQuery } from "@/hooks/useDeferredLiveQuery";
import {
	getPeriodAnalytics,
	type PeriodAnalytics,
	type PeriodAnalyticsQuery,
} from "@/lib/analytics/periodAnalytics";

export function usePeriodAnalytics(
	userId: string,
	query: PeriodAnalyticsQuery | undefined
): PeriodAnalytics | undefined {
	return useDeferredLiveQuery(
		async () => {
			if (!userId || !query?.currency) return undefined;
			return getPeriodAnalytics(userId, query);
		},
		[
			userId,
			query?.currency,
			query?.interval,
			query?.anchorDate?.getTime(),
			query?.fiscalYearStartMonth,
			query?.customRange?.from.getTime(),
			query?.customRange?.to.getTime(),
			query?.now?.getTime(),
			query?.timeZoneOffsetMinutes,
		],
		{ label: "period analytics" }
	);
}
