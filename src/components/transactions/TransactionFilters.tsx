"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useCategories } from "@/hooks/useCategories";
import { useDbConfig } from "@/hooks/useDbConfig";
import { normalizeCurrencyCode, resolveCurrencyCode } from "@/lib/analytics/balanceMath";
import { getCategoryIcon } from "@/lib/categoryIcons";
import {
	EMPTY_TRANSACTION_USAGE_RANKING,
	loadRecentTransactionUsageRanking,
	sortRecordsByUsage,
	type UsageCounts,
} from "@/lib/usageRanking";
import { UNCATEGORIZED_CATEGORY_FILTER, useFilterStore } from "@/store/filter-store";

import type { CategoryFilterValue } from "@/store/filter-store";
import type { Account, Category, CategoryType, FilterPeriod, TransactionType } from "@/types";

const PERIOD_OPTIONS: { value: FilterPeriod; label: string }[] = [
	{ value: "all", label: "All Time" },
	{ value: "today", label: "Today" },
	{ value: "week", label: "This Week" },
	{ value: "month", label: "This Month" },
	{ value: "custom", label: "Selected Month" },
	{ value: "quarter", label: "This Quarter" },
	{ value: "half-year", label: "Half Year" },
	{ value: "year", label: "This Year" },
	{ value: "fiscal-year", label: "Fiscal Year" },
];

const TYPE_OPTIONS: { value: TransactionType | "All"; label: string }[] = [
	{ value: "All", label: "All Types" },
	{ value: "Expense", label: "Expense" },
	{ value: "Income", label: "Income" },
	{ value: "Transfer", label: "Transfer" },
];

interface TransactionFiltersProps {
	accounts: Account[];
	userId?: string;
}

const CATEGORY_SELECT_ALL = "filter:all";
const CATEGORY_SELECT_UNCATEGORIZED = "filter:uncategorized";
const CATEGORY_SELECT_PREFIX = "category:";

export function getTransactionFilterAccountOptions(
	accounts: Account[],
	usageCounts?: UsageCounts
): Account[] {
	return usageCounts ? sortRecordsByUsage(accounts, usageCounts) : accounts;
}

export function getTransactionFilterCategoryOptions(
	categories: Category[],
	type: TransactionType | "All",
	usageCounts?: UsageCounts
): Category[] {
	if (type === "Transfer") return [];

	const categoryType: CategoryType | undefined =
		type === "Expense" || type === "Income" ? type : undefined;
	const visibleCategories = categoryType
		? categories.filter((category) => category.type === categoryType)
		: categories;

	return usageCounts ? sortRecordsByUsage(visibleCategories, usageCounts) : visibleCategories;
}

function toCategorySelectValue(categoryId: CategoryFilterValue | null): string {
	if (!categoryId) return CATEGORY_SELECT_ALL;
	if (categoryId === UNCATEGORIZED_CATEGORY_FILTER) return CATEGORY_SELECT_UNCATEGORIZED;
	return `${CATEGORY_SELECT_PREFIX}${categoryId}`;
}

function fromCategorySelectValue(value: string): CategoryFilterValue | null {
	if (value === CATEGORY_SELECT_ALL) return null;
	if (value === CATEGORY_SELECT_UNCATEGORIZED) return UNCATEGORIZED_CATEGORY_FILTER;
	if (value.startsWith(CATEGORY_SELECT_PREFIX)) {
		return value.slice(CATEGORY_SELECT_PREFIX.length);
	}
	return null;
}

