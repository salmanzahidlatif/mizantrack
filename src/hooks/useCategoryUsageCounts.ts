"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";

import {
	buildCategoryChildCounts,
	buildCategoryTransactionCounts,
} from "@/components/categories/duplicateCategoryMerge";
import { db } from "@/lib/db/local";

import type { Category } from "@/types";

export interface CategoryUsageCounts {
	transactionCounts: Map<string, number> | undefined;
	childCounts: Map<string, number> | undefined;
}

function getCategoryIdsKey(categories: Category[] | undefined): string {
	if (!categories) return "";
	return categories
		.filter((category) => !category.deletedAt)
		.map((category) => category.id)
		.sort()
		.join("\u0000");
}

export function useCategoryUsageCounts(
	userId: string,
	categories: Category[] | undefined
): CategoryUsageCounts {
	const categoryIdsKey = useMemo(() => getCategoryIdsKey(categories), [categories]);
	const categoryIds = useMemo(
		() => (categoryIdsKey ? categoryIdsKey.split("\u0000") : []),
		[categoryIdsKey]
	);
	const transactions = useLiveQuery(async () => {
		if (!categories) return undefined;
		if (categoryIds.length === 0) return [];

		return db.transactions
			.where("categoryId")
			.anyOf(categoryIds)
			.filter((transaction) => transaction.userId === userId)
			.toArray();
	}, [userId, categoryIdsKey]);
	const transactionCounts = useMemo(
		() => (transactions ? buildCategoryTransactionCounts(transactions) : undefined),
		[transactions]
	);
	const childCounts = useMemo(
		() => (categories ? buildCategoryChildCounts(categories) : undefined),
		[categories]
	);

	return { transactionCounts, childCounts };
}
