"use client";

import Link from "next/link";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { useAccountBalance } from "@/hooks/useAccountBalance";
import { useAccounts } from "@/hooks/useAccounts";
import { useUIStore } from "@/store/ui-store";

interface BalanceCardProps {
	accountId: string;
	userId: string;
}

function BalanceCard({ accountId, userId }: BalanceCardProps) {
	const accounts = useAccounts(userId);
	const balance = useAccountBalance(accountId, userId);
	const account = accounts?.find((a) => a.id === accountId);

	if (!account) return null;

	return (
		<div
			className="flex min-w-[160px] flex-col gap-1 rounded-xl border border-border bg-card p-4"
			style={account.color ? { borderLeftColor: account.color, borderLeftWidth: 3 } : undefined}>
			<div className="flex items-center gap-1.5">
				{account.icon && <span className="text-base leading-none">{account.icon}</span>}
				<p className="truncate text-sm font-medium">{account.title}</p>
			</div>
			<p className="text-xs text-muted-foreground">{account.currency}</p>
			{balance === undefined ? (
				<div className="h-6 w-24 animate-pulse rounded bg-muted" />
			) : (
				<CurrencyAmount amount={balance} currency={account.currency} colorized />
			)}
		</div>
	);
}

interface BalanceCardsProps {
	userId: string;
}

export function BalanceCards({ userId }: BalanceCardsProps) {
	const accounts = useAccounts(userId);
	const openAddAccount = useUIStore((s) => s.openAddAccount);

	if (accounts === undefined) {
		return (
			<div className="flex gap-3 overflow-x-auto pb-1">
				{Array.from({ length: 3 }).map((_, i) => (
					<SkeletonCard key={i} className="min-w-[160px]" />
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
				<Link key={a.id} href="/accounts" className="flex-shrink-0">
					<BalanceCard accountId={a.id} userId={userId} />
				</Link>
			))}
		</div>
	);
}
