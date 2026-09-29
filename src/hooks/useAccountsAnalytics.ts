import { useDeferredLiveQuery } from "@/hooks/useDeferredLiveQuery";
import {
	getAccountsAnalytics,
	type AccountsAnalytics,
	type AccountsAnalyticsQuery,
} from "@/lib/analytics/periodAnalytics";

export function useAccountsAnalytics(
	userId: string,
	query: AccountsAnalyticsQuery | undefined
): AccountsAnalytics | undefined {
	return useDeferredLiveQuery(
		async () => {
			if (!userId || !query?.currency) return undefined;
			return getAccountsAnalytics(userId, query);
		},
		[
			userId,
			query?.currency,
			query?.asOf?.getTime(),
			query?.timeZoneOffsetMinutes,
			query?.period?.interval,
			query?.period?.anchorDate?.getTime(),
			query?.period?.fiscalYearStartMonth,
			query?.period?.customRange?.from.getTime(),
			query?.period?.customRange?.to.getTime(),
			query?.period?.now?.getTime(),
			query?.period?.timeZoneOffsetMinutes,
		],
		{ label: "accounts analytics" }
	);
}
