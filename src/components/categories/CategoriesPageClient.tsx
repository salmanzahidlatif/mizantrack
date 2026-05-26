"use client";

import { useState } from "react";

import { CategoryDrawer } from "@/components/categories/CategoryDrawer";
import { CategoryTree } from "@/components/categories/CategoryTree";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCategories } from "@/hooks/useCategories";
import { useUIStore } from "@/store/ui-store";

import type { CategoryType } from "@/types";

interface CategoriesPageClientProps {
	userId: string;
}

export function CategoriesPageClient({ userId }: CategoriesPageClientProps) {
	const categories = useCategories(userId);
	const openAddCategory = useUIStore((s) => s.openAddCategory);
	const [activeTab, setActiveTab] = useState<CategoryType>("Expense");

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between gap-2">
				<div>
					<h1 className="text-2xl font-bold">Categories</h1>
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

			<Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as CategoryType)}>
				<TabsList className="grid w-full grid-cols-2">
					<TabsTrigger value="Expense">Expense</TabsTrigger>
					<TabsTrigger value="Income">Income</TabsTrigger>
				</TabsList>
				<TabsContent value="Expense" className="mt-4">
					<CategoryTree categories={categories} type="Expense" />
				</TabsContent>
				<TabsContent value="Income" className="mt-4">
					<CategoryTree categories={categories} type="Income" />
				</TabsContent>
			</Tabs>

			<CategoryDrawer userId={userId} defaultType={activeTab} />
		</div>
	);
}
