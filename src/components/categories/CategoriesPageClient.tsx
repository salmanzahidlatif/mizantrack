"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { CategoryDrawer } from "@/components/categories/CategoryDrawer";
import { filterCategoriesForManagement } from "@/components/categories/categoryManagement";
import { CategoryTree } from "@/components/categories/CategoryTree";
import { DuplicateCategoryMergePanel } from "@/components/categories/DuplicateCategoryMergePanel";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCategories } from "@/hooks/useCategories";
import { useCategoryUsageCounts } from "@/hooks/useCategoryUsageCounts";
import { useDbConfig } from "@/hooks/useDbConfig";
import { useRequiredUserId } from "@/hooks/useRequiredUserId";
import { resolveCurrencyCode } from "@/lib/analytics/balanceMath";
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
	const resolvedCurrency = resolveCurrencyCode(activeCurrency, config?.currency);
	const allCategories = useCategories(userId);
	// Categories are always scoped to the active currency. Showing every currency at once
	// listed each book's own set side by side, which read as duplicates even though an
	// AED "Medical" and a PKR "Medical" are deliberately separate records.
	const categories = filterCategoriesForManagement(allCategories, "currency", resolvedCurrency);
	const { childCounts, transactionCounts } = useCategoryUsageCounts(userId, categories);
	const openAddCategory = useUIStore((s) => s.openAddCategory);
	const [activeTab, setActiveTab] = useState<CategoryType>("Expense");

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
