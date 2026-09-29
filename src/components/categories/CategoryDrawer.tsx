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
	DrawerDescription,
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
import { useDbConfig } from "@/hooks/useDbConfig";
import { getCurrencyByCode } from "@/lib/currencies";
import { db } from "@/lib/db/local";
import { categorySchema, type CategoryFormValues } from "@/lib/validations/category";
import { useFilterStore } from "@/store/filter-store";
import { useUIStore } from "@/store/ui-store";

import type { Category, CategoryType } from "@/types";

const SHARED_CURRENCY_VALUE = "__shared__";
const CATEGORY_FORM_ID = "category-drawer-form";
const FORM_DRAWER_CONTENT_CLASS =
	"overflow-hidden pb-0 data-[vaul-drawer-direction=bottom]:h-[calc(100dvh_-_env(safe-area-inset-top,0px)_-_1rem)] data-[vaul-drawer-direction=bottom]:max-h-[95dvh] data-[vaul-drawer-direction=bottom]:pb-0";
const FOCUSABLE_FIELD_SELECTOR =
	"input, textarea, select, button, [role='combobox'], [contenteditable='true']";
const FOCUS_SCROLL_DELAY = 280;

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

function scrollFocusedFieldIntoView(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return;

	const field = target.closest(FOCUSABLE_FIELD_SELECTOR);
	if (!(field instanceof HTMLElement)) return;

	const scroll = () => {
		field.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
	};

	window.requestAnimationFrame(scroll);
	window.setTimeout(scroll, FOCUS_SCROLL_DELAY);
}

function includeRecordsById<T extends { id: string }>(
	records: T[],
	extraRecords: T[],
	ids: Array<string | undefined>
): T[] {
	const wantedIds = new Set(ids.filter((id): id is string => Boolean(id)));
	const seenIds = new Set(records.map((record) => record.id));
	const merged = [...records];

	for (const record of extraRecords) {
		if (wantedIds.has(record.id) && !seenIds.has(record.id)) {
			merged.push(record);
			seenIds.add(record.id);
		}
	}

	return merged;
}

interface CategoryDrawerProps {
	userId: string;
	/** Pre-select the type when opening "Add" — comes from the active tab */
	defaultType?: CategoryType;
}

