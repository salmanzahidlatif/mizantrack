"use client";

import { ArrowLeftRight, ChevronRight, TrendingDown, TrendingUp } from "lucide-react";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { useHaptics } from "@/hooks/useHaptics";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { getCurrencyByCode } from "@/lib/currencies";
import { PRESS_SCALE, TAPPABLE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui-store";

import type { Account, Category, Transaction } from "@/types";

interface TransactionRowProps {
	transaction: Transaction;
	accounts: Account[];
	categories: Category[];
}

const TYPE_ICON = {
	Expense: TrendingDown,
	Income: TrendingUp,
	Transfer: ArrowLeftRight,
} as const;

const TYPE_COLOR = {
	Expense: "bg-red-50 text-red-600 ring-red-500/10 dark:bg-red-950/60 dark:text-red-400",
	Income:
		"bg-emerald-50 text-emerald-600 ring-emerald-500/10 dark:bg-emerald-950/60 dark:text-emerald-400",
	Transfer: "bg-blue-50 text-blue-600 ring-blue-500/10 dark:bg-blue-950/60 dark:text-blue-400",
} as const;

function formatAccountLabel(account: Account | undefined, showCurrency: boolean): string {
	const title = account?.title ?? "Unknown account";
	return showCurrency && account?.currency ? `${title} (${account.currency})` : title;
}

function getArchivedAccountDescription(account: Account | undefined): string | null {
	return account?.isArchived ? `${account.title} is archived` : null;
}

function getArchivedDescription(account: Account | undefined, toAccount: Account | undefined) {
	const descriptions = [
		getArchivedAccountDescription(account),
		getArchivedAccountDescription(toAccount),
	].filter((description): description is string => Boolean(description));

	if (descriptions.length === 0) return null;
	return descriptions.join("; ");
}

export function ArchivedAccountIndicator({ label = "Archived account" }: { label?: string }) {
	return (
		<span className="shrink-0 rounded-full border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[10px] leading-3 font-medium text-muted-foreground">
			<span aria-hidden="true">Archived</span>
			<span className="sr-only">{label}</span>
		</span>
	);
}

export function TransactionRow({ transaction, accounts, categories }: TransactionRowProps) {
	const openEditTransaction = useUIStore((s) => s.openEditTransaction);
	const haptics = useHaptics();

	const TypeIcon = TYPE_ICON[transaction.type];
	const iconColor = TYPE_COLOR[transaction.type];

	const account = accounts.find((a) => a.id === transaction.accountId);
	const toAccount = transaction.toAccountId
		? accounts.find((a) => a.id === transaction.toAccountId)
		: undefined;
	const category = categories.find((c) => c.id === transaction.categoryId);

	const label =
		transaction.description ??
		transaction.place ??
		category?.title ??
		(transaction.type === "Transfer" ? "Transfer" : "Untitled");

	const isCrossCurrencyTransfer =
		transaction.type === "Transfer" &&
		Boolean(account?.currency && toAccount?.currency && account.currency !== toAccount.currency);
	const accountLabel =
		transaction.type === "Transfer"
			? `${formatAccountLabel(account, isCrossCurrencyTransfer)} → ${formatAccountLabel(
					toAccount,
					isCrossCurrencyTransfer
				)}`
			: formatAccountLabel(account, false);
	const archivedDescription = getArchivedDescription(account, toAccount);
	const categoryCurrency = category?.currency ? getCurrencyByCode(category.currency) : undefined;
	const signedAmount = transaction.type === "Expense" ? -transaction.amount : transaction.amount;

	function handleOpen() {
		haptics.light();
		openEditTransaction(transaction.id);
	}

	return (
		<button
			type="button"
			onClick={handleOpen}
			className={cn(
				"flex min-h-[76px] w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-muted/35 active:bg-muted/55",
				PRESS_SCALE,
				TAPPABLE
			)}>
			<div
				className={cn(
					"flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1",
					iconColor
				)}>
				<TypeIcon className="h-[18px] w-[18px]" />
			</div>

			<div className="min-w-0 flex-1 space-y-1">
				<p className="truncate text-[15px] leading-5 font-semibold tracking-tight">{label}</p>
				<div className="flex min-w-0 items-center gap-1.5 text-xs leading-4 text-muted-foreground">
					<span className="truncate">{accountLabel}</span>
					{archivedDescription && <ArchivedAccountIndicator label={archivedDescription} />}
					{category && (
						<>
							<span className="shrink-0 text-muted-foreground/60">·</span>
							<span
								className="truncate"
								style={category.color ? { color: category.color } : undefined}>
								<span aria-hidden="true">{getCategoryIcon(category)}</span>{" "}
								<span>{category.title}</span>
							</span>
							{categoryCurrency && (
								<span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
									{categoryCurrency.flag} {categoryCurrency.code}
								</span>
							)}
						</>
					)}
				</div>
			</div>

			<div className="flex shrink-0 items-center gap-1 text-right">
				<CurrencyAmount
					amount={signedAmount}
					currency={account?.currency}
					colorized
					showNegativeSign
					variant={transaction.type === "Transfer" ? "transfer" : undefined}
					className="text-[15px] leading-5"
				/>
				<ChevronRight className="h-4 w-4 text-muted-foreground/45" aria-hidden="true" />
			</div>
		</button>
	);
}
