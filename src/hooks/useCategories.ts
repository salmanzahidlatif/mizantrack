import { useLiveQuery } from "dexie-react-hooks";

import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { db } from "@/lib/db/local";

import type { Category, CategoryType } from "@/types";

function categoryMatchesPicker(
	category: Category,
	type?: CategoryType,
	currency?: string
): boolean {
	const currencyFilter = normalizeCurrencyCode(currency);
	const categoryCurrency = normalizeCurrencyCode(category.currency);

	return (
		!category.deletedAt &&
		(type === undefined || category.type === type) &&
		(!currencyFilter || categoryCurrency === currencyFilter || !categoryCurrency)
	);
}

export function filterCategoriesForPicker(
	categories: Category[],
	type?: CategoryType,
	currency?: string
): Category[] {
	return categories.filter((category) => categoryMatchesPicker(category, type, currency));
}

export function useCategories(
	userId: string,
	type?: CategoryType,
	currency?: string
): Category[] | undefined {
	return useLiveQuery(
		() =>
			db.categories
				.where("userId")
				.equals(userId)
				.filter((category) => categoryMatchesPicker(category, type, currency))
				.toArray(),
		[userId, type, currency]
	);
}
