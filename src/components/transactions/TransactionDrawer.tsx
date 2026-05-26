"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";
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
import { useActiveAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { db } from "@/lib/db/local";
import { transactionSchema, type TransactionFormValues } from "@/lib/validations/transaction";
import { useUIStore } from "@/store/ui-store";

import type { Transaction, TransactionType } from "@/types";

const TYPE_TABS: TransactionType[] = ["Expense", "Income", "Transfer"];

const TYPE_COLOR: Record<TransactionType, string> = {
	Expense: "border-red-500 bg-red-500 text-white",
	Income: "border-emerald-500 bg-emerald-500 text-white",
	Transfer: "border-blue-500 bg-blue-500 text-white",
};

const TYPE_INACTIVE = "border-border hover:border-primary";

interface TransactionDrawerProps {
	userId: string;
}

export function TransactionDrawer({ userId }: TransactionDrawerProps) {
	const { isTransactionDrawerOpen, editTransactionId, closeTransactionDrawer } = useUIStore();
	const accounts = useActiveAccounts(userId);
	const allCategories = useCategories(userId);
	const [showTravel, setShowTravel] = useState(false);
	const [confirming, setConfirming] = useState(false);

	const {
		register,
		handleSubmit,
		reset,
		watch,
		setValue,
		formState: { errors, isSubmitting },
	} = useForm<TransactionFormValues>({
		resolver: zodResolver(transactionSchema) as Resolver<TransactionFormValues>,
		defaultValues: {
			type: "Expense",
			date: new Date(),
			amount: undefined,
		},
	});

	const watchedType = watch("type") as TransactionType;
	const watchedAccount = watch("accountId");

	const categories = (allCategories ?? []).filter((c) => {
		if (watchedType === "Expense") return c.type === "Expense";
		if (watchedType === "Income") return c.type === "Income";
		return false;
	});

	const destAccounts = (accounts ?? []).filter((a) => a.id !== watchedAccount);

	// Load existing transaction for editing
	useEffect(() => {
		if (!isTransactionDrawerOpen) {
			reset({ type: "Expense", date: new Date(), amount: undefined });
			setShowTravel(false);
			setConfirming(false);
			return;
		}
		if (!editTransactionId) return;

		void db.transactions.get(editTransactionId).then((txn: Transaction | undefined) => {
			if (!txn) return;
			reset({
				type: txn.type,
				amount: txn.amount,
				date: new Date(txn.date),
				accountId: txn.accountId,
				categoryId: txn.categoryId,
				toAccountId: txn.toAccountId,
				description: txn.description,
				place: txn.place,
				tags: txn.tags,
				travelCurrency: txn.travelCurrency,
			});
			if (txn.travelCurrency) setShowTravel(true);
		});
	}, [isTransactionDrawerOpen, editTransactionId, reset]);

	async function onSubmit(values: TransactionFormValues) {
		const now = Date.now();
		const payload = {
			...values,
			userId,
			date: values.date instanceof Date ? values.date.getTime() : Number(values.date),
			updatedAt: now,
			// Clear Transfer-specific fields for non-transfer
			toAccountId: values.type === "Transfer" ? values.toAccountId : undefined,
			categoryId: values.type === "Transfer" ? undefined : values.categoryId,
		};

		if (editTransactionId) {
			await db.transactions.update(editTransactionId, payload);
			toast.success("Transaction updated");
		} else {
			await db.transactions.put({ id: uuidv4(), ...payload });
			toast.success("Transaction recorded");
		}
		closeTransactionDrawer();
	}

	async function handleDelete() {
		if (!editTransactionId) return;
		if (!confirming) {
			setConfirming(true);
			setTimeout(() => setConfirming(false), 3000);
			return;
		}
		await db.transactions.update(editTransactionId, {
			deletedAt: Date.now(),
			updatedAt: Date.now(),
		});
		toast.success("Transaction deleted");
		closeTransactionDrawer();
	}

	const todayStr = format(new Date(), "yyyy-MM-dd");
	const watchedDate = watch("date");
	const dateStr =
		watchedDate instanceof Date
			? format(watchedDate, "yyyy-MM-dd")
			: typeof watchedDate === "string"
				? watchedDate
				: todayStr;

	return (
		<Drawer
			open={isTransactionDrawerOpen}
			onOpenChange={(open) => !open && closeTransactionDrawer()}>
			<DrawerContent className="max-h-[92dvh]">
				<DrawerHeader>
					<DrawerTitle>{editTransactionId ? "Edit Transaction" : "New Transaction"}</DrawerTitle>
				</DrawerHeader>

				<div className="overflow-y-auto px-4 pb-2">
					<form
						onSubmit={(e) => {
							void handleSubmit(onSubmit)(e);
						}}
						className="space-y-4">
						{/* Type tabs */}
						<div className="flex gap-2">
							{TYPE_TABS.map((t) => (
								<button
									key={t}
									type="button"
									onClick={() => {
										setValue("type", t, { shouldValidate: true });
										setValue("categoryId", undefined);
										setValue("toAccountId", undefined);
									}}
									className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors ${
										watchedType === t ? TYPE_COLOR[t] : TYPE_INACTIVE
									}`}>
									{t}
								</button>
							))}
						</div>

						{/* Amount */}
						<div className="space-y-1.5">
							<Label htmlFor="txn-amount">Amount *</Label>
							<Input
								id="txn-amount"
								type="number"
								step="0.01"
								min="0.01"
								placeholder="0.00"
								autoFocus
								{...register("amount")}
							/>
							{errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
						</div>

						{/* Date */}
						<div className="space-y-1.5">
							<Label htmlFor="txn-date">Date *</Label>
							<Input
								id="txn-date"
								type="date"
								max={todayStr}
								value={dateStr}
								onChange={(e) =>
									setValue("date", new Date(e.target.value), { shouldValidate: true })
								}
							/>
							{errors.date && (
								<p className="text-xs text-destructive">{errors.date.message as string}</p>
							)}
						</div>

						{/* From Account */}
						<div className="space-y-1.5">
							<Label>{watchedType === "Transfer" ? "From Account *" : "Account *"}</Label>
							<Select
								value={watch("accountId") ?? ""}
								onValueChange={(v) => setValue("accountId", v, { shouldValidate: true })}>
								<SelectTrigger>
									<SelectValue placeholder="Select account" />
								</SelectTrigger>
								<SelectContent>
									{(accounts ?? []).map((a) => (
										<SelectItem key={a.id} value={a.id}>
											{a.icon} {a.title} ({a.currency})
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							{errors.accountId && (
								<p className="text-xs text-destructive">{errors.accountId.message}</p>
							)}
						</div>

						{/* To Account (Transfer) */}
						{watchedType === "Transfer" && (
							<div className="space-y-1.5">
								<Label>To Account *</Label>
								<Select
									value={watch("toAccountId") ?? ""}
									onValueChange={(v) => setValue("toAccountId", v, { shouldValidate: true })}>
									<SelectTrigger>
										<SelectValue placeholder="Select destination" />
									</SelectTrigger>
									<SelectContent>
										{destAccounts.map((a) => (
											<SelectItem key={a.id} value={a.id}>
												{a.icon} {a.title} ({a.currency})
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{errors.toAccountId && (
									<p className="text-xs text-destructive">{errors.toAccountId.message}</p>
								)}
							</div>
						)}

						{/* Category (Expense / Income only) */}
						{watchedType !== "Transfer" && (
							<div className="space-y-1.5">
								<Label>Category</Label>
								<Select
									value={watch("categoryId") ?? "none"}
									onValueChange={(v) =>
										setValue("categoryId", v === "none" ? undefined : v, {
											shouldValidate: true,
										})
									}>
									<SelectTrigger>
										<SelectValue placeholder="Select category" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="none">Uncategorized</SelectItem>
										{categories.map((c) => (
											<SelectItem key={c.id} value={c.id}>
												{c.icon} {c.title}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}

						{/* Description */}
						<div className="space-y-1.5">
							<Label htmlFor="txn-desc">Description</Label>
							<Input
								id="txn-desc"
								placeholder="e.g. Lunch at the office"
								{...register("description")}
							/>
						</div>

						{/* Place */}
						<div className="space-y-1.5">
							<Label htmlFor="txn-place">Place</Label>
							<Input id="txn-place" placeholder="e.g. Carrefour" {...register("place")} />
						</div>

						{/* Travel Currency toggle */}
						<button
							type="button"
							onClick={() => setShowTravel((v) => !v)}
							className="flex w-full items-center justify-between text-sm text-muted-foreground hover:text-foreground">
							<span>Travel Currency (optional)</span>
							<ChevronDown
								className={`h-4 w-4 transition-transform ${showTravel ? "rotate-180" : ""}`}
							/>
						</button>

						{showTravel && (
							<div className="space-y-3 rounded-lg border border-border p-3">
								<div className="grid grid-cols-2 gap-2">
									<div className="space-y-1">
										<Label htmlFor="tc-symbol" className="text-xs">
											Symbol
										</Label>
										<Input
											id="tc-symbol"
											placeholder="USD"
											className="h-8 text-xs"
											{...register("travelCurrency.symbol")}
										/>
									</div>
									<div className="space-y-1">
										<Label htmlFor="tc-rate" className="text-xs">
											Rate
										</Label>
										<Input
											id="tc-rate"
											type="number"
											step="0.0001"
											placeholder="3.67"
											className="h-8 text-xs"
											{...register("travelCurrency.rate")}
										/>
									</div>
									<div className="space-y-1">
										<Label htmlFor="tc-amount" className="text-xs">
											Local Amount
										</Label>
										<Input
											id="tc-amount"
											type="number"
											step="0.01"
											placeholder="100"
											className="h-8 text-xs"
											{...register("travelCurrency.amount")}
										/>
									</div>
									<div className="space-y-1">
										<Label htmlFor="tc-location" className="text-xs">
											Location
										</Label>
										<Input
											id="tc-location"
											placeholder="Dubai"
											className="h-8 text-xs"
											{...register("travelCurrency.location")}
										/>
									</div>
								</div>
							</div>
						)}

						<DrawerFooter className="px-0 pb-0">
							{editTransactionId && (
								<Button
									variant="destructive"
									type="button"
									className="w-full"
									onClick={() => {
										void handleDelete();
									}}>
									{confirming ? "Tap again to confirm delete" : "Delete Transaction"}
								</Button>
							)}
							<Button type="submit" disabled={isSubmitting} className="w-full">
								{isSubmitting ? "Saving…" : editTransactionId ? "Save Changes" : "Record"}
							</Button>
							<DrawerClose asChild>
								<Button
									variant="outline"
									type="button"
									className="w-full"
									onClick={closeTransactionDrawer}>
									Cancel
								</Button>
							</DrawerClose>
						</DrawerFooter>
					</form>
				</div>
			</DrawerContent>
		</Drawer>
	);
}
