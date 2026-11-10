import { useCachedAnalyticsValue } from "@/hooks/useCachedAnalyticsValue";
import { getSalaryProgressionCacheKey } from "@/lib/analytics/cache";
import {
	aggregateSalaryProgressionChunked,
	type SalaryProgressionAnalytics,
	type SalaryProgressionQuery,
} from "@/lib/analytics/salaryProgression";

export function useSalaryProgression(
	userId: string,
	query: SalaryProgressionQuery | undefined
): SalaryProgressionAnalytics | undefined {
	const cacheKey = query?.currency ? getSalaryProgressionCacheKey(query) : undefined;
	return useCachedAnalyticsValue({
		userId,
		namespace: "salaryProgression",
		cacheKey,
		label: "salary progression",
		compute: (source) => {
			if (!query?.currency) throw new Error("Salary progression query is missing a currency.");
			return aggregateSalaryProgressionChunked(
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
			query?.years,
			query?.now?.getTime(),
			query?.timeZoneOffsetMinutes,
			query?.fiscalYearStartMonth,
			query?.categoryIds?.join(","),
			query?.autoDetect,
			query?.hikeThreshold,
		],
	});
}
