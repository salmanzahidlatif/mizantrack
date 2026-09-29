import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/local";

import type { Category, CategoryType } from "@/types";

export function useCategories(
	userId: string,
	type?: CategoryType,
	currency?: string
): Category[] | undefined {
	const currencyFilter = currency?.trim();

	return useLiveQuery(
		() =>
			db.categories
				.where("userId")
				.equals(userId)
				.filter(
					(c) =>
						!c.deletedAt &&
						(type === undefined || c.type === type) &&
						(!currencyFilter || c.currency === currencyFilter || !c.currency)
				)
				.toArray(),
		[userId, type, currency]
	);
}
