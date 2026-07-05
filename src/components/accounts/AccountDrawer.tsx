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
import { useDbConfig } from "@/hooks/useDbConfig";
import { getCurrencyByCode } from "@/lib/currencies";
import { db } from "@/lib/db/local";
import { accountSchema, type AccountFormValues } from "@/lib/validations/account";
import { useFilterStore } from "@/store/filter-store";
import { useUIStore } from "@/store/ui-store";

import type { Account } from "@/types";

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
	const { activeCurrency } = useFilterStore();
	const config = useDbConfig(userId);

	// Use activeCurrency from top selector; fall back to saved config currency
	const defaultCurrency = activeCurrency || config?.currency || "PKR";
	// Show the user's enabled currencies as quick-select pills
	const currencyShortcuts = config?.enabledCurrencies?.length
		? config.enabledCurrencies
		: [defaultCurrency];

	const {
		register,
		handleSubmit,
		reset,
		watch,
		setValue,
		formState: { errors, isSubmitting },
	} = useForm<AccountFormValues>({
		resolver: zodResolver(accountSchema) as Resolver<AccountFormValues>,
		defaultValues: { currency: defaultCurrency, openingBalance: 0 },
	});

	// Load existing account for editing; for new accounts seed with active currency
	useEffect(() => {
		if (!isAccountDrawerOpen) {
			reset({ currency: defaultCurrency, openingBalance: 0 });
			return;
		}
		if (!editAccountId) {
			// New account — auto-select the active currency
			setValue("currency", defaultCurrency, { shouldValidate: false });
			return;
		}

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
	}, [isAccountDrawerOpen, editAccountId, reset, defaultCurrency, setValue]);

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
							{currencyShortcuts.map((c) => {
								const entry = getCurrencyByCode(c);
								return (
									<button
										key={c}
										type="button"
										onClick={() => setValue("currency", c, { shouldValidate: true })}
										className={`flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
											watch("currency") === c
												? "border-primary bg-primary text-primary-foreground"
												: "border-border hover:border-primary"
										}`}>
										{entry?.flag && <span>{entry.flag}</span>}
										{c}
									</button>
								);
							})}
						</div>
						<Input
							id="acc-currency"
							placeholder={defaultCurrency}
							maxLength={3}
							className="uppercase"
							hidden
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
