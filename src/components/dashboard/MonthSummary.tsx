"use client";

import { endOfMonth, startOfMonth } from "date-fns";
import { useMemo } from "react";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { useTransactions } from "@/hooks/useTransactions";

interface MonthSummaryProps {
	userId: string;
	currency?: string;
}

export function MonthSummary({ userId, currency = "PKR" }: MonthSummaryProps) {
	const now = new Date();
	const from = startOfMonth(now).getTime();
	const to = endOfMonth(now).getTime();

	const transactions = useTransactions(userId, { from, to });

	const { income, expense, net } = useMemo(() => {
		if (!transactions) return { income: 0, expense: 0, net: 0 };
		let inc = 0;
		let exp = 0;
		for (const t of transactions) {
			if (t.type === "Income") inc += t.amount;
			else if (t.type === "Expense") exp += t.amount;
		}
		return { income: inc, expense: exp, net: inc - exp };
	}, [transactions]);

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
				<div key={label} className="rounded-xl border border-border bg-card p-3 text-center">
					<p className="mb-1 text-xs text-muted-foreground">{label}</p>
					{transactions === undefined ? (
						<div className="mx-auto h-5 w-16 animate-pulse rounded bg-muted" />
					) : (
						<CurrencyAmount amount={amount} currency={currency} variant={variant} />
					)}
				</div>
			))}
		</div>
	);
}
