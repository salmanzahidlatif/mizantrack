import { useLiveQuery } from "dexie-react-hooks";

import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { db } from "@/lib/db/local";
import { UNCATEGORIZED_CATEGORY_FILTER, type CategoryFilterValue } from "@/store/filter-store";

import type { Transaction, TransactionType } from "@/types";
import type { Collection } from "dexie";

export interface TransactionFilters {
	accountId?: string;
	categoryId?: CategoryFilterValue | null;
	type?: TransactionType | "All";
	from?: number; // Unix ms
	to?: number; // Unix ms
	search?: string;
	/** When provided, restricts to transactions on accounts with this currency code. */
	currency?: string;
}

export interface TransactionQueryStats {
	plan: "user-date" | "user-all" | "category" | "type";
	indexedCandidateCount: number;
	matchedCount: number;
}

export interface TransactionQueryResult {
	transactions: Transaction[];
	stats: TransactionQueryStats;
}

const MAX_INDEXED_DB_DATE = 8640000000000000;

function isMeaningfulDateBoundary(
	value: number | undefined,
	boundary: "from" | "to"
): value is number {
	if (typeof value !== "number" || !Number.isFinite(value)) return false;
	if (boundary === "from") return value > 0;
	return value < MAX_INDEXED_DB_DATE;
}

function normalizeSearch(search: string | undefined): string {
	return search?.trim().toLowerCase() ?? "";
}

function matchesCategoryFilter(
	transaction: Transaction,
	categoryId: CategoryFilterValue | null | undefined
): boolean {
	if (!categoryId) return true;
	if (categoryId === UNCATEGORIZED_CATEGORY_FILTER) return !transaction.categoryId;
	return transaction.categoryId === categoryId;
}

function compareTransactionsByNewestDate(a: Transaction, b: Transaction): number {
	return b.date - a.date;
}

function transactionMatchesFilters(
	transaction: Transaction,
	filters: TransactionFilters,
	currencyAccountIds: Set<string> | null,
	normalizedSearch: string
): boolean {
	const { accountId, categoryId, type, from, to } = filters;

	if (transaction.deletedAt) return false;
	if (accountId && transaction.accountId !== accountId && transaction.toAccountId !== accountId) {
		return false;
	}
	if (!matchesCategoryFilter(transaction, categoryId)) return false;
	if (type && type !== "All" && transaction.type !== type) return false;
	if (isMeaningfulDateBoundary(from, "from") && transaction.date < from) return false;
	if (isMeaningfulDateBoundary(to, "to") && transaction.date > to) return false;
	if (normalizedSearch) {
		const matchDesc = transaction.description?.toLowerCase().includes(normalizedSearch) ?? false;
		const matchPlace = transaction.place?.toLowerCase().includes(normalizedSearch) ?? false;
		if (!matchDesc && !matchPlace) return false;
	}
	if (currencyAccountIds) {
		if (!currencyAccountIds.has(transaction.accountId)) return false;
	}
	return true;
}

function chooseBaseQuery(
	userId: string,
	filters: TransactionFilters
): {
	collection: Collection<Transaction, string>;
	plan: TransactionQueryStats["plan"];
	sorted: boolean;
} {
	const { categoryId, type, from, to } = filters;
	const hasDateRange = isMeaningfulDateBoundary(from, "from") || isMeaningfulDateBoundary(to, "to");

	if (hasDateRange) {
		const lower = isMeaningfulDateBoundary(from, "from") ? from : 0;
		const upper = isMeaningfulDateBoundary(to, "to") ? to : MAX_INDEXED_DB_DATE;

		return {
			collection: db.transactions.where("[userId+date]").between([userId, lower], [userId, upper]),
			plan: "user-date",
			sorted: true,
		};
	}

	if (categoryId && categoryId !== UNCATEGORIZED_CATEGORY_FILTER) {
		return {
			collection: db.transactions.where("categoryId").equals(categoryId),
			plan: "category",
			sorted: false,
		};
	}

	if (type && type !== "All") {
		return {
			collection: db.transactions.where("type").equals(type),
			plan: "type",
			sorted: false,
		};
	}

	return {
		collection: db.transactions.where("userId").equals(userId),
		plan: "user-all",
		sorted: false,
	};
}

export async function queryTransactionsWithStats(
	userId: string,
	filters: TransactionFilters = {}
): Promise<TransactionQueryResult> {
	const { search } = filters;
	const currency = normalizeCurrencyCode(filters.currency);

	let currencyAccountIds: Set<string> | null = null;
	if (currency) {
		const accounts = await db.accounts
			.where("userId")
			.equals(userId)
			.filter(
				(account) => !account.deletedAt && normalizeCurrencyCode(account.currency) === currency
			)
			.primaryKeys();
		currencyAccountIds = new Set(accounts as string[]);
	}

	const normalizedSearch = normalizeSearch(search);
	const { collection, plan, sorted } = chooseBaseQuery(userId, filters);
	const candidates = await collection.toArray();
	const transactions = candidates.filter((transaction) =>
		transaction.userId === userId
			? transactionMatchesFilters(transaction, filters, currencyAccountIds, normalizedSearch)
			: false
	);

	if (sorted) {
		transactions.reverse();
	} else {
		transactions.sort(compareTransactionsByNewestDate);
	}

	return {
		transactions,
		stats: {
			plan,
			indexedCandidateCount: candidates.length,
			matchedCount: transactions.length,
		},
	};
}

export async function queryTransactions(
	userId: string,
	filters: TransactionFilters = {}
): Promise<Transaction[]> {
	const result = await queryTransactionsWithStats(userId, filters);
	return result.transactions;
}

export function useTransactions(
	userId: string,
	filters: TransactionFilters = {}
): Transaction[] | undefined {
	const { accountId, categoryId, type, from, to, search, currency } = filters;

	return useLiveQuery(
		() => queryTransactions(userId, filters),
		[userId, accountId, categoryId, type, from, to, search, currency]
	);
}
