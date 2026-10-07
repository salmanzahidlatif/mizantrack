"use client";

import { useEffect } from "react";

import { TransactionFilters } from "@/components/transactions/TransactionFilters";
import { TransactionList } from "@/components/transactions/TransactionList";
import { TransactionMonthStrip } from "@/components/transactions/TransactionMonthStrip";
import { useActiveAccounts } from "@/hooks/useAccounts";
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
	const accounts = useActiveAccounts(userId);
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

	return (
		<div className="space-y-3">
			{/* Header */}
			<div>
				<h1 className="hidden text-2xl font-bold md:block">Transactions</h1>
				{transactions !== undefined && (
					<p className="text-sm text-muted-foreground">{transactions.length} transactions</p>
				)}
			</div>

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

			<TransactionFilters accounts={currencyAccounts} userId={userId} />

			<TransactionList
				transactions={transactions}
				accounts={accountList}
				categories={categories ?? []}
			/>
		</div>
	);
}
