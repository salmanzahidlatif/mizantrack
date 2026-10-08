import { type Table } from "dexie";

import { db } from "@/lib/db/local";

import type { Account, Category, DashboardStats, Transaction } from "@/types";

export const ANALYTICS_CACHE_LOGIC_VERSION = 5;

export interface AnalyticsSourceData {
	accounts: Account[];
	categories: Category[];
	transactions: Transaction[];
}

interface VersionedRecord {
	userId: string;
	updatedAt: number;
	deletedAt?: number;
}

function versionRecords(records: VersionedRecord[]): string {
	let maxUpdatedAt = 0;
	let maxDeletedAt = 0;

	for (const record of records) {
		maxUpdatedAt = Math.max(maxUpdatedAt, record.updatedAt ?? 0);
		maxDeletedAt = Math.max(maxDeletedAt, record.deletedAt ?? 0);
	}

	return `${records.length}:${maxUpdatedAt}:${maxDeletedAt}`;
}

async function getTableDataVersion<T extends VersionedRecord>(
	table: Table<T>,
	userId: string
): Promise<string> {
	const [count, latestUpdated, latestDeleted] = await Promise.all([
		table.where("userId").equals(userId).count(),
		table
			.orderBy("updatedAt")
			.reverse()
			.filter((record) => record.userId === userId)
			.first(),
		table
			.orderBy("deletedAt")
			.reverse()
			.filter((record) => record.userId === userId && typeof record.deletedAt === "number")
			.first(),
	]);

	return `${count}:${latestUpdated?.updatedAt ?? 0}:${latestDeleted?.deletedAt ?? 0}`;
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
	const accounts = versionRecords(source.accounts);
	const categories = versionRecords(source.categories);
	const transactions = versionRecords(source.transactions);

	return `v${ANALYTICS_CACHE_LOGIC_VERSION}|a:${accounts}|c:${categories}|t:${transactions}`;
}

export async function getAnalyticsDataVersion(userId: string): Promise<string> {
	const [accounts, categories, transactions] = await Promise.all([
		getTableDataVersion(db.accounts, userId),
		getTableDataVersion(db.categories, userId),
		getTableDataVersion(db.transactions, userId),
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
