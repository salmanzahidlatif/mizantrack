import { db } from "@/lib/db/local";

import type {
	Account,
	Category,
	CategoryCurrencyBackfillDecision,
	CategoryCurrencyBackfillDecisionAction,
	Transaction,
} from "@/types";

const CATEGORY_CURRENCY_BACKFILL_VERSION = 1;

export function getCategoryCurrencyBackfillMetaKey(userId: string) {
	return `categoryCurrencyBackfill:${userId}:v${CATEGORY_CURRENCY_BACKFILL_VERSION}`;
}

export interface CategoryCurrencyBackfillSummary {
	alreadyCompleted: boolean;
	completed: boolean;
	tagged: number;
	skippedExplicitCurrency: number;
	skippedUnused: number;
	skippedMultiCurrency: number;
	skippedTreeConflict: number;
	resettableTagged: number;
	markedForSync: number;
	lastRunAt?: number;
}

export interface CategoryCurrencyBackfillResetSummary {
	reset: number;
	skipped: number;
}

interface CategoryCurrencyBackfillInput {
	categories: Category[];
	accounts: Account[];
	transactions: Transaction[];
	assignedAt: number;
}

interface CategoryDecisionDraft {
	category: Category;
	currencies: string[];
	action: CategoryCurrencyBackfillDecisionAction;
	assignedCurrency?: string;
	reason?: string;
}

function normalizeCurrency(value: string | undefined): string | undefined {
	const currency = value?.trim();
	if (!currency) return undefined;
	return currency;
}

function decisionId(userId: string, categoryId: string): string {
	return `v${CATEGORY_CURRENCY_BACKFILL_VERSION}:${userId}:${categoryId}`;
}

function summarizeDecisions(
	decisions: CategoryCurrencyBackfillDecision[],
	options: { alreadyCompleted: boolean; completed: boolean; lastRunAt?: number }
): CategoryCurrencyBackfillSummary {
	const activeTagged = decisions.filter((decision) => decision.action === "tagged");

	return {
		alreadyCompleted: options.alreadyCompleted,
		completed: options.completed,
		tagged: activeTagged.length,
		skippedExplicitCurrency: decisions.filter(
			(decision) => decision.action === "skipped-explicit-currency"
		).length,
		skippedUnused: decisions.filter((decision) => decision.action === "skipped-unused").length,
		skippedMultiCurrency: decisions.filter(
			(decision) => decision.action === "skipped-multi-currency"
		).length,
		skippedTreeConflict: decisions.filter((decision) => decision.action === "skipped-tree-conflict")
			.length,
		resettableTagged: activeTagged.filter((decision) => !decision.resetAt).length,
		markedForSync: activeTagged.filter((decision) => !decision.resetAt).length,
		lastRunAt: options.lastRunAt,
	};
}

async function getStoredDecisions(userId: string): Promise<CategoryCurrencyBackfillDecision[]> {
	return db.categoryCurrencyBackfillDecisions.where("userId").equals(userId).toArray();
}

export async function getCategoryCurrencyBackfillStatus(
	userId: string
): Promise<CategoryCurrencyBackfillSummary> {
	const marker = await db.syncMeta.get(getCategoryCurrencyBackfillMetaKey(userId));
	const decisions = await getStoredDecisions(userId);

	return summarizeDecisions(decisions, {
		alreadyCompleted: Boolean(marker),
		completed: Boolean(marker),
		lastRunAt: marker?.timestamp,
	});
}

function collectCategoryUsageCurrencies(input: CategoryCurrencyBackfillInput) {
	const categoriesById = new Map(input.categories.map((category) => [category.id, category]));
	const accountCurrenciesById = new Map(
		input.accounts
			.map((account) => [account.id, normalizeCurrency(account.currency)] as const)
			.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))
	);
	const currenciesByCategoryId = new Map<string, Set<string>>();

	function addCurrency(categoryId: string, accountId: string | undefined) {
		if (!accountId) return;
		const currency = accountCurrenciesById.get(accountId);
		if (!currency) return;
		const currencies = currenciesByCategoryId.get(categoryId) ?? new Set<string>();
		currencies.add(currency);
		currenciesByCategoryId.set(categoryId, currencies);
	}

	for (const transaction of input.transactions) {
		if (!transaction.categoryId || !categoriesById.has(transaction.categoryId)) continue;

		addCurrency(transaction.categoryId, transaction.accountId);
		if (transaction.type === "Transfer") {
			addCurrency(transaction.categoryId, transaction.toAccountId);
		}
	}

	return currenciesByCategoryId;
}

