"use client";

import { CheckCheck, ListChecks, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { BulkEditTransactionsDrawer } from "@/components/transactions/BulkEditTransactionsDrawer";
import { TransactionFilters } from "@/components/transactions/TransactionFilters";
import { TransactionList } from "@/components/transactions/TransactionList";
import { TransactionMonthStrip } from "@/components/transactions/TransactionMonthStrip";
import { Button } from "@/components/ui/button";
import { useAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { useDbConfig } from "@/hooks/useDbConfig";
import { useRequiredUserId } from "@/hooks/useRequiredUserId";
import { useTransactions } from "@/hooks/useTransactions";
import { normalizeCurrencyCode, resolveCurrencyCode } from "@/lib/analytics/balanceMath";
import { getDateRange, getLocalTimeZoneOffsetMinutes, getMonthRange } from "@/lib/dateRange";
import { useFilterStore } from "@/store/filter-store";

interface TransactionsPageClientProps {
	userId?: string;
}

export function TransactionsPageClient({
	userId: providedUserId,
}: TransactionsPageClientProps = {}) {
	const userId = useRequiredUserId(providedUserId);
	const accounts = useAccounts(userId, { showArchived: true });
	const config = useDbConfig(userId);

	const {
		period,
		accountId,
		categoryId,
		transactionType,
		searchQuery,
		customRange,
		activeCurrency,
		setPeriod,
		setAccountId,
		setCustomRange,
	} = useFilterStore();

	const currency = resolveCurrencyCode(activeCurrency, config?.currency);
	const now = new Date();
	const timeZoneOffsetMinutes = getLocalTimeZoneOffsetMinutes(now);
	const accountList = accounts ?? [];
	const currencyAccounts = accountList.filter(
		(account) => normalizeCurrencyCode(account.currency) === currency
	);
	const accountIdInCurrency =
		!accountId || currencyAccounts.some((account) => account.id === accountId);
	const effectiveAccountId = accountIdInCurrency ? (accountId ?? undefined) : undefined;
	const categories = useCategories(userId, undefined, currency);

	const { from, to } = getDateRange(period, 7, customRange ?? undefined);
	const currentMonth = getMonthRange(now, { timeZoneOffsetMinutes });
	const selectedMonth =
		period === "custom" && customRange
			? getMonthRange(customRange.from, { timeZoneOffsetMinutes })
			: currentMonth;

	useEffect(() => {
		if (!accounts || !accountId || accountIdInCurrency) return;
		setAccountId(null);
	}, [accountId, accountIdInCurrency, accounts, currency, setAccountId]);

	const transactions = useTransactions(userId, {
		accountId: effectiveAccountId,
		categoryId,
		type: transactionType,
		from: from.getTime(),
		to: to.getTime(),
		search: searchQuery || undefined,
		currency,
	});

	const [selectionMode, setSelectionMode] = useState(false);
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [bulkDrawerOpen, setBulkDrawerOpen] = useState(false);

	// Only live accounts in the screen's currency can be a bulk reassignment target:
	// moving rows into an archived account, or one in another currency, would change
	// what the amounts mean.
	const bulkEditAccounts = useMemo(
		() => currencyAccounts.filter((account) => !account.isArchived),
		[currencyAccounts]
	);

	const visibleIds = useMemo(
		() => new Set((transactions ?? []).map((txn) => txn.id)),
		[transactions]
	);
	// Selections only ever mean something against what is on screen. When a filter
	// changes underneath, anything no longer listed is dropped so a hidden transaction
	// can never be edited or deleted by a bulk action the owner thought was scoped.
	useEffect(() => {
		if (!selectionMode || transactions === undefined) return;
		setSelectedIds((previous) => {
			const next = new Set([...previous].filter((id) => visibleIds.has(id)));
			return next.size === previous.size ? previous : next;
		});
	}, [selectionMode, transactions, visibleIds]);

	const selectedTransactions = useMemo(
		() => (transactions ?? []).filter((txn) => selectedIds.has(txn.id)),
		[transactions, selectedIds]
	);

	const toggleSelect = useCallback((id: string) => {
		setSelectedIds((previous) => {
			const next = new Set(previous);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}, []);

	function exitSelectionMode() {
		setSelectionMode(false);
		setSelectedIds(new Set());
	}

	const visibleCount = transactions?.length ?? 0;
	const allSelected = visibleCount > 0 && selectedIds.size === visibleCount;

	return (
		<div className="space-y-3">
			{/* Header */}
			<div className="flex items-start justify-between gap-3">
				<div>
					<h1 className="hidden text-2xl font-bold md:block">Transactions</h1>
					{transactions !== undefined && (
						<p className="text-sm text-muted-foreground">{visibleCount} transactions</p>
					)}
				</div>
				{selectionMode ? (
					<Button
						variant="ghost"
						size="sm"
						className="h-8 px-2 text-xs"
						onClick={exitSelectionMode}>
						<X className="mr-1 h-3.5 w-3.5" />
						Done
					</Button>
				) : (
					<Button
						variant="outline"
						size="sm"
						className="h-8 px-2 text-xs"
						disabled={visibleCount === 0}
						onClick={() => setSelectionMode(true)}>
						<ListChecks className="mr-1 h-3.5 w-3.5" />
						Select
					</Button>
				)}
			</div>

			{selectionMode && (
				<div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2">
					<p className="text-xs font-medium" aria-live="polite">
						{selectedIds.size} selected
					</p>
					<Button
						variant="ghost"
						size="sm"
						className="h-7 px-2 text-xs"
						onClick={() => setSelectedIds(allSelected ? new Set() : new Set(visibleIds))}>
						<CheckCheck className="mr-1 h-3.5 w-3.5" />
						{allSelected ? "Clear all" : `Select all ${visibleCount}`}
					</Button>
					<Button
						size="sm"
						className="ml-auto h-7 px-3 text-xs"
						disabled={selectedIds.size === 0}
						onClick={() => setBulkDrawerOpen(true)}>
						Edit selected
					</Button>
				</div>
			)}

			<TransactionMonthStrip
				selectedMonth={selectedMonth}
				timeZoneOffsetMinutes={timeZoneOffsetMinutes}
				now={now}
				onSelectMonth={(month) => {
					if (month.key === currentMonth.key) {
						setPeriod("month");
						setCustomRange(null);
						return;
					}
					setCustomRange({ from: month.from, to: month.to });
					setPeriod("custom");
				}}
			/>

			<TransactionFilters accounts={accountList} userId={userId} />

			<TransactionList
				transactions={transactions}
				accounts={accountList}
				categories={categories ?? []}
				screenCurrency={currency}
				selectionMode={selectionMode}
				selectedIds={selectedIds}
				onToggleSelect={toggleSelect}
			/>

			<BulkEditTransactionsDrawer
				open={bulkDrawerOpen}
				onOpenChange={setBulkDrawerOpen}
				userId={userId}
				transactions={selectedTransactions}
				accounts={bulkEditAccounts}
				categories={categories ?? []}
				onDone={exitSelectionMode}
			/>
		</div>
	);
}
