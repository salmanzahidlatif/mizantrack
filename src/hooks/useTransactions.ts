import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/local";

import type { Transaction, TransactionType } from "@/types";

export interface TransactionFilters {
	accountId?: string;
	categoryId?: string;
	type?: TransactionType | "All";
	from?: number; // Unix ms
	to?: number; // Unix ms
	search?: string;
}

export function useTransactions(
	userId: string,
	filters: TransactionFilters = {}
): Transaction[] | undefined {
	const { accountId, categoryId, type, from, to, search } = filters;

	return useLiveQuery(
		() =>
			db.transactions
				.where("userId")
				.equals(userId)
				.filter((t) => {
					if (t.deletedAt) return false;
					if (accountId && t.accountId !== accountId && t.toAccountId !== accountId) return false;
					if (categoryId && t.categoryId !== categoryId) return false;
					if (type && type !== "All" && t.type !== type) return false;
					if (from && t.date < from) return false;
					if (to && t.date > to) return false;
					if (search) {
						const q = search.toLowerCase();
						const matchDesc = t.description?.toLowerCase().includes(q) ?? false;
						const matchPlace = t.place?.toLowerCase().includes(q) ?? false;
						if (!matchDesc && !matchPlace) return false;
					}
					return true;
				})
				.sortBy("date")
				.then((txns) => txns.reverse()),
		[userId, accountId, categoryId, type, from, to, search]
	);
}
