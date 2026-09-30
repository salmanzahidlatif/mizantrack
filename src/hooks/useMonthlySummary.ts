import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";

import { useAnalyticsMonthSummaries } from "@/hooks/useAnalyticsMonthSummaries";
import { getValidDashboardStats } from "@/lib/analytics/cache";
import { getMonthlySummaryFromDashboardStats } from "@/lib/analytics/computeDashboardStats";
import { recomputeAnalyticsNow } from "@/lib/analytics/scheduleRecompute";

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
	const [writeError, setWriteError] = useState<unknown>();
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
	const stats = useLiveQuery(async () => {
		if (!userId || currency) return undefined;
		return getValidDashboardStats(userId);
	}, [userId, currency]);

	useEffect(() => {
		if (!userId || currency || stats !== undefined) return;

		let cancelled = false;
		void recomputeAnalyticsNow(userId)
			.then(() => {
				if (!cancelled) setWriteError(undefined);
			})
			.catch((error) => {
				console.error("Monthly summary dashboard recompute failed:", error);
				if (!cancelled) setWriteError(error);
			});

		return () => {
			cancelled = true;
		};
	}, [userId, currency, stats]);

	if (writeError) throw writeError;
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