function buildDecisionDrafts(input: CategoryCurrencyBackfillInput): CategoryDecisionDraft[] {
	const usageCurrencies = collectCategoryUsageCurrencies(input);
	const drafts = input.categories.map((category): CategoryDecisionDraft => {
		const currencies = Array.from(usageCurrencies.get(category.id) ?? []).sort();
		const explicitCurrency = normalizeCurrency(category.currency);

		if (explicitCurrency) {
			return {
				category,
				currencies,
				action: "skipped-explicit-currency",
				reason: "Category already has a currency, so the backfill will not overwrite it.",
			};
		}

		if (currencies.length === 0) {
			return {
				category,
				currencies,
				action: "skipped-unused",
				reason: "Category has no active transaction usage with an active account.",
			};
		}

		if (currencies.length > 1) {
			return {
				category,
				currencies,
				action: "skipped-multi-currency",
				reason: "Category is used by active accounts in multiple currencies and must stay shared.",
			};
		}

		return {
			category,
			currencies,
			action: "tagged",
			assignedCurrency: currencies[0],
		};
	});

	return applyTreeCompatibility(drafts, input.categories);
}

function applyTreeCompatibility(
	drafts: CategoryDecisionDraft[],
	categories: Category[]
): CategoryDecisionDraft[] {
	const categoriesById = new Map(categories.map((category) => [category.id, category]));
	const candidateCurrencyById = new Map(
		drafts
			.filter((draft) => draft.action === "tagged" && draft.assignedCurrency)
			.map((draft) => [draft.category.id, draft.assignedCurrency as string])
	);
	const childrenByParentId = new Map<string, Category[]>();

	for (const category of categories) {
		if (!category.parentId) continue;
		const children = childrenByParentId.get(category.parentId) ?? [];
		children.push(category);
		childrenByParentId.set(category.parentId, children);
	}

	return drafts.map((draft) => {
		if (draft.action !== "tagged" || !draft.assignedCurrency) return draft;

		const parent = draft.category.parentId
			? categoriesById.get(draft.category.parentId)
			: undefined;
		const parentCurrency = normalizeCurrency(parent?.currency);
		if (parentCurrency && parentCurrency !== draft.assignedCurrency) {
			return {
				...draft,
				action: "skipped-tree-conflict",
				assignedCurrency: undefined,
				reason:
					"Category parent has a different currency, so auto-tagging would orphan it in the tree.",
			};
		}

		const children = childrenByParentId.get(draft.category.id) ?? [];
		const incompatibleChild = children.find((child) => {
			const childCurrency = normalizeCurrency(child.currency);
			if (childCurrency) return childCurrency !== draft.assignedCurrency;
			return candidateCurrencyById.get(child.id) !== draft.assignedCurrency;
		});

		if (incompatibleChild) {
			return {
				...draft,
				action: "skipped-tree-conflict",
				assignedCurrency: undefined,
				reason:
					"At least one child category would stay shared or use a different currency, so the parent must stay shared.",
			};
		}

		return draft;
	});
}

function toDecision(
	userId: string,
	draft: CategoryDecisionDraft,
	assignedAt: number,
	categoryUpdatedAt?: number
): CategoryCurrencyBackfillDecision {
	const decision: CategoryCurrencyBackfillDecision = {
		id: decisionId(userId, draft.category.id),
		userId,
		categoryId: draft.category.id,
		categoryTitle: draft.category.title,
		action: draft.action,
		currencies: draft.currencies,
		assignedAt,
		version: CATEGORY_CURRENCY_BACKFILL_VERSION,
	};

	if (draft.assignedCurrency) decision.assignedCurrency = draft.assignedCurrency;
	if (categoryUpdatedAt) decision.categoryUpdatedAt = categoryUpdatedAt;
	if (draft.reason) decision.reason = draft.reason;

	return decision;
}

