"use client";

import { useEffect } from "react";

import { TransactionFilters } from "@/components/transactions/TransactionFilters";
import { TransactionList } from "@/components/transactions/TransactionList";
import { useActiveAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { useTransactions } from "@/hooks/useTransactions";
import { getDateRange } from "@/lib/dateRange";
import { useFilterStore } from "@/store/filter-store";

interface TransactionsPageClientProps {
	userId: string;
}

export function TransactionsPageClient({ userId }: TransactionsPageClientProps) {
	const accounts = useActiveAccounts(userId);

	const {
		period,
		accountId,
		transactionType,
		searchQuery,
		customRange,
		activeCurrency,
		setAccountId,
	} = useFilterStore();

	const currency = activeCurrency || undefined;
	const accountList = accounts ?? [];
	const currencyAccounts = currency
		? accountList.filter((account) => account.currency === currency)
		: accountList;
	const accountIdInCurrency =
		!accountId || !currency || currencyAccounts.some((account) => account.id === accountId);
	const effectiveAccountId = accountIdInCurrency ? (accountId ?? undefined) : undefined;
	const categories = useCategories(userId, undefined, currency);

	const { from, to } = getDateRange(period, 7, customRange ?? undefined);

	useEffect(() => {
		if (!accounts || !currency || !accountId || accountIdInCurrency) return;
		setAccountId(null);
	}, [accountId, accountIdInCurrency, accounts, currency, setAccountId]);

	const transactions = useTransactions(userId, {
		accountId: effectiveAccountId,
		type: transactionType,
		from: from.getTime(),
		to: to.getTime(),
		search: searchQuery || undefined,
		currency,
	});

	return (
		<div className="space-y-3">
			{/* Header */}
			<div>
				<h1 className="hidden text-2xl font-bold md:block">Transactions</h1>
				{transactions !== undefined && (
					<p className="text-sm text-muted-foreground">{transactions.length} transactions</p>
				)}
			</div>

			<TransactionFilters accounts={currencyAccounts} />

			<TransactionList
				transactions={transactions}
				accounts={accountList}
				categories={categories ?? []}
			/>
		</div>
	);
}