export function CategoryDrawer({ userId, defaultType = "Expense" }: CategoryDrawerProps) {
	const { isCategoryDrawerOpen, editCategoryId, closeCategoryDrawer } = useUIStore();
	const { activeCurrency } = useFilterStore();
	const config = useDbConfig(userId);
	const allCategories = useCategories(userId);
	const enabledCurrencies =
		config?.enabledCurrencies && config.enabledCurrencies.length > 0
			? config.enabledCurrencies
			: config?.currency
				? [config.currency]
				: [];
	const defaultCurrency =
		activeCurrency && enabledCurrencies.includes(activeCurrency) ? activeCurrency : undefined;

	const {
		register,
		handleSubmit,
		reset,
		watch,
		setValue,
		setError,
		formState: { errors, isSubmitting },
	} = useForm<CategoryFormValues>({
		resolver: zodResolver(categorySchema),
		defaultValues: { type: defaultType },
	});

	const watchedType = watch("type") as CategoryType | undefined;
	const rawWatchedCurrency = watch("currency")?.trim();
	const watchedCurrency = rawWatchedCurrency === "" ? undefined : rawWatchedCurrency;
	const watchedParentId = watch("parentId");
	const selectedColor = watch("color");

	function isParentCurrencyCompatible(parent: Category, currency: string | undefined) {
		if (!currency) return !parent.currency;
		return !parent.currency || parent.currency === currency;
	}

	function formatCurrency(code: string) {
		const entry = getCurrencyByCode(code);
		return `${entry?.flag ?? "🌐"} ${code}`;
	}

	function normalizeCurrency(value: string | undefined) {
		const currency = value?.trim();
		return currency === "" ? undefined : currency;
	}

	const compatibleParentOptions = (allCategories ?? []).filter(
		(c) =>
			c.type === watchedType &&
			!c.parentId &&
			c.id !== editCategoryId &&
			isParentCurrencyCompatible(c, watchedCurrency)
	);
	const parentOptions = includeRecordsById(compatibleParentOptions, allCategories ?? [], [
		watchedParentId,
	]).filter((c) => c.id !== editCategoryId);
	const selectedParent = watchedParentId
		? (allCategories ?? []).find((c) => c.id === watchedParentId)
		: undefined;
	const parentCompatibilityError =
		selectedParent &&
		(selectedParent.type !== watchedType ||
			selectedParent.parentId ||
			selectedParent.id === editCategoryId ||
			!isParentCurrencyCompatible(selectedParent, watchedCurrency))
			? "This parent is not compatible with the selected type or currency. Choose a compatible parent or None before saving."
			: undefined;
	const currencyOptions =
		watchedCurrency && !enabledCurrencies.includes(watchedCurrency)
			? [watchedCurrency, ...enabledCurrencies]
			: enabledCurrencies;

	// Load category for editing
	useEffect(() => {
		if (!isCategoryDrawerOpen) {
			reset({ type: defaultType, currency: defaultCurrency });
			return;
		}
		if (!editCategoryId) {
			reset({ type: defaultType, currency: defaultCurrency });
			return;
		}

		void db.categories.get(editCategoryId).then((cat: Category | undefined) => {
			if (!cat) return;
			reset({
				title: cat.title,
				type: cat.type,
				parentId: cat.parentId,
				currency: normalizeCurrency(cat.currency),
				color: cat.color,
				icon: cat.icon,
			});
		});
	}, [isCategoryDrawerOpen, editCategoryId, defaultType, defaultCurrency, reset]);

	async function onSubmit(values: CategoryFormValues) {
		const now = Date.now();
		const currency = normalizeCurrency(values.currency);
		const submittedParent = values.parentId
			? allCategories?.find((c) => c.id === values.parentId)
			: undefined;
		if (values.parentId && !submittedParent) {
			const message = "Selected parent category was not found.";
			setError("parentId", { type: "validate", message });
			toast.error(message);
			return;
		}
		if (
			submittedParent &&
			(submittedParent.type !== values.type ||
				submittedParent.parentId ||
				submittedParent.id === editCategoryId ||
				!isParentCurrencyCompatible(submittedParent, currency))
		) {
			const message =
				"This parent is not compatible with the selected type or currency. Choose a compatible parent or None before saving.";
			setError("parentId", { type: "validate", message });
			toast.error(message);
			return;
		}
		const parentId = submittedParent?.id;

		if (editCategoryId) {
			const existing = await db.categories.get(editCategoryId);
			if (!existing) {
				toast.error("Category not found");
				return;
			}
			const nextCategory: Category = {
				...existing,
				title: values.title,
				type: values.type,
				parentId,
				color: values.color,
				icon: values.icon,
				updatedAt: now,
			};
			if (currency) {
				nextCategory.currency = currency;
			} else {
				delete nextCategory.currency;
			}
			await db.categories.put(nextCategory);
			toast.success("Category updated");
		} else {
			const nextCategory: Category = {
				id: uuidv4(),
				userId,
				updatedAt: now,
				title: values.title,
				type: values.type,
				parentId,
				color: values.color,
				icon: values.icon,
			};
			if (currency) nextCategory.currency = currency;
			await db.categories.put(nextCategory);
			toast.success("Category created");
		}
		closeCategoryDrawer();
	}

	return (
		<Drawer open={isCategoryDrawerOpen} onOpenChange={(open) => !open && closeCategoryDrawer()}>
			<DrawerContent className={FORM_DRAWER_CONTENT_CLASS}>
				<DrawerHeader className="shrink-0 border-b border-border/60 px-4 pb-3 text-left">
					<div className="flex items-start justify-between gap-3">
						<div>
							<DrawerTitle>{editCategoryId ? "Edit Category" : "Add Category"}</DrawerTitle>
							<DrawerDescription className="sr-only">
								Create or edit a transaction category.
							</DrawerDescription>
						</div>
						<DrawerClose asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label="Close category drawer"
								onClick={closeCategoryDrawer}>
								<span aria-hidden="true" className="text-xl leading-none">
									×
								</span>
							</Button>
						</DrawerClose>
					</div>
				</DrawerHeader>

				<form
					id={CATEGORY_FORM_ID}
					onSubmit={(e) => {
						void handleSubmit(onSubmit)(e);
					}}
					className="flex min-h-0 flex-1 flex-col">
					<div
						className="min-h-0 flex-1 scroll-pb-[calc(8rem_+_var(--keyboard-inset,0px))] space-y-4 overflow-y-auto overscroll-contain px-4 py-4"
						onFocusCapture={(event) => scrollFocusedFieldIntoView(event.target)}>
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

						{/* Currency */}
						<div className="space-y-1.5">
							<Label>Currency</Label>
							<Select
								value={watchedCurrency ?? SHARED_CURRENCY_VALUE}
								onValueChange={(v) => {
									setValue("currency", v === SHARED_CURRENCY_VALUE ? undefined : v, {
										shouldValidate: true,
									});
								}}>
								<SelectTrigger className="h-11 w-full">
									<SelectValue placeholder="All currencies (shared)" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={SHARED_CURRENCY_VALUE}>🌐 All currencies (shared)</SelectItem>
									{currencyOptions.map((code) => (
										<SelectItem key={code} value={code}>
											{formatCurrency(code)}
											{!enabledCurrencies.includes(code) ? " · currently disabled" : ""}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								Shared categories appear for every currency.
							</p>
							{errors.currency && (
								<p className="text-xs text-destructive">{errors.currency.message}</p>
							)}
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
												{c.currency ? ` · ${formatCurrency(c.currency)}` : ""}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{errors.parentId && (
									<p className="text-xs text-destructive">{errors.parentId.message}</p>
								)}
								{parentCompatibilityError && (
									<p className="text-xs text-destructive">{parentCompatibilityError}</p>
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
					</div>

					<DrawerFooter className="pb-safe shrink-0 border-t border-border/60 bg-popover/95 px-4 pt-3 [padding-bottom:calc(env(safe-area-inset-bottom,0px)_+_var(--keyboard-inset,0px)_+_0.75rem)] supports-backdrop-filter:backdrop-blur">
						<Button
							type="submit"
							form={CATEGORY_FORM_ID}
							disabled={isSubmitting}
							className="w-full">
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
