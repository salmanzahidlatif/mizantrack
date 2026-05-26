"use client";

import { TransactionDrawer } from "@/components/transactions/TransactionDrawer";
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
	const allAccounts = useActiveAccounts(userId);
	const categories = useCategories(userId);

	const { period, accountId, transactionType, searchQuery, customRange } = useFilterStore();

	const { from, to } = getDateRange(period, 7, customRange ?? undefined);

	const transactions = useTransactions(userId, {
		accountId: accountId ?? undefined,
		type: transactionType,
		from: from.getTime(),
		to: to.getTime(),
		search: searchQuery || undefined,
	});

	return (
		<div className="space-y-3">
			{/* Header */}
			<div>
				<h1 className="text-2xl font-bold">Transactions</h1>
				{transactions !== undefined && (
					<p className="text-sm text-muted-foreground">{transactions.length} transactions</p>
				)}
			</div>

			<TransactionFilters accounts={allAccounts ?? []} />

			<TransactionList
				transactions={transactions}
				accounts={accounts ?? []}
				categories={categories ?? []}
			/>

			<TransactionDrawer userId={userId} />
		</div>
	);
}
