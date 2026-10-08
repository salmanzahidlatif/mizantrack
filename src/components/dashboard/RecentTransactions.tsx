"use client";

import { format, isWithinInterval } from "date-fns";
import { ArrowLeftRight, ChevronRight, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo } from "react";

import { getDashboardMonthRange } from "@/components/dashboard/monthData";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonTransactionRow } from "@/components/shared/SkeletonTransactionRow";
import { ArchivedAccountIndicator } from "@/components/transactions/TransactionRow";
import { useAccounts } from "@/hooks/useAccounts";
import { useHaptics } from "@/hooks/useHaptics";
import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { CARD_SURFACE, LIST_ROW, PRESS_SCALE, TAPPABLE, staggerDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useFilterStore } from "@/store/filter-store";
import { useUIStore } from "@/store/ui-store";

import type { Account, DashboardStats } from "@/types";

interface RecentTransactionsProps {
	stats?: DashboardStats;
	selectedMonth?: Date;
}

const TYPE_ICON = {
	Expense: TrendingDown,
	Income: TrendingUp,
	Transfer: ArrowLeftRight,
} as const;

const TYPE_COLOR = {
	Expense: "bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-400",
	Income: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400",
	Transfer: "bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400",
} as const;

function formatAccountLabel(
	account: Account | undefined,
	fallbackTitle: string,
	showCurrency: boolean
) {
	const title = account?.title ?? fallbackTitle;
	return showCurrency && account?.currency ? `${title} (${account.currency})` : title;
}

function getArchivedDescription(account: Account | undefined, toAccount: Account | undefined) {
	const descriptions = [account, toAccount]
		.filter((item): item is Account => Boolean(item?.isArchived))
		.map((item) => `${item.title} is archived`);

	if (descriptions.length === 0) return null;
	return descriptions.join("; ");
}

export function RecentTransactions({ stats, selectedMonth }: RecentTransactionsProps) {
	const { activeCurrency } = useFilterStore();
	const openEditTransaction = useUIStore((s) => s.openEditTransaction);
	const openAddTransaction = useUIStore((s) => s.openAddTransaction);
	const haptics = useHaptics();
	const accounts = useAccounts(stats?.id ?? "", { showArchived: true });
	const accountById = useMemo(
		() => new Map((accounts ?? []).map((account) => [account.id, account])),
		[accounts]
	);
	const selectedMonthRange = selectedMonth ? getDashboardMonthRange(selectedMonth) : undefined;
	const selectedCurrency = normalizeCurrencyCode(activeCurrency);

	function handleOpenTransaction(transactionId: string) {
		haptics.light();
		openEditTransaction(transactionId);
	}

	if (stats === undefined) {
		return (
			<div className={cn(CARD_SURFACE, "overflow-hidden")}>
				<SkeletonTransactionRow count={4} />
			</div>
		);
	}

	const recent = stats.recent
		.filter((txn) => {
			const account = accountById.get(txn.accountId);
			const currency = account?.currency ?? txn.accountCurrency;
			return !selectedCurrency || normalizeCurrencyCode(currency) === selectedCurrency;
		})
		.filter((txn) => {
			if (!selectedMonthRange) return true;

			return isWithinInterval(new Date(txn.date), {
				start: new Date(selectedMonthRange.from),
				end: new Date(selectedMonthRange.to),
			});
		})
		.slice(0, 10);

	if (recent.length === 0) {
		return (
			<EmptyState
				title={
					selectedMonthRange ? `No activity in ${selectedMonthRange.label}` : "No transactions yet"
				}
				description={
					selectedMonthRange
						? "Transactions for this month will appear here."
						: "Tap the + button to record your first transaction."
				}
				action={{ label: "Add Transaction", onClick: openAddTransaction }}
			/>
		);
	}

	return (
		<div className={cn(CARD_SURFACE, "overflow-hidden")}>
			{recent.map((txn, idx) => {
				const label = txn.description ?? txn.place ?? txn.type;
				const TypeIcon = TYPE_ICON[txn.type];
				const account = accountById.get(txn.accountId);
				const toAccount = txn.toAccountId ? accountById.get(txn.toAccountId) : undefined;
				const accountCurrency = account?.currency ?? txn.accountCurrency;
				const isCrossCurrencyTransfer =
					txn.type === "Transfer" &&
					Boolean(
						account?.currency && toAccount?.currency && account.currency !== toAccount.currency
					);
				const accountLabel =
					txn.type === "Transfer" && txn.toAccountId
						? `${formatAccountLabel(account, txn.accountTitle, isCrossCurrencyTransfer)} → ${formatAccountLabel(
								toAccount,
								"Unknown account",
								isCrossCurrencyTransfer
							)}`
						: formatAccountLabel(account, txn.accountTitle, false);
				const archivedDescription = getArchivedDescription(account, toAccount);

				return (
					<button
						type="button"
						key={txn.id}
						onClick={() => handleOpenTransaction(txn.id)}
						className={cn(
							"relative flex min-h-[72px] w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-muted/35 active:bg-muted/55",
							PRESS_SCALE,
							TAPPABLE,
							LIST_ROW
						)}
						style={staggerDelay(idx, 35)}>
						<div
							className={cn(
								"flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
								TYPE_COLOR[txn.type]
							)}>
							<TypeIcon className="h-4 w-4" />
						</div>
						<div className="min-w-0 flex-1">
							<p className="truncate text-[15px] leading-5 font-semibold tracking-tight">{label}</p>
							<div className="flex min-w-0 items-center gap-1.5 text-xs leading-5 text-muted-foreground">
								<span className="shrink-0">{format(new Date(txn.date), "d MMM")} ·</span>
								<span className="truncate">{accountLabel}</span>
								{archivedDescription && <ArchivedAccountIndicator label={archivedDescription} />}
							</div>
						</div>
						<div className="flex shrink-0 items-center gap-1">
							<CurrencyAmount
								amount={txn.type === "Expense" ? -txn.amount : txn.amount}
								currency={accountCurrency}
								colorized
								showNegativeSign
								variant={txn.type === "Transfer" ? "transfer" : undefined}
								className="text-[15px] leading-5"
							/>
							<ChevronRight className="h-4 w-4 text-muted-foreground/45" />
						</div>
						{idx < recent.length - 1 && (
							<div className="pointer-events-none absolute right-4 bottom-0 left-[68px] border-b border-border/55" />
						)}
					</button>
				);
			})}
		</div>
	);
}
