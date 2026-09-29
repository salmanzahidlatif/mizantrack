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
import { getCurrencyByCode } from "@/lib/currencies";
import { db } from "@/lib/db/local";
import { useUIStore } from "@/store/ui-store";

import type { Category, CategoryType } from "@/types";

// ─── CategoryRow ──────────────────────────────────────────────────────────

interface CategoryRowProps {
	category: Category;
	isChild?: boolean;
}

function CategoryRow({ category, isChild = false }: CategoryRowProps) {
	const openEditCategory = useUIStore((s) => s.openEditCategory);
	const haptics = useHaptics();
	const currency = category.currency ? getCurrencyByCode(category.currency) : undefined;

	async function handleDelete() {
		await db.categories.update(category.id, {
			deletedAt: Date.now(),
			updatedAt: Date.now(),
		});
		toast.success("Category deleted");
	}

	return (
		<div
			className={`press-scale tappable flex min-h-12 items-center justify-between rounded-xl border border-border/80 bg-card px-3 py-2.5 shadow-sm transition-colors active:bg-muted/50 ${
				isChild ? "ml-6 border-l-2" : ""
			}`}
			style={isChild && category.color ? { borderLeftColor: category.color } : undefined}>
			<div className="flex min-w-0 flex-1 items-center gap-2">
				{isChild && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
				{category.icon && <span className="text-base leading-none">{category.icon}</span>}
				<div className="flex min-w-0 flex-1 items-center gap-1.5">
					<span className="truncate text-sm font-medium">{category.title}</span>
					{category.color && (
						<span
							className="h-2 w-2 shrink-0 rounded-full"
							style={{ backgroundColor: category.color }}
						/>
					)}
					{category.currency && (
						<Badge
							variant="outline"
							className="h-5 rounded-full bg-muted/50 px-1.5 text-[10px] font-semibold text-muted-foreground">
							<span className="text-[11px] leading-none">{currency?.flag ?? "🌐"}</span>
							{category.currency}
						</Badge>
					)}
				</div>
			</div>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-full">
						<MoreVertical className="h-4 w-4" />
						<span className="sr-only">Category options</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						onClick={() => {
							haptics.selection();
							openEditCategory(category.id);
						}}>
						<Pencil className="mr-2 h-4 w-4" />
						Edit
					</DropdownMenuItem>
					<DropdownMenuItem
						className="text-destructive focus:text-destructive"
						onClick={() => {
							haptics.warning();
							void handleDelete();
						}}>
						<Trash2 className="mr-2 h-4 w-4" />
						Delete
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

// ─── CategoryTree ─────────────────────────────────────────────────────────

interface CategoryTreeProps {
	categories: Category[] | undefined;
	type: CategoryType;
}

export function CategoryTree({ categories, type }: CategoryTreeProps) {
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

	const filtered = categories.filter((c) => c.type === type);
	const parents = filtered.filter((c) => !c.parentId);
	const children = filtered.filter((c) => !!c.parentId);

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
					<CategoryRow category={parent} />
					{children
						.filter((c) => c.parentId === parent.id)
						.map((child) => (
							<CategoryRow key={child.id} category={child} isChild />
						))}
				</div>
			))}
			{/* Orphaned children (parent was deleted) */}
			{children
				.filter((c) => !parents.find((p) => p.id === c.parentId))
				.map((child) => (
					<CategoryRow key={child.id} category={child} />
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
