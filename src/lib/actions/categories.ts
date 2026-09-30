import { v4 as uuidv4 } from "uuid";

import { recomputeAnalyticsNow } from "@/lib/analytics/scheduleRecompute";
import { db } from "@/lib/db/local";
import { categorySchema, type CategoryFormValues } from "@/lib/validations/category";

import type { Category } from "@/types";

function parseCategory(values: unknown): CategoryFormValues {
	const result = categorySchema.safeParse(values);
	if (!result.success) {
		throw new Error(result.error.issues[0]?.message ?? "Please check the category details.");
	}
	return result.data;
}

function normalizeCurrency(value: string | undefined) {
	const currency = value?.trim();
	return currency === "" ? undefined : currency;
}

export async function createCategory(
	userId: string,
	values: CategoryFormValues,
	options?: { id?: string }
): Promise<string> {
	const parsed = parseCategory(values);
	const currency = normalizeCurrency(parsed.currency);
	const category: Category = {
		id: options?.id ?? uuidv4(),
		userId,
		updatedAt: Date.now(),
		title: parsed.title,
		type: parsed.type,
		parentId: parsed.parentId,
		color: parsed.color,
		icon: parsed.icon,
	};
	if (currency) category.currency = currency;

	await db.categories.put(category);
	await recomputeAnalyticsNow(userId);
	return category.id;
}

export async function updateCategory(
	userId: string,
	categoryId: string,
	values: CategoryFormValues
): Promise<void> {
	const parsed = parseCategory(values);
	const existing = await db.categories.get(categoryId);
	if (!existing) {
		throw new Error("Category was not found. Please reload and try again.");
	}

	const currency = normalizeCurrency(parsed.currency);
	const category: Category = {
		...existing,
		title: parsed.title,
		type: parsed.type,
		parentId: parsed.parentId,
		color: parsed.color,
		icon: parsed.icon,
		updatedAt: Date.now(),
	};
	if (currency) {
		category.currency = currency;
	} else {
		delete category.currency;
	}

	await db.categories.put(category);
	await recomputeAnalyticsNow(userId);
}

export async function deleteCategory(category: Category): Promise<void> {
	const updated = await db.categories.update(category.id, {
		deletedAt: Date.now(),
		updatedAt: Date.now(),
	});
	if (updated === 0) {
		throw new Error("Category was not found. Please reload and try again.");
	}
	await recomputeAnalyticsNow(category.userId);
}
