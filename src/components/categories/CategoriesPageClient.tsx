"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CategoryDrawer } from "@/components/categories/CategoryDrawer";
import {
	filterCategoriesForManagement,
	type CategoryCurrencyScope,
} from "@/components/categories/categoryManagement";
import { CategoryTree } from "@/components/categories/CategoryTree";
import { DuplicateCategoryMergePanel } from "@/components/categories/DuplicateCategoryMergePanel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCategories } from "@/hooks/useCategories";
import { useCategoryUsageCounts } from "@/hooks/useCategoryUsageCounts";
import { useDbConfig } from "@/hooks/useDbConfig";
import { useHaptics } from "@/hooks/useHaptics";
import { useRequiredUserId } from "@/hooks/useRequiredUserId";
import { normalizeCurrencyCode, resolveCurrencyCode } from "@/lib/analytics/balanceMath";
import { getCurrencyByCode } from "@/lib/currencies";
import { useFilterStore } from "@/store/filter-store";
import { useUIStore } from "@/store/ui-store";

import type { Category, CategoryType } from "@/types";

interface CategoriesPageClientProps {
	userId?: string;
}

export function CategoriesPageClient({ userId: providedUserId }: CategoriesPageClientProps = {}) {
	const userId = useRequiredUserId(providedUserId);
	const router = useRouter();
	const config = useDbConfig(userId);
	const { activeCurrency, setActiveCurrency, setCategoryId, setTransactionType } = useFilterStore();
	const haptics = useHaptics();
	const enabledCurrencies =
		config?.enabledCurrencies && config.enabledCurrencies.length > 0
			? config.enabledCurrencies.map(normalizeCurrencyCode).filter(Boolean)
			: config?.currency
				? [normalizeCurrencyCode(config.currency)]
				: [];
	const resolvedCurrency = resolveCurrencyCode(activeCurrency, config?.currency);
	const canToggleCurrencyScope = Boolean(resolvedCurrency) && enabledCurrencies.length > 1;
	const [currencyScope, setCurrencyScope] = useState<CategoryCurrencyScope>("currency");
	const effectiveCurrencyScope = canToggleCurrencyScope ? currencyScope : "currency";
	const allCategories = useCategories(userId);
	const categories = filterCategoriesForManagement(
		allCategories,
		effectiveCurrencyScope,
		resolvedCurrency
	);
	const { childCounts, transactionCounts } = useCategoryUsageCounts(userId, categories);
	const openAddCategory = useUIStore((s) => s.openAddCategory);
	const [activeTab, setActiveTab] = useState<CategoryType>("Expense");
	const activeCurrencyEntry = getCurrencyByCode(resolvedCurrency);

	useEffect(() => {
		setCurrencyScope("currency");
	}, [resolvedCurrency, canToggleCurrencyScope]);

	function updateCurrencyScope(scope: CategoryCurrencyScope) {
		haptics.selection();
		setCurrencyScope(scope);
	}

	function handleSelectCategory(category: Category) {
		setCategoryId(category.id);
		setTransactionType(category.type);
		if (category.currency) {
			setActiveCurrency(category.currency);
		}
		router.push("/transactions");
	}

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between gap-2">
				<div>
					<h1 className="hidden text-2xl font-bold md:block">Categories</h1>
					{categories !== undefined && (
						<p className="text-sm text-muted-foreground">
							{categories.filter((c) => !c.deletedAt).length} categories
						</p>
					)}
				</div>
				<Button size="sm" onClick={openAddCategory}>
					Add Category
				</Button>
			</div>

			{canToggleCurrencyScope && (
				<div className="rounded-2xl border border-border/70 bg-card p-1 shadow-sm">
					<div className="grid grid-cols-2 gap-1 rounded-xl bg-muted/70 p-1">
						<button
							type="button"
							onClick={() => updateCurrencyScope("currency")}
							className={`press-scale tappable flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors ${
								effectiveCurrencyScope === "currency"
									? "bg-background text-foreground shadow-sm"
									: "text-muted-foreground"
							}`}>
							<span>{activeCurrencyEntry?.flag ?? "🌐"}</span>
							<span>This currency</span>
							<span className="text-xs text-muted-foreground">{resolvedCurrency}</span>
						</button>
						<button
							type="button"
							onClick={() => updateCurrencyScope("all")}
							className={`press-scale tappable flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors ${
								effectiveCurrencyScope === "all"
									? "bg-background text-foreground shadow-sm"
									: "text-muted-foreground"
							}`}>
							<span>🌐</span>
							<span>All currencies</span>
						</button>
					</div>
				</div>
			)}

			<DuplicateCategoryMergePanel userId={userId} />

			<Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as CategoryType)}>
				<TabsList className="grid w-full grid-cols-2">
					<TabsTrigger value="Expense">Expense</TabsTrigger>
					<TabsTrigger value="Income">Income</TabsTrigger>
				</TabsList>
				<TabsContent value="Expense" className="mt-4">
					<CategoryTree
						categories={categories}
						childCounts={childCounts}
						onSelectCategory={handleSelectCategory}
						type="Expense"
						showCurrencyTags
						transactionCounts={transactionCounts}
					/>
				</TabsContent>
				<TabsContent value="Income" className="mt-4">
					<CategoryTree
						categories={categories}
						childCounts={childCounts}
						onSelectCategory={handleSelectCategory}
						type="Income"
						showCurrencyTags
						transactionCounts={transactionCounts}
					/>
				</TabsContent>
			</Tabs>

			<CategoryDrawer userId={userId} defaultType={activeTab} />
		</div>
	);
}