async function loadBackfillInput(
	userId: string,
	assignedAt: number
): Promise<CategoryCurrencyBackfillInput> {
	const [categories, accounts, transactions] = await Promise.all([
		db.categories
			.where("userId")
			.equals(userId)
			.filter((category) => !category.deletedAt)
			.toArray(),
		db.accounts
			.where("userId")
			.equals(userId)
			.filter((account) => !account.deletedAt)
			.toArray(),
		db.transactions
			.where("userId")
			.equals(userId)
			.filter((transaction) => !transaction.deletedAt)
			.toArray(),
	]);

	return { categories, accounts, transactions, assignedAt };
}

export async function runCategoryCurrencyBackfill(
	userId: string
): Promise<CategoryCurrencyBackfillSummary> {
	const markerKey = getCategoryCurrencyBackfillMetaKey(userId);
	const existingMarker = await db.syncMeta.get(markerKey);
	if (existingMarker) {
		const decisions = await getStoredDecisions(userId);
		return summarizeDecisions(decisions, {
			alreadyCompleted: true,
			completed: true,
			lastRunAt: existingMarker.timestamp,
		});
	}

	const assignedAt = Date.now();
	const input = await loadBackfillInput(userId, assignedAt);
	const drafts = buildDecisionDrafts(input);
	const categoryUpdatedAt = assignedAt;
	const decisions = drafts.map((draft) =>
		toDecision(userId, draft, assignedAt, draft.action === "tagged" ? categoryUpdatedAt : undefined)
	);
	const taggedDrafts = drafts.filter(
		(draft) => draft.action === "tagged" && draft.assignedCurrency
	);

	await db.transaction(
		"rw",
		db.categories,
		db.syncMeta,
		db.categoryCurrencyBackfillDecisions,
		async () => {
			const marker = await db.syncMeta.get(markerKey);
			if (marker) return;

			await db.categoryCurrencyBackfillDecisions.where("userId").equals(userId).delete();

			for (const draft of taggedDrafts) {
				await db.categories.update(draft.category.id, {
					currency: draft.assignedCurrency,
					updatedAt: categoryUpdatedAt,
				});
			}

			if (decisions.length > 0) {
				await db.categoryCurrencyBackfillDecisions.bulkPut(decisions);
			}
			await db.syncMeta.put({ id: markerKey, timestamp: assignedAt });
		}
	);

	const marker = await db.syncMeta.get(markerKey);
	if (marker?.timestamp !== assignedAt) {
		return getCategoryCurrencyBackfillStatus(userId);
	}

	return summarizeDecisions(decisions, {
		alreadyCompleted: false,
		completed: true,
		lastRunAt: assignedAt,
	});
}

export async function resetAutoAssignedCategoryCurrencies(
	userId: string
): Promise<CategoryCurrencyBackfillResetSummary> {
	const decisions = await db.categoryCurrencyBackfillDecisions
		.where("userId")
		.equals(userId)
		.and((decision) => decision.action === "tagged" && !decision.resetAt)
		.toArray();
	const resetAt = Date.now();
	let reset = 0;
	let skipped = 0;

	await db.transaction("rw", db.categories, db.categoryCurrencyBackfillDecisions, async () => {
		for (const decision of decisions) {
			const category = await db.categories.get(decision.categoryId);
			if (
				category &&
				!category.deletedAt &&
				category.currency === decision.assignedCurrency &&
				category.updatedAt === decision.categoryUpdatedAt
			) {
				await db.categories.update(category.id, {
					currency: undefined,
					updatedAt: resetAt,
				});
				reset++;
			} else {
				skipped++;
			}

			await db.categoryCurrencyBackfillDecisions.update(decision.id, { resetAt });
		}
	});

	return { reset, skipped };
}
