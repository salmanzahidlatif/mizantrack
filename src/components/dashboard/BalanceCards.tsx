"use client";

import Link from "next/link";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonBalance } from "@/components/shared/SkeletonBalance";
import { useAccounts } from "@/hooks/useAccounts";
import { useDbConfig } from "@/hooks/useDbConfig";
import { useHaptics } from "@/hooks/useHaptics";
import { resolveCurrencyCode } from "@/lib/analytics/balanceMath";
import { getCurrencyByCode } from "@/lib/currencies";
import { CARD_SURFACE, LIST_ROW, PRESS_SCALE, TAPPABLE, staggerDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useFilterStore } from "@/store/filter-store";
import { useUIStore } from "@/store/ui-store";

import type { Account, DashboardStats } from "@/types";

interface BalanceCardProps {
	account: Account;
	balance: number;
}

function BalanceCard({ account, balance }: BalanceCardProps) {
	const currency = getCurrencyByCode(account.currency);
	const icon = account.icon ?? "💼";

	return (
		<div
			className={cn(
				CARD_SURFACE,
				"relative flex min-w-48 flex-col gap-3 overflow-hidden p-4 transition-shadow duration-200 hover:shadow-[var(--shadow-sheet)]",
				PRESS_SCALE,
				TAPPABLE
			)}
			style={account.color ? { borderLeftColor: account.color, borderLeftWidth: 3 } : undefined}>
			<div
				className="pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full opacity-15 blur-2xl"
				style={{ backgroundColor: account.color ?? "var(--primary)" }}
			/>
			<div className="flex items-center gap-2">
				<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-muted text-base leading-none shadow-sm">
					{icon}
				</span>
				<div className="min-w-0">
					<p className="truncate text-sm font-semibold tracking-tight">{account.title}</p>
					<p className="truncate text-[11px] text-muted-foreground">Available balance</p>
				</div>
			</div>
			<div className="flex items-end justify-between gap-3">
				<CurrencyAmount
					amount={balance}
					currency={account.currency}
					colorized
					showNegativeSign
					className="text-xl leading-7"
				/>
				<span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/70 bg-background/70 px-2 py-1 text-[10px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
					{currency?.flag && <span className="text-xs tracking-normal">{currency.flag}</span>}
					{account.currency}
				</span>
			</div>
		</div>
	);
}

interface BalanceCardsProps {
	userId: string;
	stats?: DashboardStats;
}

export function BalanceCards({ userId, stats }: BalanceCardsProps) {
	const { activeCurrency } = useFilterStore();
	const haptics = useHaptics();
	const config = useDbConfig(userId);
	const currency = resolveCurrencyCode(activeCurrency, config?.currency);
	// Filter accounts by the active currency context from the header selector
	const accounts = useAccounts(userId, { currency });
	const openAddAccount = useUIStore((s) => s.openAddAccount);

	function handleAddAccount() {
		haptics.light();
		openAddAccount();
	}

	if (accounts === undefined || stats?.id !== userId) {
		return (
			<div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
				<SkeletonBalance count={3} />
			</div>
		);
	}

	const activeAccounts = accounts.filter((a) => !a.isArchived);

	if (activeAccounts.length === 0) {
		return (
			<EmptyState
				title="No accounts yet"
				description="Create your first account to start tracking."
				action={{ label: "Add Account", onClick: handleAddAccount }}
			/>
		);
	}

	return (
		<div className="no-scrollbar flex gap-3 overflow-x-auto pb-1">
			{activeAccounts.map((a, index) => (
				<Link
					key={a.id}
					href="/accounts"
					onClick={() => haptics.selection()}
					className={cn("shrink-0", LIST_ROW)}
					style={staggerDelay(index, 35)}>
					<BalanceCard account={a} balance={stats.balances[a.id] ?? a.openingBalance} />
				</Link>
			))}
		</div>
	);
}
