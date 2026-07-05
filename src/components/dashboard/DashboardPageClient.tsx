"use client";

import { TrendChart } from "@/components/charts/TrendBarChart";
import { BalanceCards } from "@/components/dashboard/BalanceCards";
import { MonthSummary } from "@/components/dashboard/MonthSummary";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { useDbConfig } from "@/hooks/useDbConfig";
import { useFilterStore } from "@/store/filter-store";

interface DashboardPageClientProps {
	userId: string;
}

export function DashboardPageClient({ userId }: DashboardPageClientProps) {
	const config = useDbConfig(userId);
	// activeCurrency from selector; fall back to saved config currency
	const { activeCurrency } = useFilterStore();
	const currency = activeCurrency || config?.currency || "PKR";

	return (
		<div className="space-y-6">
			<div>
				<h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
				<p className="text-sm text-muted-foreground">Your financial overview</p>
			</div>

			{/* Account balance cards — horizontal scroll */}
			<section className="space-y-2">
				<h2 className="text-xs font-semibold tracking-widest text-muted-foreground/70 uppercase">
					Accounts
				</h2>
				<BalanceCards userId={userId} />
			</section>

			{/* Month summary */}
			<section className="space-y-2">
				<h2 className="text-xs font-semibold tracking-widest text-muted-foreground/70 uppercase">
					This Month
				</h2>
				<MonthSummary userId={userId} currency={currency} />
			</section>

			{/* 6-month trend */}
			<section className="space-y-2">
				<h2 className="text-xs font-semibold tracking-widest text-muted-foreground/70 uppercase">
					Trend
				</h2>
				<TrendChart userId={userId} months={6} />
			</section>

			{/* Recent transactions */}
			<section className="space-y-2">
				<h2 className="text-xs font-semibold tracking-widest text-muted-foreground/70 uppercase">
					Recent
				</h2>
				<RecentTransactions userId={userId} />
			</section>
		</div>
	);
}
