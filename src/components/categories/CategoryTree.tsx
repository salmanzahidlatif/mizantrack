"use client";

import { ChevronRight, MoreVertical, Pencil, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHaptics } from "@/hooks/useHaptics";
import { deleteCategory } from "@/lib/actions/categories";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { getCurrencyByCode } from "@/lib/currencies";
import { useUIStore } from "@/store/ui-store";

import { getCategoryTreeCategories } from "./categoryManagement";

import type { Category, CategoryType } from "@/types";

// ─── CategoryRow ──────────────────────────────────────────────────────────

interface CategoryRowProps {
	category: Category;
	childCount?: number;
	isChild?: boolean;
	onSelect?: (category: Category) => void;
	showCurrencyTag?: boolean;
	showChildCount?: boolean;
	transactionCount?: number;
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
	return `${count} ${count === 1 ? singular : plural}`;
}

function CategoryRow({
	category,
	childCount = 0,
	isChild = false,
	onSelect,
	showCurrencyTag = false,
	showChildCount = false,
	transactionCount,
}: CategoryRowProps) {
	const openEditCategory = useUIStore((s) => s.openEditCategory);
	const haptics = useHaptics();
	const currency = category.currency ? getCurrencyByCode(category.currency) : undefined;
	const icon = getCategoryIcon(category);
	const transactionLabel =
		transactionCount === undefined
			? "Loading transaction count"
			: formatCount(transactionCount, "transaction");
	const showSubcategoryCount = showChildCount && childCount > 0;
	const showDirectOnlyHint = showSubcategoryCount;

	function handleSelect() {
		haptics.selection();
		onSelect?.(category);
	}

	async function handleDelete() {
		await deleteCategory(category);
		toast.success("Category deleted");
	}

	return (
		<div
			className={`flex min-h-12 items-center rounded-xl border border-border/80 bg-card shadow-sm transition-colors ${
				isChild ? "ml-6 border-l-2" : ""
			}`}
			style={isChild && category.color ? { borderLeftColor: category.color } : undefined}>
			<button
				type="button"
				onClick={handleSelect}
				className="press-scale tappable flex min-w-0 flex-1 items-center justify-between gap-2 rounded-xl py-2.5 pr-1 pl-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-muted/50"
				aria-label={`View transactions for ${category.title}${
					showDirectOnlyHint ? " (direct transactions only)" : ""
				}`}>
				<div className="flex min-w-0 flex-1 items-center gap-2">
					{isChild && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
					<span aria-hidden="true" className="text-base leading-none">
						{icon}
					</span>
					<div className="flex min-w-0 flex-1 items-center gap-1.5">
						<span className="truncate text-sm font-medium">{category.title}</span>
						{category.color && (
							<span
								className="h-2 w-2 shrink-0 rounded-full"
								style={{ backgroundColor: category.color }}
							/>
						)}
						{showCurrencyTag && (
							<Badge
								variant="outline"
								className="h-5 rounded-full bg-muted/50 px-1.5 text-[10px] font-semibold text-muted-foreground">
								<span className="text-[11px] leading-none">{currency?.flag ?? "🌐"}</span>
								{category.currency ?? "Untagged"}
							</Badge>
						)}
						{showDirectOnlyHint && (
							<span className="rounded-full bg-muted/45 px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
								direct only
							</span>
						)}
					</div>
				</div>

				<div className="ml-2 flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground">
					<span
						aria-label={transactionLabel}
						className="rounded-full bg-muted/45 px-1.5 py-0.5 leading-none">
						{transactionCount ?? "…"} {transactionCount === 1 ? "txn" : "txns"}
					</span>
					{showSubcategoryCount && (
						<span
							aria-label={formatCount(childCount, "subcategory", "subcategories")}
							className="rounded-full bg-muted/45 px-1.5 py-0.5 leading-none">
							{childCount} subcats
						</span>
					)}
				</div>
			</button>

			<div
				className="relative z-10 flex items-center pr-1"
				onPointerDown={(event) => event.stopPropagation()}
				onClick={(event) => event.stopPropagation()}>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-10 w-10 shrink-0 rounded-full"
							aria-label={`Category options for ${category.title}`}
							onPointerDown={(event) => event.stopPropagation()}
							onClick={(event) => {
								event.preventDefault();
								event.stopPropagation();
							}}>
							<MoreVertical className="h-4 w-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="end"
						onPointerDown={(event) => event.stopPropagation()}
						onClick={(event) => event.stopPropagation()}>
						<DropdownMenuItem
							onSelect={(event) => {
								event.stopPropagation();
								haptics.selection();
								openEditCategory(category.id);
							}}>
							<Pencil className="mr-2 h-4 w-4" />
							Edit
						</DropdownMenuItem>
						<DropdownMenuItem
							className="text-destructive focus:text-destructive"
							onSelect={(event) => {
								event.stopPropagation();
								haptics.warning();
								void handleDelete();
							}}>
							<Trash2 className="mr-2 h-4 w-4" />
							Delete
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}

// ─── CategoryTree ─────────────────────────────────────────────────────────

interface CategoryTreeProps {
	categories: Category[] | undefined;
	childCounts?: ReadonlyMap<string, number>;
	onSelectCategory?: (category: Category) => void;
	type: CategoryType;
	showCurrencyTags?: boolean;
	transactionCounts?: ReadonlyMap<string, number>;
}

function compareCategoryTitle(a: Category, b: Category): number {
	const titleOrder = a.title.localeCompare(b.title);
	if (titleOrder !== 0) return titleOrder;
	return a.id.localeCompare(b.id);
}

function sortCategoriesByTransactionCount(
	categories: Category[],
	transactionCounts?: ReadonlyMap<string, number>
): Category[] {
	return [...categories].sort((a, b) => {
		const usageOrder = (transactionCounts?.get(b.id) ?? 0) - (transactionCounts?.get(a.id) ?? 0);
		if (usageOrder !== 0) return usageOrder;
		return compareCategoryTitle(a, b);
	});
}

export function CategoryTree({
	categories,
	childCounts,
	onSelectCategory,
	type,
	showCurrencyTags = false,
	transactionCounts,
}: CategoryTreeProps) {
	const openAddCategory = useUIStore((s) => s.openAddCategory);
	const haptics = useHaptics();

	if (categories === undefined) {
		return (
			<div className="space-y-2">
				{Array.from({ length: 4 }).map((_, i) => (
					<SkeletonCard key={i} className="h-12" />
				))}
			</div>
		);
	}

	const filtered = getCategoryTreeCategories(categories, type);
	const parents = sortCategoriesByTransactionCount(
		filtered.filter((c) => !c.parentId),
		transactionCounts
	);
	const children = filtered.filter((c) => !!c.parentId);
	const parentIds = new Set(parents.map((parent) => parent.id));
	const childrenByParent = new Map<string, Category[]>();

	for (const child of children) {
		if (!child.parentId || !parentIds.has(child.parentId)) continue;
		const siblings = childrenByParent.get(child.parentId) ?? [];
		siblings.push(child);
		childrenByParent.set(child.parentId, siblings);
	}

	for (const [parentId, siblings] of childrenByParent) {
		childrenByParent.set(parentId, sortCategoriesByTransactionCount(siblings, transactionCounts));
	}

	const orphanedChildren = sortCategoriesByTransactionCount(
		children.filter((c) => !c.parentId || !parentIds.has(c.parentId)),
		transactionCounts
	);

	if (filtered.length === 0) {
		return (
			<EmptyState
				title={`No ${type.toLowerCase()} categories`}
				description="Add a category to classify your transactions."
				action={{ label: `Add ${type} Category`, onClick: openAddCategory }}
			/>
		);
	}

	return (
		<div className="space-y-2">
			{parents.map((parent) => (
				<div key={parent.id} className="space-y-1.5">
					<CategoryRow
						category={parent}
						childCount={childCounts?.get(parent.id) ?? 0}
						onSelect={onSelectCategory}
						showChildCount
						showCurrencyTag={showCurrencyTags}
						transactionCount={
							transactionCounts ? (transactionCounts.get(parent.id) ?? 0) : undefined
						}
					/>
					{(childrenByParent.get(parent.id) ?? []).map((child) => (
						<CategoryRow
							key={child.id}
							category={child}
							isChild
							onSelect={onSelectCategory}
							showCurrencyTag={showCurrencyTags}
							transactionCount={
								transactionCounts ? (transactionCounts.get(child.id) ?? 0) : undefined
							}
						/>
					))}
				</div>
			))}
			{/* Orphaned children (parent was deleted) */}
			{orphanedChildren.map((child) => (
				<CategoryRow
					key={child.id}
					category={child}
					onSelect={onSelectCategory}
					showCurrencyTag={showCurrencyTags}
					transactionCount={transactionCounts ? (transactionCounts.get(child.id) ?? 0) : undefined}
				/>
			))}

			<button
				type="button"
				onClick={() => {
					haptics.selection();
					openAddCategory();
				}}
				className="press-scale tappable flex min-h-12 w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border py-2 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary">
				<Plus className="h-3.5 w-3.5" />
				Add {type} Category
			</button>
		</div>
	);
}
