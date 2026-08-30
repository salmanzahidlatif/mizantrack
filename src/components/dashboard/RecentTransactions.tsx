"use client";

import { format } from "date-fns";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { useFilterStore } from "@/store/filter-store";
import { useUIStore } from "@/store/ui-store";

import type { DashboardStats } from "@/types";

interface RecentTransactionsProps {
	stats?: DashboardStats;
}

export function RecentTransactions({ stats }: RecentTransactionsProps) {
	const { activeCurrency } = useFilterStore();
	const openEditTransaction = useUIStore((s) => s.openEditTransaction);
	const openAddTransaction = useUIStore((s) => s.openAddTransaction);

	if (stats === undefined) {
		return (
			<div className="space-y-2">
				{Array.from({ length: 4 }).map((_, i) => (
					<SkeletonCard key={i} className="h-12" />
				))}
			</div>
		);
	}

	const recent = stats.recent
		.filter((txn) => !activeCurrency || txn.accountCurrency === activeCurrency)
		.slice(0, 10);

	if (recent.length === 0) {
		return (
			<EmptyState
				title="No transactions yet"
				description="Tap the + button to record your first transaction."
				action={{ label: "Add Transaction", onClick: openAddTransaction }}
			/>
		);
	}

	return (
		<div className="rounded-xl border border-border bg-card">
			{recent.map((txn, idx) => {
				const label = txn.description ?? txn.place ?? txn.type;
				const isLast = idx === recent.length - 1;

				return (
					<button
						type="button"
						key={txn.id}
						onClick={() => openEditTransaction(txn.id)}
						className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50 ${
							!isLast ? "border-b border-border/50" : ""
						}`}>
						<div className="min-w-0">
							<p className="truncate text-sm font-medium">{label}</p>
							<p className="text-xs text-muted-foreground">
								{format(new Date(txn.date), "d MMM")} · {txn.accountTitle}
							</p>
						</div>
						<CurrencyAmount
							amount={txn.type === "Expense" ? -txn.amount : txn.amount}
							currency={txn.accountCurrency}
							colorized
							variant={txn.type === "Transfer" ? "transfer" : undefined}
						/>
					</button>
				);
			})}
		</div>
	);
}
