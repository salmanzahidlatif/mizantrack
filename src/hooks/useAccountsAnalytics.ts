import { useCachedAnalyticsValue } from "@/hooks/useCachedAnalyticsValue";
import { getAccountsAnalyticsCacheKey } from "@/lib/analytics/cache";
import {
	aggregateAccountsAnalyticsChunked,
	type AccountsAnalytics,
	type AccountsAnalyticsQuery,
} from "@/lib/analytics/periodAnalytics";

export function useAccountsAnalytics(
	userId: string,
	query: AccountsAnalyticsQuery | undefined
): AccountsAnalytics | undefined {
	const cacheKey = query?.currency ? getAccountsAnalyticsCacheKey(query) : undefined;
	return useCachedAnalyticsValue({
		userId,
		namespace: "accounts",
		cacheKey,
		label: "accounts analytics",
		compute: (source) => {
			if (!query?.currency) throw new Error("Accounts analytics query is missing a currency.");
			return aggregateAccountsAnalyticsChunked(userId, source.accounts, source.transactions, query);
		},
		dependencies: [
			query?.currency,
			query?.enabledCurrencies?.join(","),
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
	});
}
