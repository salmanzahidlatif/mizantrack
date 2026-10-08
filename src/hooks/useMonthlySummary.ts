import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef } from "react";

import { useAnalyticsMonthSummaries } from "@/hooks/useAnalyticsMonthSummaries";
import { getDashboardStatsReadState } from "@/lib/analytics/cache";
import { getMonthlySummaryFromDashboardStats } from "@/lib/analytics/computeDashboardStats";
import { scheduleAnalyticsRecompute } from "@/lib/analytics/scheduleRecompute";

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
	const requestedUserIdsRef = useRef(new Set<string>());
	const summaries = useAnalyticsMonthSummaries(
		userId,
		currency
			? {
					currency,
					months,
					anchorDate: query ? new Date(query.from) : new Date(),
					mode: "ending",
				}
			: undefined
	);
	const statsState = useLiveQuery(async () => {
		if (!userId || currency) return undefined;
		return getDashboardStatsReadState(userId);
	}, [userId, currency]);
	const stats = statsState?.value;

	useEffect(() => {
		requestedUserIdsRef.current.clear();
	}, [userId, currency]);

	useEffect(() => {
		if (!userId || currency || !statsState) return;
		if (statsState.value !== undefined) {
			requestedUserIdsRef.current.delete(userId);
			return;
		}
		if (requestedUserIdsRef.current.has(userId)) return;
		requestedUserIdsRef.current.add(userId);
		scheduleAnalyticsRecompute(userId);
	}, [userId, currency, statsState]);

	if (currency) {
		return summaries?.map((item) => ({
			month: item.month,
			income: item.income,
			expense: item.expense,
		}));
	}

	if (!stats) return undefined;
	return getMonthlySummaryFromDashboardStats(stats, months, currency);
}
