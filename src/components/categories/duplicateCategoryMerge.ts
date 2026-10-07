import { recomputeAnalyticsNow } from "@/lib/analytics/scheduleRecompute";
import { db } from "@/lib/db/local";

import { normalizeCategoryTitle } from "./categoryManagement";

import type { Category, CategoryType, Transaction } from "@/types";

export interface DuplicateCategoryCandidate {
	category: Category;
	transactionCount: number;
	childCount: number;
}

export interface DuplicateCategoryGroup {
	key: string;
	normalizedTitle: string;
	type: CategoryType;
	currency: string;
	candidates: DuplicateCategoryCandidate[];
	totalTransactionCount: number;
}

export interface MergeDuplicateCategoriesResult {
	survivorId: string;
	loserIds: string[];
	movedTransactions: number;
	reparentedChildren: number;
	softDeletedCategories: number;
	activeTransactionsBefore: number;
	activeSurvivorTransactionsAfter: number;
}

function normalizeCurrency(value: string | undefined): string | undefined {
	const currency = value?.trim();
	return currency === "" ? undefined : currency;
}

function getDuplicateKey(category: Category): string | undefined {
	const currency = normalizeCurrency(category.currency);
	if (!currency) return undefined;
	return [category.type, currency, normalizeCategoryTitle(category.title)].join("\u0000");
}

function countTransactions(transactions: Transaction[], categoryId: string): number {
	return transactions.filter((transaction) => transaction.categoryId === categoryId).length;
}

function countChildren(categories: Category[], categoryId: string): number {
	return categories.filter((category) => !category.deletedAt && category.parentId === categoryId)
		.length;
}

export function findDuplicateCategoryGroups(
	categories: Category[],
	transactions: Transaction[]
): DuplicateCategoryGroup[] {
	const activeCategories = categories.filter((category) => !category.deletedAt);
	const groups = new Map<string, Category[]>();

	for (const category of activeCategories) {
		const key = getDuplicateKey(category);
		if (!key) continue;
		const group = groups.get(key) ?? [];
		group.push(category);
		groups.set(key, group);
	}

	return Array.from(groups.entries())
		.filter(([, group]) => group.length > 1)
		.map(([key, group]) => {
			const first = group[0]!;
			const currency = normalizeCurrency(first.currency)!;
			const candidates = group
				.map((category) => ({
					category,
					transactionCount: countTransactions(transactions, category.id),
					childCount: countChildren(activeCategories, category.id),
				}))
				.sort((a, b) => a.category.title.localeCompare(b.category.title));

			return {
				key,
				normalizedTitle: normalizeCategoryTitle(first.title),
				type: first.type,
				currency,
				candidates,
				totalTransactionCount: candidates.reduce(
					(total, candidate) => total + candidate.transactionCount,
					0
				),
			};
		})
		.sort((a, b) => {
			const typeOrder = a.type.localeCompare(b.type);
			if (typeOrder !== 0) return typeOrder;
			const currencyOrder = a.currency.localeCompare(b.currency);
			if (currencyOrder !== 0) return currencyOrder;
			return a.normalizedTitle.localeCompare(b.normalizedTitle);
		});
}

export async function loadDuplicateCategoryGroups(
	userId: string
): Promise<DuplicateCategoryGroup[]> {
	const [categories, transactions] = await Promise.all([
		db.categories.where("userId").equals(userId).toArray(),
		db.transactions.where("userId").equals(userId).toArray(),
	]);

	return findDuplicateCategoryGroups(categories, transactions);
}

function assertSameDuplicateIdentity(categories: Category[]) {
	const first = categories[0];
	if (!first) throw new Error("Choose at least two categories to merge.");

	const firstCurrency = normalizeCurrency(first.currency);
	const firstTitle = normalizeCategoryTitle(first.title);
	if (!firstCurrency) {
		throw new Error("Shared categories are not merged by this tool.");
	}

	for (const category of categories) {
		if (category.deletedAt) {
			throw new Error("Deleted categories cannot be merged.");
		}
		if (
			category.type !== first.type ||
			normalizeCurrency(category.currency) !== firstCurrency ||
			normalizeCategoryTitle(category.title) !== firstTitle
		) {
			throw new Error(
				"Only duplicate categories with the same title, type, and currency can merge."
			);
		}
	}
}

export async function mergeDuplicateCategories(
	userId: string,
	survivorId: string,
	loserIds: string[]
): Promise<MergeDuplicateCategoriesResult> {
	const uniqueLoserIds = Array.from(new Set(loserIds)).filter((id) => id !== survivorId);
	if (uniqueLoserIds.length === 0) {
		throw new Error("Choose at least one duplicate category to merge.");
	}

	const now = Date.now();
	const candidateIds = [survivorId, ...uniqueLoserIds];
	let result: MergeDuplicateCategoriesResult | undefined;

	await db.transaction("rw", db.categories, db.transactions, async () => {
		const candidates = await db.categories.where("id").anyOf(candidateIds).toArray();
		const byId = new Map(candidates.map((category) => [category.id, category]));
		const survivor = byId.get(survivorId);
		const losers = uniqueLoserIds.map((id) => byId.get(id));

		if (survivor?.userId !== userId) {
			throw new Error("Surviving category was not found.");
		}
		if (losers.some((category) => category?.userId !== userId)) {
			throw new Error("One or more duplicate categories were not found.");
		}

		const mergeCategories = [survivor, ...(losers as Category[])];
		assertSameDuplicateIdentity(mergeCategories);

		const transactionsInGroup = await db.transactions
			.where("userId")
			.equals(userId)
			.filter((transaction) => candidateIds.includes(transaction.categoryId ?? ""))
			.toArray();
		const activeTransactionsBefore = transactionsInGroup.filter(
			(transaction) => !transaction.deletedAt
		).length;
		const transactionsToMove = transactionsInGroup.filter((transaction) =>
			uniqueLoserIds.includes(transaction.categoryId ?? "")
		);
		const childrenToReparent = (
			await db.categories
				.where("userId")
				.equals(userId)
				.filter(
					(category) =>
						!candidateIds.includes(category.id) && uniqueLoserIds.includes(category.parentId ?? "")
				)
				.toArray()
		).filter((category) => category.parentId !== survivorId);

		for (const transaction of transactionsToMove) {
			await db.transactions.update(transaction.id, {
				categoryId: survivorId,
				updatedAt: now,
			});
		}

		for (const child of childrenToReparent) {
			await db.categories.update(child.id, {
				parentId: survivorId,
				updatedAt: now,
			});
		}

		for (const loser of losers as Category[]) {
			await db.categories.update(loser.id, {
				deletedAt: now,
				updatedAt: now,
			});
		}

		const activeSurvivorTransactionsAfter = await db.transactions
			.where("userId")
			.equals(userId)
			.filter((transaction) => !transaction.deletedAt && transaction.categoryId === survivorId)
			.count();

		if (activeSurvivorTransactionsAfter !== activeTransactionsBefore) {
			throw new Error("Merge aborted because transaction counts would not be preserved.");
		}

		result = {
			survivorId,
			loserIds: uniqueLoserIds,
			movedTransactions: transactionsToMove.length,
			reparentedChildren: childrenToReparent.length,
			softDeletedCategories: uniqueLoserIds.length,
			activeTransactionsBefore,
			activeSurvivorTransactionsAfter,
		};
	});

	await recomputeAnalyticsNow(userId);
	return result!;
}
