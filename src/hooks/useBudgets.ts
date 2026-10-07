"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { v4 as uuidv4 } from "uuid";

import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { db } from "@/lib/db/local";

import type { PeriodAnalytics } from "@/lib/analytics/periodAnalytics";
import type { Budget, Category } from "@/types";

export type BudgetProgressStatus = "under" | "near" | "over";

export interface BudgetFormValues {
	categoryId: string;
	period: string;
	amount: number;
	currency: string;
}

export interface BudgetProgressRow {
	budget: Budget;
	category?: Category;
	categoryId: string;
	title: string;
	icon?: string;
	color?: string;
	budgeted: number;
	spent: number;
	remaining: number;
	progressRatio: number;
	progressPercent: number;
	status: BudgetProgressStatus;
	currency: string;
}

export interface BudgetQueryResult {
	budgets: Budget[];
	categories: Category[];
	rows: BudgetProgressRow[];
}

const PERIOD_PATTERN = /^\d{4}-\d{2}$/;

function normalizeCurrency(value: string | undefined): string {
	return normalizeCurrencyCode(value) ?? "";
}

function normalizeAmount(value: number): number {
	return Math.round(value * 100) / 100;
}

function assertBudgetValues(values: BudgetFormValues): BudgetFormValues {
	const categoryId = values.categoryId.trim();
	const period = values.period.trim();
	const currency = normalizeCurrency(values.currency);
	const amount = normalizeAmount(Number(values.amount));

	if (!categoryId) throw new Error("Choose an expense category.");
	if (!PERIOD_PATTERN.test(period)) throw new Error("Choose a valid budget month.");
	if (!currency) throw new Error("Choose a currency before saving a budget.");
	if (!Number.isFinite(amount) || amount <= 0) {
		throw new Error("Budget amount must be greater than zero.");
	}

	return { categoryId, period, amount, currency };
}

export function getBudgetProgressStatus(budgeted: number, spent: number): BudgetProgressStatus {
	if (budgeted > 0 && spent > budgeted) return "over";
	if (budgeted > 0 && spent >= budgeted * 0.8) return "near";
	return "under";
}

function budgetMatchesCurrency(
	budget: Budget,
	category: Category | undefined,
	currency: string
): boolean {
	const budgetCurrency = normalizeCurrency(budget.currency);
	if (budgetCurrency) return budgetCurrency === currency;

	return normalizeCurrency(category?.currency) === currency;
}

function buildSpendByCategory(
	analytics: PeriodAnalytics | undefined,
	currency: string
): Map<string, number> {
	const spend = new Map<string, number>();
	if (!analytics || normalizeCurrency(analytics.currency) !== currency) return spend;

	for (const item of analytics.expenseBreakdown) {
		if (!item.categoryId) continue;
		spend.set(item.categoryId, item.amount);
	}

	return spend;
}

export function buildBudgetProgressRows(
	budgets: Budget[],
	categories: Category[],
	analytics: PeriodAnalytics | undefined,
	currencyValue: string
): BudgetProgressRow[] {
	const currency = normalizeCurrency(currencyValue);
	if (!currency) return [];

	const categoriesById = new Map(categories.map((category) => [category.id, category]));
	const spendByCategory = buildSpendByCategory(analytics, currency);

	return budgets
		.filter((budget) => {
			if (budget.deletedAt || budget.active === false) return false;
			return budgetMatchesCurrency(budget, categoriesById.get(budget.categoryId), currency);
		})
		.map((budget) => {
			const category = categoriesById.get(budget.categoryId);
			const spent = spendByCategory.get(budget.categoryId) ?? 0;
			const budgeted = budget.amount;
			const remaining = budgeted - spent;
			const progressRatio = budgeted > 0 ? spent / budgeted : 0;
			const status = getBudgetProgressStatus(budgeted, spent);

			return {
				budget,
				category,
				categoryId: budget.categoryId,
				title: category?.title ?? "Unknown category",
				icon: category?.icon,
				color: category?.color,
				budgeted,
				spent,
				remaining,
				progressRatio,
				progressPercent: Math.min(Math.max(progressRatio * 100, 0), 100),
				status,
				currency,
			};
		})
		.sort((a, b) => {
			const statusRank: Record<BudgetProgressStatus, number> = { over: 0, near: 1, under: 2 };
			return statusRank[a.status] - statusRank[b.status] || a.title.localeCompare(b.title);
		});
}

