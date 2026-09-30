import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";

import { useAnalyticsMonthSummaries } from "@/hooks/useAnalyticsMonthSummaries";
import { usePeriodAnalytics } from "@/hooks/usePeriodAnalytics";
import { getValidDashboardStats } from "@/lib/analytics/cache";
import { DEFAULT_TREND_MONTHS } from "@/lib/analytics/computeDashboardStats";
import { recomputeAnalyticsNow } from "@/lib/analytics/scheduleRecompute";

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
	const [writeError, setWriteError] = useState<unknown>();
	const stats = useLiveQuery(async () => {
		if (!userId) return undefined;
		return getValidDashboardStats(userId);
	}, [userId]);
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
		if (!userId || stats !== undefined) return;

		let cancelled = false;
		void recomputeAnalyticsNow(userId)
			.then(() => {
				if (!cancelled) setWriteError(undefined);
			})
			.catch((error) => {
				console.error("Dashboard analytics recompute failed:", error);
				if (!cancelled) setWriteError(error);
			});

		return () => {
			cancelled = true;
		};
	}, [userId, stats]);

	if (writeError) throw writeError;
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