export function TransactionFilters({ accounts, userId: explicitUserId }: TransactionFiltersProps) {
	const {
		period,
		accountId,
		categoryId,
		transactionType,
		searchQuery,
		activeCurrency,
		setPeriod,
		setAccountId,
		setCategoryId,
		setTransactionType,
		setSearchQuery,
		reset,
	} = useFilterStore();

	const [draftSearch, setDraftSearch] = useState(searchQuery);
	const userId = explicitUserId ?? accounts.find((account) => account.userId)?.userId;
	const config = useDbConfig(userId ?? "");
	const currency = resolveCurrencyCode(activeCurrency, config?.currency);
	const categories = useCategories(userId ?? "", undefined, currency);
	const usageRanking = useLiveQuery(
		() =>
			userId
				? loadRecentTransactionUsageRanking(userId)
				: Promise.resolve(EMPTY_TRANSACTION_USAGE_RANKING),
		[userId],
		EMPTY_TRANSACTION_USAGE_RANKING
	);
	const visibleAccounts = useMemo(
		() =>
			accounts.filter((account) => normalizeCurrencyCode(account.currency) === currency),
		[accounts, currency]
	);
	const accountOptions = useMemo(
		() => getTransactionFilterAccountOptions(visibleAccounts, usageRanking.accountUsage),
		[visibleAccounts, usageRanking.accountUsage]
	);
	const selectedAccountId =
		accountId && accountOptions.some((account) => account.id === accountId) ? accountId : "all";
	const categoryOptions = useMemo(
		() =>
			getTransactionFilterCategoryOptions(
				categories ?? [],
				transactionType,
				usageRanking.categoryUsage
			),
		[categories, transactionType, usageRanking.categoryUsage]
	);
	const selectedCategoryValue = toCategorySelectValue(categoryId);
	const isFiltered =
		period !== "month" ||
		accountId !== null ||
		categoryId !== null ||
		transactionType !== "All" ||
		searchQuery !== "" ||
		draftSearch !== "";

	useEffect(() => {
		setDraftSearch(searchQuery);
	}, [searchQuery]);

	useEffect(() => {
		if (typeof categoryId !== "string" || !categories) return;
		if (categoryOptions.some((category) => category.id === categoryId)) return;
		setCategoryId(null);
	}, [categories, categoryId, categoryOptions, setCategoryId]);

	useEffect(() => {
		const handle = window.setTimeout(() => {
			if (draftSearch !== searchQuery) {
				setSearchQuery(draftSearch);
			}
		}, 250);

		return () => window.clearTimeout(handle);
	}, [draftSearch, searchQuery, setSearchQuery]);

	function handleReset() {
		setDraftSearch("");
		reset();
	}

	function handleClearSearch() {
		setDraftSearch("");
		setSearchQuery("");
	}

	return (
		<div className="space-y-2">
			<div className="flex flex-wrap gap-2">
				{/* Period */}
				<Select value={period} onValueChange={(v) => setPeriod(v as FilterPeriod)}>
					<SelectTrigger className="h-8 w-auto min-w-[130px] text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{PERIOD_OPTIONS.map((opt) => (
							<SelectItem key={opt.value} value={opt.value} className="text-xs">
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				{/* Account */}
				<Select
					value={selectedAccountId}
					onValueChange={(v) => setAccountId(v === "all" ? null : v)}>
					<SelectTrigger className="h-8 w-auto min-w-[130px] text-xs">
						<SelectValue placeholder="All Accounts" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all" className="text-xs">
							All Accounts
						</SelectItem>
						{accountOptions.map((a) => (
							<SelectItem key={a.id} value={a.id} className="text-xs">
								{a.title}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				{/* Type */}
				<Select
					value={transactionType}
					onValueChange={(v) => setTransactionType(v as TransactionType | "All")}>
					<SelectTrigger className="h-8 w-auto min-w-[120px] text-xs">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{TYPE_OPTIONS.map((opt) => (
							<SelectItem key={opt.value} value={opt.value} className="text-xs">
								{opt.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				{/* Category */}
				<Select
					value={selectedCategoryValue}
					onValueChange={(value) => setCategoryId(fromCategorySelectValue(value))}>
					<SelectTrigger className="h-8 w-auto min-w-[150px] text-xs">
						<SelectValue placeholder="All Categories" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={CATEGORY_SELECT_ALL} className="text-xs">
							All Categories
						</SelectItem>
						<SelectItem value={CATEGORY_SELECT_UNCATEGORIZED} className="text-xs">
							Uncategorized
						</SelectItem>
						{categoryOptions.map((category) => (
							<SelectItem
								key={category.id}
								value={toCategorySelectValue(category.id)}
								className="text-xs">
								<span aria-hidden="true">{getCategoryIcon(category)}</span>
								<span>{category.title}</span>
							</SelectItem>
						))}
					</SelectContent>
				</Select>

				{isFiltered && (
					<Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={handleReset}>
						<X className="mr-1 h-3 w-3" />
						Reset
					</Button>
				)}
			</div>

			{/* Search */}
			<div className="relative">
				<Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
				<Input
					className="h-8 pl-8 text-xs"
					placeholder="Search description or place…"
					value={draftSearch}
					onChange={(e) => setDraftSearch(e.target.value)}
				/>
				{draftSearch && (
					<button
						type="button"
						aria-label="Clear transaction search"
						onClick={handleClearSearch}
						className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground">
						<X className="h-3.5 w-3.5" />
					</button>
				)}
			</div>
		</div>
	);
}
