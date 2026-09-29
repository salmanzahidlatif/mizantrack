import { useLiveQuery } from "dexie-react-hooks";

import { getMonthlySummaryFromDashboardStats } from "@/lib/analytics/computeDashboardStats";
import { db } from "@/lib/db/local";

export interface MonthlySummaryItem {
	month: string; // "Jan 26"
	income: number;
	expense: number;
}

export function useMonthlySummary(
	userId: string,
	months = 6,
	currency?: string
): MonthlySummaryItem[] | undefined {
	return useLiveQuery(async () => {
		const stats = await db.dashboardStats.get(userId);
		if (!stats) return undefined;
		return getMonthlySummaryFromDashboardStats(stats, months, currency);
	}, [userId, months, currency]);
}
