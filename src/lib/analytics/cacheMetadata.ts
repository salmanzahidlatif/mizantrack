import { db } from "@/lib/db/local";

import type { Account, Category, DashboardStats, Transaction } from "@/types";

export const ANALYTICS_CACHE_LOGIC_VERSION = 3;

export interface AnalyticsSourceData {
	accounts: Account[];
	categories: Category[];
	transactions: Transaction[];
}

const HASH_OFFSET = 0x811c9dc5;
const HASH_PRIME = 0x01000193;

function updateHash(hash: number, value: string): number {
	let nextHash = hash;
	for (let index = 0; index < value.length; index++) {
		nextHash ^= value.charCodeAt(index);
		nextHash = Math.imul(nextHash, HASH_PRIME);
	}
	return nextHash >>> 0;
}

function hashParts(parts: Array<string | number | boolean | undefined>): string {
	let hash = HASH_OFFSET;
	for (const part of parts) {
		hash = updateHash(hash, `${part ?? ""}\u001f`);
	}
	return hash.toString(16).padStart(8, "0");
}

function hashRecords<T extends { id: string; updatedAt: number; deletedAt?: number }>(
	records: T[],
	toParts: (record: T) => Array<string | number | boolean | undefined>
) {
	const sorted = [...records].sort((a, b) => a.id.localeCompare(b.id));
	let hash = HASH_OFFSET;
	let maxUpdatedAt = 0;
	let maxDeletedAt = 0;

	for (const record of sorted) {
		maxUpdatedAt = Math.max(maxUpdatedAt, record.updatedAt ?? 0);
		maxDeletedAt = Math.max(maxDeletedAt, record.deletedAt ?? 0);
		hash = updateHash(hash, `${hashParts(toParts(record))}\u001e`);
	}

	return `${records.length}:${maxUpdatedAt}:${maxDeletedAt}:${hash.toString(16).padStart(8, "0")}`;
}

export async function getAnalyticsSourceData(userId: string): Promise<AnalyticsSourceData> {
	const [accounts, categories, transactions] = await Promise.all([
		db.accounts.where("userId").equals(userId).toArray(),
		db.categories.where("userId").equals(userId).toArray(),
		db.transactions.where("userId").equals(userId).toArray(),
	]);

	return { accounts, categories, transactions };
}

export function buildAnalyticsDataVersion(source: AnalyticsSourceData): string {
	const accounts = hashRecords(source.accounts, (account) => [
		account.id,
		account.userId,
		account.title,
		account.openingBalance,
		account.currency,
		account.color,
		account.icon,
		account.isArchived,
		account.accountType,
		account.updatedAt,
		account.deletedAt,
	]);
	const categories = hashRecords(source.categories, (category) => [
		category.id,
		category.userId,
		category.title,
		category.type,
		category.currency,
		category.icon,
		category.color,
		category.parentId,
		category.updatedAt,
		category.deletedAt,
	]);
	const transactions = hashRecords(source.transactions, (transaction) => [
		transaction.id,
		transaction.userId,
		transaction.type,
		transaction.date,
		transaction.amount,
		transaction.description,
		transaction.place,
		transaction.accountId,
		transaction.categoryId,
		transaction.toAccountId,
		transaction.travelCurrency?.symbol,
		transaction.travelCurrency?.rate,
		transaction.travelCurrency?.amount,
		transaction.travelCurrency?.location,
		transaction.updatedAt,
		transaction.deletedAt,
	]);

	return `v${ANALYTICS_CACHE_LOGIC_VERSION}|a:${accounts}|c:${categories}|t:${transactions}`;
}

export function markDashboardStatsCacheValid(
	stats: DashboardStats,
	dataVersion: string,
	now = Date.now()
): DashboardStats {
	return {
		...stats,
		logicVersion: ANALYTICS_CACHE_LOGIC_VERSION,
		dataVersion,
		cacheStatus: "valid",
		cacheUpdatedAt: now,
	};
}

export function isDashboardStatsCacheValid(
	stats: DashboardStats | undefined,
	dataVersion: string
): stats is DashboardStats {
	return (
		stats?.logicVersion === ANALYTICS_CACHE_LOGIC_VERSION &&
		stats.dataVersion === dataVersion &&
		stats.cacheStatus === "valid"
	);
}
