"use client";

import { ChevronRight, MoreVertical, Pencil, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

	async function handleDelete() {
		await db.categories.update(category.id, {
			deletedAt: Date.now(),
			updatedAt: Date.now(),
		});
		toast.success("Category deleted");
	}

	return (
		<div
			className={`flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5 ${
				isChild ? "ml-6 border-l-2" : ""
			}`}
			style={isChild && category.color ? { borderLeftColor: category.color } : undefined}>
			<div className="flex min-w-0 items-center gap-2">
				{isChild && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
				{category.icon && <span className="text-base leading-none">{category.icon}</span>}
				<span className="truncate text-sm font-medium">{category.title}</span>
				{category.color && (
					<span
						className="h-2 w-2 shrink-0 rounded-full"
						style={{ backgroundColor: category.color }}
					/>
				)}
			</div>

			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
						<MoreVertical className="h-4 w-4" />
						<span className="sr-only">Category options</span>
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem onClick={() => openEditCategory(category.id)}>
						<Pencil className="mr-2 h-4 w-4" />
						Edit
					</DropdownMenuItem>
					<DropdownMenuItem
						className="text-destructive focus:text-destructive"
						onClick={() => {
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
				onClick={openAddCategory}
				className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary">
				<Plus className="h-3.5 w-3.5" />
				Add {type} Category
			</button>
		</div>
	);
}
