import { useLiveQuery } from "dexie-react-hooks";

import { getOrComputeDashboardStats } from "@/lib/analytics/cache";
import { DEFAULT_TREND_MONTHS } from "@/lib/analytics/computeDashboardStats";
import { getMonthlySummaries, getPeriodAnalytics } from "@/lib/analytics/periodAnalytics";

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
	analytics: Awaited<ReturnType<typeof getPeriodAnalytics>>
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
	return useLiveQuery(async () => {
		const stats = await getOrComputeDashboardStats(userId);
		if (!stats || !query?.currency) return stats;

		try {
			const [analytics, trend] = await Promise.all([
				getPeriodAnalytics(userId, {
					currency: query.currency,
					interval: "custom",
					customRange: { from: new Date(query.from), to: new Date(query.to) },
				}),
				getMonthlySummaries(userId, {
					currency: query.currency,
					months: DEFAULT_TREND_MONTHS,
					anchorDate: new Date(query.from),
					mode: "ending",
				}),
			]);
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
					...((existingBucket as DashboardBucketWithBreakdown | undefined)
						?.categoryBreakdownByMonth ?? {}),
					[query.month]: categoryBreakdown,
				},
				expenseCategoriesByMonth: {
					...((existingBucket as DashboardBucketWithBreakdown | undefined)
						?.expenseCategoriesByMonth ?? {}),
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
		} catch (error) {
			console.warn("Historical dashboard analytics query failed:", error);
			return stats;
		}
	}, [userId, query?.currency, query?.from, query?.to, query?.month]);
}
