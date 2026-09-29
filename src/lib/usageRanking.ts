import { db } from "@/lib/db/local";

import type { Transaction } from "@/types";

export type UsageCounts = Readonly<Record<string, number>>;

export interface TransactionUsageRanking {
	accountUsage: UsageCounts;
	categoryUsage: UsageCounts;
}

export const RECENT_USAGE_WINDOW_MS = 183 * 24 * 60 * 60 * 1000;
export const EMPTY_USAGE_COUNTS: UsageCounts = {};
export const EMPTY_TRANSACTION_USAGE_RANKING: TransactionUsageRanking = {
	accountUsage: EMPTY_USAGE_COUNTS,
	categoryUsage: EMPTY_USAGE_COUNTS,
};

interface RankedRecord {
	id: string;
	title: string;
}

function increment(counts: Record<string, number>, id: string | undefined): void {
	if (!id) return;
	counts[id] = (counts[id] ?? 0) + 1;
}

function getUsageCount(usageCounts: UsageCounts | undefined, id: string): number {
	return usageCounts?.[id] ?? 0;
}

function compareTitle(a: RankedRecord, b: RankedRecord): number {
	const aTitle = a.title.trim().toLocaleLowerCase();
	const bTitle = b.title.trim().toLocaleLowerCase();

	if (aTitle < bTitle) return -1;
	if (aTitle > bTitle) return 1;
	if (a.title < b.title) return -1;
	if (a.title > b.title) return 1;
	if (a.id < b.id) return -1;
	if (a.id > b.id) return 1;
	return 0;
}

export function sortRecordsByUsage<T extends RankedRecord>(
	records: T[],
	usageCounts: UsageCounts | undefined
): T[] {
	return [...records].sort((a, b) => {
		const usageDiff = getUsageCount(usageCounts, b.id) - getUsageCount(usageCounts, a.id);
		if (usageDiff !== 0) return usageDiff;
		return compareTitle(a, b);
	});
}

export function buildTransactionUsageRanking(
	transactions: Pick<Transaction, "accountId" | "toAccountId" | "categoryId">[]
): TransactionUsageRanking {
	const accountUsage: Record<string, number> = {};
	const categoryUsage: Record<string, number> = {};

	for (const transaction of transactions) {
		increment(accountUsage, transaction.accountId);
		increment(accountUsage, transaction.toAccountId);
		increment(categoryUsage, transaction.categoryId);
	}

	return { accountUsage, categoryUsage };
}

export async function loadRecentTransactionUsageRanking(
	userId: string,
	now = Date.now(),
	windowMs = RECENT_USAGE_WINDOW_MS
): Promise<TransactionUsageRanking> {
	const cutoff = now - windowMs;
	const transactions = await db.transactions
		.where("date")
		.aboveOrEqual(cutoff)
		.filter((transaction) => transaction.userId === userId && !transaction.deletedAt)
		.toArray();

	return buildTransactionUsageRanking(transactions);
}
