import { useMemo } from "react";

import { useLiveQuery } from "dexie-react-hooks";
import { format, startOfMonth, subMonths } from "date-fns";

import { db } from "@/lib/db/local";

export interface MonthlySummaryItem {
	month: string; // "Jan 26"
	income: number;
	expense: number;
}

export function useMonthlySummary(userId: string, months = 6): MonthlySummaryItem[] | undefined {
	const now = new Date();
	const from = startOfMonth(subMonths(now, months - 1)).getTime();
	const to = Date.now();

	const transactions = useLiveQuery(
		() =>
			db.transactions
				.where("userId")
				.equals(userId)
				.filter((t) => !t.deletedAt && t.date >= from && t.date <= to)
				.toArray(),
		[userId, from, to]
	);

	return useMemo(() => {
		if (transactions === undefined) return undefined;

		// Build a map of month labels in order
		const buckets = new Map<string, MonthlySummaryItem>();
		for (let i = months - 1; i >= 0; i--) {
			const label = format(subMonths(now, i), "MMM yy");
			buckets.set(label, { month: label, income: 0, expense: 0 });
		}

		for (const t of transactions) {
			const label = format(new Date(t.date), "MMM yy");
			const bucket = buckets.get(label);
			if (!bucket) continue;
			if (t.type === "Income") bucket.income += t.amount;
			else if (t.type === "Expense") bucket.expense += t.amount;
		}

		return Array.from(buckets.values());
	}, [transactions, months]); // eslint-disable-line react-hooks/exhaustive-deps
}
