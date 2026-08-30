"use client";

import Link from "next/link";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { useAccounts } from "@/hooks/useAccounts";
import { useFilterStore } from "@/store/filter-store";
import { useUIStore } from "@/store/ui-store";

import type { Account, DashboardStats } from "@/types";

interface BalanceCardProps {
	account: Account;
	balance: number;
}

function BalanceCard({ account, balance }: BalanceCardProps) {
	return (
		<div
			className="flex min-w-44 flex-col gap-1.5 rounded-2xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)] transition-shadow hover:shadow-[var(--shadow-overlay)] active:scale-[0.98] active:shadow-[var(--shadow-card)] touch-manipulation"
			style={account.color ? { borderLeftColor: account.color, borderLeftWidth: 3 } : undefined}>
			<div className="flex items-center gap-1.5">
				{account.icon && <span className="text-base leading-none">{account.icon}</span>}
				<p className="truncate text-sm font-semibold">{account.title}</p>
			</div>
			<p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">{account.currency}</p>
			<CurrencyAmount amount={balance} currency={account.currency} colorized showNegativeSign className="text-xl font-bold" />
		</div>
	);
}

interface BalanceCardsProps {
	userId: string;
	stats?: DashboardStats;
}

export function BalanceCards({ userId, stats }: BalanceCardsProps) {
	const { activeCurrency } = useFilterStore();
	// Filter accounts by the active currency context from the header selector
	const accounts = useAccounts(userId, { currency: activeCurrency ? activeCurrency : undefined });
	const openAddAccount = useUIStore((s) => s.openAddAccount);

	if (accounts === undefined || stats?.id !== userId) {
		return (
			<div className="flex gap-3 overflow-x-auto pb-1">
				{Array.from({ length: 3 }).map((_, i) => (
					<SkeletonCard key={i} className="min-w-40" />
				))}
			</div>
		);
	}

	const activeAccounts = accounts.filter((a) => !a.isArchived);

	if (activeAccounts.length === 0) {
		return (
			<EmptyState
				title="No accounts yet"
				description="Create your first account to start tracking."
				action={{ label: "Add Account", onClick: openAddAccount }}
			/>
		);
	}

	return (
		<div className="flex gap-3 overflow-x-auto pb-1">
			{activeAccounts.map((a) => (
				<Link key={a.id} href="/accounts" className="shrink-0">
					<BalanceCard account={a} balance={stats.balances[a.id] ?? a.openingBalance} />
				</Link>
			))}
		</div>
	);
}
