"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";

import { Button } from "@/components/ui/button";
import {
	Drawer,
	DrawerContent,
	DrawerHeader,
	DrawerTitle,
	DrawerFooter,
	DrawerClose,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { db } from "@/lib/db/local";
import { accountSchema, type AccountFormValues } from "@/lib/validations/account";
import { useUIStore } from "@/store/ui-store";

import type { Account } from "@/types";

const CURRENCY_SHORTCUTS = ["AED", "PKR", "USD", "EUR", "GBP", "SAR", "INR"];

const COLOR_SWATCHES = [
	"#6366f1", // indigo
	"#8b5cf6", // violet
	"#ec4899", // pink
	"#f97316", // orange
	"#22c55e", // green
	"#14b8a6", // teal
	"#3b82f6", // blue
	"#eab308", // yellow
];

interface AccountDrawerProps {
	userId: string;
}

export function AccountDrawer({ userId }: AccountDrawerProps) {
	const { isAccountDrawerOpen, editAccountId, closeAccountDrawer } = useUIStore();

	const {
		register,
		handleSubmit,
		reset,
		watch,
		setValue,
		formState: { errors, isSubmitting },
	} = useForm<AccountFormValues>({
		resolver: zodResolver(accountSchema) as Resolver<AccountFormValues>,
		defaultValues: { currency: "PKR", openingBalance: 0 },
	});

	// Load existing account for editing
	useEffect(() => {
		if (!isAccountDrawerOpen) {
			reset({ currency: "PKR", openingBalance: 0 });
			return;
		}
		if (!editAccountId) return;

		void db.accounts.get(editAccountId).then((account: Account | undefined) => {
			if (!account) return;
			reset({
				title: account.title,
				currency: account.currency,
				openingBalance: account.openingBalance,
				color: account.color,
				icon: account.icon,
			});
		});
	}, [isAccountDrawerOpen, editAccountId, reset]);

	async function onSubmit(values: AccountFormValues) {
		const now = Date.now();
		if (editAccountId) {
			await db.accounts.update(editAccountId, { ...values, updatedAt: now });
			toast.success("Account updated");
		} else {
			await db.accounts.put({
				id: uuidv4(),
				userId,
				isArchived: false,
				updatedAt: now,
				...values,
			});
			toast.success("Account created");
		}
		closeAccountDrawer();
	}

	const selectedColor = watch("color");

	return (
		<Drawer open={isAccountDrawerOpen} onOpenChange={(open) => !open && closeAccountDrawer()}>
			<DrawerContent>
				<DrawerHeader>
					<DrawerTitle>{editAccountId ? "Edit Account" : "Add Account"}</DrawerTitle>
				</DrawerHeader>

				<form
					onSubmit={(e) => {
						void handleSubmit(onSubmit)(e);
					}}
					className="space-y-4 px-4 pb-2">
					{/* Title */}
					<div className="space-y-1.5">
						<Label htmlFor="acc-title">Title *</Label>
						<Input id="acc-title" placeholder="e.g. FAB Current Account" {...register("title")} />
						{errors.title && <p className="text-xs text-destructive">{errors.title.message}</p>}
					</div>

					{/* Currency */}
					<div className="space-y-1.5">
						<Label htmlFor="acc-currency">Currency *</Label>
						<div className="mb-1 flex flex-wrap gap-1.5">
							{CURRENCY_SHORTCUTS.map((c) => (
								<button
									key={c}
									type="button"
									onClick={() => setValue("currency", c, { shouldValidate: true })}
									className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
										watch("currency") === c
											? "border-primary bg-primary text-primary-foreground"
											: "border-border hover:border-primary"
									}`}>
									{c}
								</button>
							))}
						</div>
						<Input
							id="acc-currency"
							placeholder="PKR"
							maxLength={3}
							className="uppercase"
							{...register("currency")}
						/>
						{errors.currency && (
							<p className="text-xs text-destructive">{errors.currency.message}</p>
						)}
					</div>

					{/* Opening Balance */}
					<div className="space-y-1.5">
						<Label htmlFor="acc-balance">Opening Balance</Label>
						<Input
							id="acc-balance"
							type="number"
							step="0.01"
							placeholder="0.00"
							{...register("openingBalance")}
						/>
						{errors.openingBalance && (
							<p className="text-xs text-destructive">{errors.openingBalance.message}</p>
						)}
					</div>

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
						<Label htmlFor="acc-icon">Icon (emoji)</Label>
						<Input id="acc-icon" placeholder="🏦" maxLength={2} {...register("icon")} />
					</div>

					<DrawerFooter className="px-0">
						<Button type="submit" disabled={isSubmitting} className="w-full">
							{isSubmitting ? "Saving…" : editAccountId ? "Save Changes" : "Add Account"}
						</Button>
						<DrawerClose asChild>
							<Button
								variant="outline"
								type="button"
								className="w-full"
								onClick={closeAccountDrawer}>
								Cancel
							</Button>
						</DrawerClose>
					</DrawerFooter>
				</form>
			</DrawerContent>
		</Drawer>
	);
}
