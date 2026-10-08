"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm, type FieldErrors, type Resolver, type SubmitErrorHandler } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

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
import { createBudget, updateBudget, type BudgetFormValues } from "@/hooks/useBudgets";
import { scrollFocusedFieldIntoView } from "@/hooks/useKeyboardInset";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { cn } from "@/lib/utils";

import type { Budget, Category } from "@/types";

const BUDGET_FORM_ID = "budget-drawer-form";
const FORM_DRAWER_CONTENT_CLASS =
	"overflow-hidden pb-0 data-[vaul-drawer-direction=bottom]:h-[calc(100dvh_-_env(safe-area-inset-top,0px)_-_1rem)] data-[vaul-drawer-direction=bottom]:max-h-[95dvh] data-[vaul-drawer-direction=bottom]:pb-0";
const FORM_DRAWER_CLOSE_THRESHOLD = 0.55;

const budgetSchema = z.object({
	categoryId: z.string().min(1, "Choose an expense category."),
	amount: z.coerce
		.number({ error: "Enter a monthly budget amount." })
		.finite("Enter a monthly budget amount.")
		.positive("Budget amount must be greater than zero."),
});

type BudgetDrawerValues = z.infer<typeof budgetSchema>;

interface BudgetDrawerProps {
	userId: string;
	open: boolean;
	period: string;
	currency: string;
	categories: Category[];
	budget?: Budget | null;
	onOpenChange: (open: boolean) => void;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	return "Something went wrong. Please try again.";
}

function getFirstErrorMessage(fieldErrors: FieldErrors<BudgetDrawerValues>): string | null {
	for (const value of Object.values(fieldErrors) as unknown[]) {
		if (!value) continue;
		if (
			typeof value === "object" &&
			"message" in value &&
			typeof (value as { message?: unknown }).message === "string"
		) {
			return (value as { message: string }).message;
		}
		if (typeof value === "object") {
			const nested = getFirstErrorMessage(value as FieldErrors<BudgetDrawerValues>);
			if (nested) return nested;
		}
	}
	return null;
}

export function BudgetDrawer({
	userId,
	open,
	period,
	currency,
	categories,
	budget,
	onOpenChange,
}: BudgetDrawerProps) {
	const [saving, setSaving] = useState(false);
	const {
		register,
		handleSubmit,
		reset,
		formState: { errors, isSubmitting },
	} = useForm<BudgetDrawerValues>({
		resolver: zodResolver(budgetSchema) as Resolver<BudgetDrawerValues>,
		defaultValues: {
			categoryId: "",
			amount: "" as unknown as number,
		},
	});

	useEffect(() => {
		if (!open) {
			setSaving(false);
			reset({
				categoryId: "",
				amount: "" as unknown as number,
			});
			return;
		}

		reset({
			categoryId: budget?.categoryId ?? categories[0]?.id ?? "",
			amount: budget?.amount ?? ("" as unknown as number),
		});
	}, [budget, categories, open, reset]);

	async function onSubmit(values: BudgetDrawerValues) {
		const payload: BudgetFormValues = {
			categoryId: values.categoryId,
			amount: values.amount,
			period,
			currency,
		};

		setSaving(true);
		try {
			if (budget) {
				await updateBudget(userId, budget.id, payload);
				toast.success("Budget updated");
			} else {
				await createBudget(userId, payload);
				toast.success("Budget created");
			}
			onOpenChange(false);
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			setSaving(false);
		}
	}

	const onInvalid: SubmitErrorHandler<BudgetDrawerValues> = (formErrors) => {
		toast.error(getFirstErrorMessage(formErrors) ?? "Please check the highlighted fields.");
	};

	return (
		<Drawer
			open={open}
			handleOnly
			closeThreshold={FORM_DRAWER_CLOSE_THRESHOLD}
			onOpenChange={onOpenChange}>
			<DrawerContent className={FORM_DRAWER_CONTENT_CLASS}>
				<DrawerHeader className="shrink-0 border-b border-border/60 px-4 pb-3 text-left">
					<div className="flex items-start justify-between gap-3">
						<div>
							<DrawerTitle>{budget ? "Edit Budget" : "New Budget"}</DrawerTitle>
							<DrawerDescription className="sr-only">
								Create or edit a monthly category budget.
							</DrawerDescription>
						</div>
						<DrawerClose asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label="Close budget drawer"
								onClick={() => onOpenChange(false)}>
								<span aria-hidden="true" className="text-xl leading-none">
									×
								</span>
							</Button>
						</DrawerClose>
					</div>
				</DrawerHeader>

				<form
					id={BUDGET_FORM_ID}
					onSubmit={(event) => {
						void handleSubmit(
							onSubmit,
							onInvalid
						)(event).catch((error) => {
							setSaving(false);
							toast.error(errorMessage(error));
						});
					}}
					className="flex min-h-0 flex-1 flex-col">
					<div
						data-keyboard-scroll-container="true"
						className="min-h-0 flex-1 scroll-pb-[calc(8rem_+_var(--keyboard-inset,0px))] space-y-4 overflow-y-auto overscroll-contain px-4 py-4"
						onFocusCapture={(event) => scrollFocusedFieldIntoView(event.target)}>
						<div className="rounded-2xl border border-border/70 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
							{period} • {currency}
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="budget-category">Category *</Label>
							<select
								id="budget-category"
								className={cn(
									"tappable flex min-h-11 w-full rounded-xl border border-input bg-background/80 px-3 py-2 text-sm shadow-xs transition-all outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
									errors.categoryId && "border-destructive ring-3 ring-destructive/20"
								)}
								disabled={categories.length === 0}
								{...register("categoryId")}>
								<option value="">
									{categories.length === 0
										? "No expense categories for this currency"
										: "Select category"}
								</option>
								{categories.map((category) => (
									<option key={category.id} value={category.id}>
										{getCategoryIcon(category)} {category.title}
									</option>
								))}
							</select>
							{errors.categoryId && (
								<p className="text-xs text-destructive">{errors.categoryId.message}</p>
							)}
						</div>

						<div className="space-y-1.5">
							<Label htmlFor="budget-amount">Monthly amount *</Label>
							<Input
								id="budget-amount"
								type="number"
								step="0.01"
								min="0"
								inputMode="decimal"
								placeholder="0.00"
								aria-invalid={Boolean(errors.amount)}
								{...register("amount")}
							/>
							{errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
						</div>
					</div>

					<DrawerFooter className="pb-safe shrink-0 border-t border-border/60 bg-popover/95 px-4 pt-3 [padding-bottom:calc(env(safe-area-inset-bottom,0px)_+_var(--keyboard-inset,0px)_+_0.75rem)] supports-backdrop-filter:backdrop-blur">
						<Button
							type="submit"
							form={BUDGET_FORM_ID}
							disabled={saving || isSubmitting || categories.length === 0}
							className="w-full">
							{saving || isSubmitting ? "Saving…" : budget ? "Save Changes" : "Create Budget"}
						</Button>
						<DrawerClose asChild>
							<Button
								variant="outline"
								type="button"
								className="w-full"
								onClick={() => onOpenChange(false)}>
								Cancel
							</Button>
						</DrawerClose>
					</DrawerFooter>
				</form>
			</DrawerContent>
		</Drawer>
	);
}
