"use client";

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { getDashboardMonthRange, getMonthlyTotals } from "@/components/dashboard/monthData";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { CARD_SURFACE, LIST_ROW, staggerDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useFilterStore } from "@/store/filter-store";

import type { DashboardStats } from "@/types";

interface MonthSummaryProps {
	currency?: string;
	stats?: DashboardStats;
	selectedMonth?: Date;
}

export function MonthSummary({
	currency = "PKR",
	stats,
	selectedMonth = new Date(),
}: MonthSummaryProps) {
	const { activeCurrency } = useFilterStore();
	// Use the live currency selector if set, otherwise fall back to prop
	const displayCurrency = normalizeCurrencyCode(activeCurrency) || normalizeCurrencyCode(currency);
	const selectedMonthRange = getDashboardMonthRange(selectedMonth);
	const totals = getMonthlyTotals(stats, displayCurrency, selectedMonth);
	const income = totals?.income ?? 0;
	const expense = totals?.expense ?? 0;
	const net = income - expense;

	const items = [
		{ label: "Income", amount: income, variant: "positive" as const, icon: ArrowUpRight },
		{ label: "Expenses", amount: -expense, variant: "negative" as const, icon: ArrowDownRight },
		{
			label: "Net",
			amount: net,
			variant: (net >= 0 ? "positive" : "negative") as "positive" | "negative",
			icon: Minus,
		},
	];

	return (
		<div className="grid grid-cols-3 gap-3" aria-label="Dashboard month summary">
			{items.map(({ label, amount, variant, icon: Icon }, index) => (
				<div
					key={label}
					aria-label={`${label} for ${selectedMonthRange.label}`}
					className={cn(CARD_SURFACE, LIST_ROW, "min-h-28 overflow-hidden p-3")}
					style={staggerDelay(index, 45)}>
					<div className="mb-3 flex items-center justify-between gap-2">
						<p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
						<span
							className={cn(
								"flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
								variant === "positive"
									? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
									: "bg-red-500/10 text-red-600 dark:text-red-400"
							)}>
							<Icon className="h-3.5 w-3.5" />
						</span>
					</div>
					{stats === undefined ? (
						<div className="shimmer h-6 w-full rounded-full bg-muted/70" />
					) : (
						<CurrencyAmount
							amount={amount}
							currency={displayCurrency}
							variant={variant}
							className="block truncate text-sm leading-6 sm:text-base"
						/>
					)}
				</div>
			))}
		</div>
	);
}
