"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";

import { Button } from "@/components/ui/button";
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useCategories } from "@/hooks/useCategories";
import { db } from "@/lib/db/local";
import { categorySchema, type CategoryFormValues } from "@/lib/validations/category";
import { useUIStore } from "@/store/ui-store";

import type { Category, CategoryType } from "@/types";

const COLOR_SWATCHES = [
	"#6366f1",
	"#8b5cf6",
	"#ec4899",
	"#f97316",
	"#22c55e",
	"#14b8a6",
	"#3b82f6",
	"#eab308",
];

interface CategoryDrawerProps {
	userId: string;
	/** Pre-select the type when opening "Add" — comes from the active tab */
	defaultType?: CategoryType;
}

export function CategoryDrawer({ userId, defaultType = "Expense" }: CategoryDrawerProps) {
	const { isCategoryDrawerOpen, editCategoryId, closeCategoryDrawer } = useUIStore();
	const allCategories = useCategories(userId);

	const {
		register,
		handleSubmit,
		reset,
		watch,
		setValue,
		formState: { errors, isSubmitting },
	} = useForm<CategoryFormValues>({
		resolver: zodResolver(categorySchema),
		defaultValues: { type: defaultType },
	});

	const watchedType = watch("type") as CategoryType | undefined;
	const selectedColor = watch("color");

	// Parent categories filtered to same type
	const parentOptions = (allCategories ?? []).filter(
		(c) => c.type === watchedType && !c.parentId && c.id !== editCategoryId
	);

	// Load category for editing
	useEffect(() => {
		if (!isCategoryDrawerOpen) {
			reset({ type: defaultType });
			return;
		}
		if (!editCategoryId) return;

		void db.categories.get(editCategoryId).then((cat: Category | undefined) => {
			if (!cat) return;
			reset({
				title: cat.title,
				type: cat.type,
				parentId: cat.parentId,
				color: cat.color,
				icon: cat.icon,
			});
		});
	}, [isCategoryDrawerOpen, editCategoryId, defaultType, reset]);

	async function onSubmit(values: CategoryFormValues) {
		const now = Date.now();
		if (editCategoryId) {
			await db.categories.update(editCategoryId, { ...values, updatedAt: now });
			toast.success("Category updated");
		} else {
			await db.categories.put({
				id: uuidv4(),
				userId,
				updatedAt: now,
				...values,
			});
			toast.success("Category created");
		}
		closeCategoryDrawer();
	}

	return (
		<Drawer open={isCategoryDrawerOpen} onOpenChange={(open) => !open && closeCategoryDrawer()}>
			<DrawerContent>
				<DrawerHeader>
					<DrawerTitle>{editCategoryId ? "Edit Category" : "Add Category"}</DrawerTitle>
				</DrawerHeader>

				<form
					onSubmit={(e) => {
						void handleSubmit(onSubmit)(e);
					}}
					className="space-y-4 px-4 pb-2">
					{/* Title */}
					<div className="space-y-1.5">
						<Label htmlFor="cat-title">Title *</Label>
						<Input id="cat-title" placeholder="e.g. Food & Dining" {...register("title")} />
						{errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
					</div>

					{/* Type */}
					<div className="space-y-1.5">
						<Label>Type *</Label>
						<div className="flex gap-2">
							{(["Expense", "Income"] as CategoryType[]).map((t) => (
								<button
									key={t}
									type="button"
									onClick={() => {
										setValue("type", t, { shouldValidate: true });
										setValue("parentId", undefined);
									}}
									className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors ${
										watchedType === t
											? "border-primary bg-primary text-primary-foreground"
											: "border-border hover:border-primary"
									}`}>
									{t}
								</button>
							))}
						</div>
						{errors.type && <p className="text-xs text-destructive">{errors.type.message}</p>}
					</div>

					{/* Parent category */}
					{parentOptions.length > 0 && (
						<div className="space-y-1.5">
							<Label>Parent Category (optional)</Label>
							<Select
								value={watch("parentId") ?? "none"}
								onValueChange={(v) =>
									setValue("parentId", v === "none" ? undefined : v, { shouldValidate: true })
								}>
								<SelectTrigger>
									<SelectValue placeholder="None (top-level)" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">None (top-level)</SelectItem>
									{parentOptions.map((c) => (
										<SelectItem key={c.id} value={c.id}>
											{c.icon} {c.title}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{errors.parentId && (
								<p className="text-xs text-destructive">{errors.parentId.message}</p>
							)}
						</div>
					)}

					{/* Color */}
					<div className="space-y-1.5">
						<Label>Color</Label>
						<div className="flex gap-2">
							{COLOR_SWATCHES.map((c) => (
								<button
									key={c}
									type="button"
									onClick={() => setValue("color", selectedColor === c ? undefined : c)}
									className="h-6 w-6 rounded-full transition-transform hover:scale-110"
									style={{
										backgroundColor: c,
										outline: selectedColor === c ? `2px solid ${c}` : undefined,
										outlineOffset: 2,
									}}
								/>
							))}
						</div>
					</div>

					{/* Icon */}
					<div className="space-y-1.5">
						<Label htmlFor="cat-icon">Icon (emoji)</Label>
						<Input id="cat-icon" placeholder="🍽️" maxLength={2} {...register("icon")} />
					</div>

					<DrawerFooter className="px-0">
						<Button type="submit" disabled={isSubmitting} className="w-full">
							{isSubmitting ? "Saving…" : editCategoryId ? "Save Changes" : "Add Category"}
						</Button>
						<DrawerClose asChild>
							<Button
								variant="outline"
								type="button"
								className="w-full"
								onClick={closeCategoryDrawer}>
								Cancel
							</Button>
						</DrawerClose>
					</DrawerFooter>
				</form>
			</DrawerContent>
		</Drawer>
	);
}
