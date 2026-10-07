import type { Category, CategoryType } from "@/types";

export type CategoryCurrencyScope = "currency" | "all";

export function normalizeCategoryTitle(title: string): string {
	return title.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function filterCategoriesForManagement(
	categories: Category[] | undefined,
	scope: CategoryCurrencyScope,
	activeCurrency: string | undefined
): Category[] | undefined {
	if (!categories) return categories;

	const currency = activeCurrency?.trim();
	return categories.filter((category) => {
		if (category.deletedAt) return false;
		if (scope !== "currency" || !currency) return true;
		return category.currency === currency;
	});
}

export function getCategoryTreeCategories(categories: Category[], type: CategoryType): Category[] {
	return categories.filter((category) => !category.deletedAt && category.type === type);
}
