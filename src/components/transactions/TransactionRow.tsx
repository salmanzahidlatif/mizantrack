"use client";

import { ArrowLeftRight, TrendingDown, TrendingUp } from "lucide-react";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
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
	Expense: "text-red-500 bg-red-50 dark:bg-red-950",
	Income: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950",
	Transfer: "text-blue-500 bg-blue-50 dark:bg-blue-950",
} as const;

export function TransactionRow({ transaction, accounts, categories }: TransactionRowProps) {
	const openEditTransaction = useUIStore((s) => s.openEditTransaction);

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

	const accountLabel =
		transaction.type === "Transfer" && toAccount
			? `${account?.title ?? "?"} → ${toAccount.title}`
			: (account?.title ?? "—");

	return (
		<button
			type="button"
			onClick={() => openEditTransaction(transaction.id)}
			className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50 active:bg-accent">
			{/* Type icon */}
			<div
				className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${iconColor}`}>
				<TypeIcon className="h-4 w-4" />
			</div>

			{/* Description + meta */}
			<div className="min-w-0 flex-1">
				<p className="truncate text-sm font-medium">{label}</p>
				<div className="mt-0.5 flex items-center gap-1.5">
					<span className="truncate text-xs text-muted-foreground">{accountLabel}</span>
					{category && (
						<>
							<span className="text-xs text-muted-foreground">·</span>
							<span
								className="truncate text-xs text-muted-foreground"
								style={category.color ? { color: category.color } : undefined}>
								{category.icon} {category.title}
							</span>
						</>
					)}
				</div>
			</div>

			{/* Amount */}
			<div className="shrink-0 text-right">
				<CurrencyAmount
					amount={transaction.type === "Expense" ? -transaction.amount : transaction.amount}
					currency={account?.currency ?? ""}
					colorized
					variant={transaction.type === "Transfer" ? "transfer" : undefined}
				/>
			</div>
		</button>
	);
}
