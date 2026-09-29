import { useLiveQuery } from "dexie-react-hooks";

import { getMonthlySummaryFromDashboardStats } from "@/lib/analytics/computeDashboardStats";
import { getMonthlySummaries } from "@/lib/analytics/periodAnalytics";
import { db } from "@/lib/db/local";

export interface MonthlySummaryItem {
	month: string; // "Jan 26"
	income: number;
	expense: number;
}

export interface MonthlySummaryQuery {
	month: string;
	from: number;
	to: number;
	currency?: string;
}

export function useMonthlySummary(
	userId: string,
	months = 6,
	currency?: string,
	query?: MonthlySummaryQuery
): MonthlySummaryItem[] | undefined {
	return useLiveQuery(async () => {
		if (currency) {
			const summaries = await getMonthlySummaries(userId, {
				currency,
				months,
				anchorDate: query ? new Date(query.from) : new Date(),
				mode: "ending",
			});
			return summaries.map((item) => ({
				month: item.month,
				income: item.income,
				expense: item.expense,
			}));
		}

		const stats = await db.dashboardStats.get(userId);
		if (!stats) return undefined;
		return getMonthlySummaryFromDashboardStats(stats, months, currency);
	}, [userId, months, currency, query?.from]);
}
