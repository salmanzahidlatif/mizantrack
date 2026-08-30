"use client";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { useFilterStore } from "@/store/filter-store";

import type { DashboardStats } from "@/types";

interface MonthSummaryProps {
	currency?: string;
	stats?: DashboardStats;
}

export function MonthSummary({ currency = "PKR", stats }: MonthSummaryProps) {
	const { activeCurrency } = useFilterStore();
	// Use the live currency selector if set, otherwise fall back to prop
	const displayCurrency = activeCurrency || currency;
	const bucket = stats?.perCurrency[activeCurrency || ""] ?? {
		monthIncome: 0,
		monthExpense: 0,
		trend: [],
	};
	const income = bucket.monthIncome;
	const expense = bucket.monthExpense;
	const net = income - expense;

	const items = [
		{ label: "Income", amount: income, variant: "positive" as const },
		{ label: "Expenses", amount: -expense, variant: "negative" as const },
		{
			label: "Net",
			amount: net,
			variant: (net >= 0 ? "positive" : "negative") as "positive" | "negative",
		},
	];

	return (
		<div className="grid grid-cols-3 gap-3">
			{items.map(({ label, amount, variant }) => (
				<div key={label} className="rounded-xl border border-border/60 bg-card p-3 text-center shadow-[var(--shadow-card)]">
					<p className="mb-1 text-xs text-muted-foreground">{label}</p>
					{stats === undefined ? (
						<div className="mx-auto h-5 w-16 animate-pulse rounded bg-muted" />
					) : (
						<CurrencyAmount amount={amount} currency={displayCurrency} variant={variant} />
					)}
				</div>
			))}
		</div>
	);
}
