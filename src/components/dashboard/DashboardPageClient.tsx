"use client";

import { BalanceCards } from "@/components/dashboard/BalanceCards";
import { MonthSummary } from "@/components/dashboard/MonthSummary";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { TrendChart } from "@/components/charts/TrendBarChart";
import { TransactionDrawer } from "@/components/transactions/TransactionDrawer";
import { useDbConfig } from "@/hooks/useDbConfig";

interface DashboardPageClientProps {
	userId: string;
}

export function DashboardPageClient({ userId }: DashboardPageClientProps) {
	const config = useDbConfig(userId);
	const currency = config?.currency ?? "AED";

	return (
		<div className="space-y-5">
			<div>
				<h1 className="text-2xl font-bold">Dashboard</h1>
				<p className="text-sm text-muted-foreground">Your financial overview</p>
			</div>

			{/* Account balance cards — horizontal scroll */}
			<section className="space-y-2">
				<h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
					Accounts
				</h2>
				<BalanceCards userId={userId} />
			</section>

			{/* Month summary */}
			<section className="space-y-2">
				<h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
					This Month
				</h2>
				<MonthSummary userId={userId} currency={currency} />
			</section>

			{/* 6-month trend */}
			<section>
				<TrendChart userId={userId} months={6} />
			</section>

			{/* Recent transactions */}
			<section className="space-y-2">
				<h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
					Recent Transactions
				</h2>
				<RecentTransactions userId={userId} />
			</section>

			{/* Drawer — required so FAB can open it from this page */}
			<TransactionDrawer userId={userId} />
		</div>
	);
}
