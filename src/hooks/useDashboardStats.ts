import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef } from "react";

import { useAnalyticsMonthSummaries } from "@/hooks/useAnalyticsMonthSummaries";
import { usePeriodAnalytics } from "@/hooks/usePeriodAnalytics";
import { getDashboardStatsReadState } from "@/lib/analytics/cache";
import { DEFAULT_TREND_MONTHS } from "@/lib/analytics/computeDashboardStats";
import { scheduleAnalyticsRecompute } from "@/lib/analytics/scheduleRecompute";

import type { PeriodAnalytics } from "@/lib/analytics/periodAnalytics";
import type { DashboardStats } from "@/types";

export interface DashboardStatsQuery {
	month: string;
	from: number;
	to: number;
	currency?: string;
}

type DashboardCategoryBreakdownItem = {
	id?: string;
	name: string;
	value: number;
	color?: string;
	month?: string;
};

type DashboardBucketWithBreakdown = DashboardStats["perCurrency"][string] & {
	categoryBreakdownByMonth?: Record<string, DashboardCategoryBreakdownItem[]>;
	expenseCategoriesByMonth?: Record<string, DashboardCategoryBreakdownItem[]>;
};

function toDashboardCategoryBreakdown(
	query: DashboardStatsQuery,
	analytics: PeriodAnalytics
): DashboardCategoryBreakdownItem[] {
	return analytics.expenseBreakdown.map((item) => ({
		...(item.categoryId && { id: item.categoryId }),
		name: item.title,
		value: item.amount,
		...(item.color && { color: item.color }),
		month: query.month,
	}));
}

export function useDashboardStats(
	userId: string,
	query?: DashboardStatsQuery
): DashboardStats | undefined {
	const requestedUserIdsRef = useRef(new Set<string>());
	const statsState = useLiveQuery(async () => {
		if (!userId) return undefined;
		return getDashboardStatsReadState(userId);
	}, [userId]);
	const stats = statsState?.value;
	const analytics = usePeriodAnalytics(
		userId,
		query?.currency
			? {
					currency: query.currency,
					interval: "custom",
					customRange: { from: new Date(query.from), to: new Date(query.to) },
				}
			: undefined
	);
	const trend = useAnalyticsMonthSummaries(
		userId,
		query?.currency
			? {
					currency: query.currency,
					months: DEFAULT_TREND_MONTHS,
					anchorDate: new Date(query.from),
					mode: "ending",
				}
			: undefined
	);

	useEffect(() => {
		requestedUserIdsRef.current.clear();
	}, [userId]);

	useEffect(() => {
		if (!userId || !statsState) return;
		if (statsState.value !== undefined) {
			requestedUserIdsRef.current.delete(userId);
			return;
		}
		if (requestedUserIdsRef.current.has(userId)) return;
		requestedUserIdsRef.current.add(userId);
		scheduleAnalyticsRecompute(userId);
	}, [userId, statsState]);

	if (!stats || !query?.currency || !analytics || !trend) return stats;

	const existingBucket = stats.perCurrency[query.currency];
	const categoryBreakdown = toDashboardCategoryBreakdown(query, analytics);
	const patchedBucket: DashboardBucketWithBreakdown = {
		...existingBucket,
		monthIncome: analytics.income,
		monthExpense: analytics.expense,
		trend: trend.map((item) => ({
			month: item.month,
			income: item.income,
			expense: item.expense,
		})),
		categoryBreakdownByMonth: {
			...((existingBucket as DashboardBucketWithBreakdown | undefined)?.categoryBreakdownByMonth ??
				{}),
			[query.month]: categoryBreakdown,
		},
		expenseCategoriesByMonth: {
			...((existingBucket as DashboardBucketWithBreakdown | undefined)?.expenseCategoriesByMonth ??
				{}),
			[query.month]: categoryBreakdown,
		},
	};

	return {
		...stats,
		perCurrency: {
			...stats.perCurrency,
			[query.currency]: patchedBucket,
		},
	};
}