export function useBudgets(
	userId: string,
	period: string,
	currencyValue: string,
	analytics: PeriodAnalytics | undefined
): BudgetQueryResult | undefined {
	const currency = normalizeCurrency(currencyValue);

	const result = useLiveQuery(
		async () => {
			if (!userId || !period || !currency) {
				return {
					budgets: [],
					categories: [],
					rows: [],
				};
			}

			const [budgets, categories] = await Promise.all([
				db.budgets.where("[userId+period]").equals([userId, period]).toArray(),
				db.categories
					.where("userId")
					.equals(userId)
					.filter(
						(category) =>
							!category.deletedAt &&
							category.type === "Expense" &&
							normalizeCurrency(category.currency) === currency
					)
					.toArray(),
			]);

			return {
				budgets,
				categories,
				rows: buildBudgetProgressRows(budgets, categories, analytics, currency),
			};
		},
		[userId, period, currency, analytics],
		undefined
	);

	return result;
}

async function ensureBudgetCategory(
	userId: string,
	categoryId: string,
	currency: string
): Promise<Category> {
	const category = await db.categories.get(categoryId);
	if (category?.userId !== userId) {
		throw new Error("Choose an expense category for the active currency.");
	}
	if (
		category.deletedAt ||
		category.type !== "Expense" ||
		normalizeCurrency(category.currency) !== currency
	) {
		throw new Error("Choose an expense category for the active currency.");
	}

	return category;
}

export async function createBudget(
	userId: string,
	values: BudgetFormValues,
	options?: { id?: string }
): Promise<string> {
	const parsed = assertBudgetValues(values);
	await ensureBudgetCategory(userId, parsed.categoryId, parsed.currency);

	const existing = await db.budgets
		.where("[categoryId+period]")
		.equals([parsed.categoryId, parsed.period])
		.filter(
			(budget) =>
				budget.userId === userId &&
				!budget.deletedAt &&
				budget.active !== false &&
				(!normalizeCurrency(budget.currency) ||
					normalizeCurrency(budget.currency) === parsed.currency)
		)
		.first();

	const now = Date.now();
	if (existing) {
		await db.budgets.update(existing.id, {
			amount: parsed.amount,
			active: true,
			currency: parsed.currency,
			updatedAt: now,
		});
		return existing.id;
	}

	const id = options?.id ?? uuidv4();
	await db.budgets.put({
		id,
		userId,
		categoryId: parsed.categoryId,
		period: parsed.period,
		amount: parsed.amount,
		currency: parsed.currency,
		active: true,
		updatedAt: now,
	});

	return id;
}

export async function updateBudget(
	userId: string,
	budgetId: string,
	values: BudgetFormValues
): Promise<void> {
	const parsed = assertBudgetValues(values);
	const existing = await db.budgets.get(budgetId);
	if (existing?.userId !== userId) {
		throw new Error("Budget was not found. Please reload and try again.");
	}
	if (existing.deletedAt) {
		throw new Error("Budget was not found. Please reload and try again.");
	}

	await ensureBudgetCategory(userId, parsed.categoryId, parsed.currency);
	const updated = await db.budgets.update(budgetId, {
		categoryId: parsed.categoryId,
		period: parsed.period,
		amount: parsed.amount,
		currency: parsed.currency,
		active: true,
		updatedAt: Date.now(),
	});
	if (updated === 0) {
		throw new Error("Budget was not found. Please reload and try again.");
	}
}

export async function deleteBudget(userId: string, budgetId: string): Promise<void> {
	const existing = await db.budgets.get(budgetId);
	if (existing?.userId !== userId) {
		throw new Error("Budget was not found. Please reload and try again.");
	}
	if (existing.deletedAt) {
		throw new Error("Budget was not found. Please reload and try again.");
	}

	const now = Date.now();
	const updated = await db.budgets.update(budgetId, {
		active: false,
		deletedAt: now,
		updatedAt: now,
	});
	if (updated === 0) {
		throw new Error("Budget was not found. Please reload and try again.");
	}
}
