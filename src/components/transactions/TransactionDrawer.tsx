"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarIcon, ChevronDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useForm, type FieldErrors, type Resolver, type SubmitErrorHandler } from "react-hook-form";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useActiveAccounts } from "@/hooks/useAccounts";
import { useCategories } from "@/hooks/useCategories";
import { scrollFocusedFieldIntoView } from "@/hooks/useKeyboardInset";
import {
	createTransaction,
	deleteTransaction,
	updateTransaction,
} from "@/lib/actions/transactions";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { getCurrencyDisplay } from "@/lib/currencySymbols";
import { db } from "@/lib/db/local";
import {
	EMPTY_TRANSACTION_USAGE_RANKING,
	loadRecentTransactionUsageRanking,
	sortRecordsByUsage,
	type UsageCounts,
} from "@/lib/usageRanking";
import { transactionSchema, type TransactionFormValues } from "@/lib/validations/transaction";
import { useFilterStore } from "@/store/filter-store";
import { useUIStore } from "@/store/ui-store";

import type { Account, Category, Transaction, TransactionType } from "@/types";

const TYPE_TABS: TransactionType[] = ["Expense", "Income", "Transfer"];

const TYPE_COLOR: Record<TransactionType, string> = {
	Expense: "border-red-500 bg-red-500 text-white",
	Income: "border-emerald-500 bg-emerald-500 text-white",
	Transfer: "border-blue-500 bg-blue-500 text-white",
};

const TYPE_INACTIVE = "border-border hover:border-primary";
const TRANSACTION_FORM_ID = "transaction-drawer-form";
const FORM_DRAWER_CONTENT_CLASS =
	"overflow-hidden pb-0 data-[vaul-drawer-direction=bottom]:h-[calc(100dvh_-_env(safe-area-inset-top,0px)_-_1rem)] data-[vaul-drawer-direction=bottom]:max-h-[95dvh] data-[vaul-drawer-direction=bottom]:pb-0";
const FORM_DRAWER_CLOSE_THRESHOLD = 0.55;
type NewTransactionDefaults = Partial<TransactionFormValues> & {
	amount: TransactionFormValues["amount"];
	date: Date;
	description: string;
	type: "Expense";
};

function getCurrencyLabel(currency?: string): ReactNode {
	if (!currency) return null;
	const { code, symbol, hasSymbol } = getCurrencyDisplay(currency);
	if (!hasSymbol) return code;

	return (
		<span className="inline-flex items-baseline gap-1 [unicode-bidi:isolate]" dir="ltr">
			<span aria-hidden="true" className="inline-block">
				{symbol}
			</span>
			<span>{code}</span>
		</span>
	);
}

export function includeRecordsById<T extends { id: string }>(
	records: T[],
	extraRecords: T[],
	ids: Array<string | undefined>
): T[] {
	const wantedIds = new Set(ids.filter((id): id is string => Boolean(id)));
	const seenIds = new Set<string>();
	const merged: T[] = [];

	for (const record of records) {
		if (!seenIds.has(record.id)) {
			merged.push(record);
			seenIds.add(record.id);
		}
	}

	for (const record of extraRecords) {
		if (wantedIds.has(record.id) && !seenIds.has(record.id)) {
			merged.push(record);
			seenIds.add(record.id);
		}
	}

	return merged;
}

export function getTransactionAccountOptions(
	accounts: Account[],
	editAccounts: Account[],
	currency: string | undefined,
	selectedAccountId: string | undefined,
	usageCounts?: UsageCounts
): Account[] {
	const currencyAccounts = currency
		? accounts.filter((account) => account.currency === currency)
		: accounts;
	const sortedCurrencyAccounts = usageCounts
		? sortRecordsByUsage(currencyAccounts, usageCounts)
		: currencyAccounts;

	return includeRecordsById(sortedCurrencyAccounts, editAccounts, [selectedAccountId]);
}

export function getTransferDestinationAccounts(
	accounts: Account[],
	editAccounts: Account[],
	sourceAccountId: string | undefined,
	selectedDestinationAccountId: string | undefined,
	usageCounts?: UsageCounts
): Account[] {
	const allKnownAccounts = includeRecordsById(accounts, editAccounts, [
		sourceAccountId,
		selectedDestinationAccountId,
	]);
	const sourceAccount = allKnownAccounts.find((account) => account.id === sourceAccountId);
	const sameCurrencyAccounts = sourceAccount
		? allKnownAccounts.filter(
				(account) => account.id !== sourceAccount.id && account.currency === sourceAccount.currency
			)
		: [];
	const sortedSameCurrencyAccounts = usageCounts
		? sortRecordsByUsage(sameCurrencyAccounts, usageCounts)
		: sameCurrencyAccounts;

	return includeRecordsById(sortedSameCurrencyAccounts, editAccounts, [
		selectedDestinationAccountId,
	]).filter((account) => account.id !== sourceAccountId);
}

export function getTransactionCategoryOptions(
	categories: Category[],
	editCategory: Category | null,
	selectedCategoryId: string | undefined,
	transactionType: TransactionType,
	usageCounts?: UsageCounts
): Category[] {
	const typeCategories = categories.filter((category) => {
		if (transactionType === "Expense") return category.type === "Expense";
		if (transactionType === "Income") return category.type === "Income";
		return false;
	});
	const sortedTypeCategories = usageCounts
		? sortRecordsByUsage(typeCategories, usageCounts)
		: typeCategories;

	return includeRecordsById(sortedTypeCategories, editCategory ? [editCategory] : [], [
		selectedCategoryId,
	]);
}

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	return "Something went wrong. Please try again.";
}

function getNewTransactionDefaults(
	previous?: Partial<TransactionFormValues>
): NewTransactionDefaults {
	return {
		accountId: previous?.accountId,
		amount: "" as unknown as TransactionFormValues["amount"],
		categoryId: undefined,
		date: previous?.date instanceof Date ? previous.date : new Date(),
		description: "",
		place: undefined,
		tags: undefined,
		toAccountId: undefined,
		travelCurrency: undefined,
		type: "Expense",
	};
}

function getFirstErrorMessage(fieldErrors: FieldErrors<TransactionFormValues>): string | null {
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
			const nested = getFirstErrorMessage(value as FieldErrors<TransactionFormValues>);
			if (nested) return nested;
		}
	}
	return null;
}

interface TransactionDrawerProps {
	userId: string;
}

export function TransactionDrawer({ userId }: TransactionDrawerProps) {
	const { isTransactionDrawerOpen, editTransactionId, closeTransactionDrawer } = useUIStore();
	const { activeCurrency } = useFilterStore();
	const accounts = useActiveAccounts(userId);
	const allCategories = useCategories(userId, undefined, activeCurrency || undefined);
	const usageRanking = useLiveQuery(
		() => loadRecentTransactionUsageRanking(userId),
		[userId],
		EMPTY_TRANSACTION_USAGE_RANKING
	);
	const [editAccounts, setEditAccounts] = useState<Account[]>([]);
	const [editCategory, setEditCategory] = useState<Category | null>(null);
	const [showTravel, setShowTravel] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [datePickerOpen, setDatePickerOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const newTransactionDefaultsRef = useRef<NewTransactionDefaults | undefined>(undefined);

	const {
		register,
		handleSubmit,
		reset,
		watch,
		setValue,
		setError,
		formState: { errors, isSubmitting },
	} = useForm<TransactionFormValues>({
		resolver: zodResolver(transactionSchema) as Resolver<TransactionFormValues>,
		defaultValues: {
			type: "Expense",
			date: new Date(),
			amount: "" as unknown as TransactionFormValues["amount"],
			description: "",
		},
	});

	const watchedType = watch("type") as TransactionType;
	const watchedAccount = watch("accountId");
	const watchedToAccount = watch("toAccountId");
	const watchedCategory = watch("categoryId");
	const watchedDate = watch("date");
	const currency = activeCurrency || undefined;
	const baseAccounts = accounts ?? [];
	const accountOptions = useMemo(
		() =>
			getTransactionAccountOptions(
				baseAccounts,
				editAccounts,
				currency,
				watchedAccount,
				usageRanking.accountUsage
			),
		[baseAccounts, editAccounts, currency, watchedAccount, usageRanking.accountUsage]
	);
	const selectedAccount = accountOptions.find((account) => account.id === watchedAccount);
	const destAccounts = useMemo(
		() =>
			watchedType === "Transfer"
				? getTransferDestinationAccounts(
						baseAccounts,
						editAccounts,
						watchedAccount,
						watchedToAccount,
						usageRanking.accountUsage
					)
				: [],
		[
			baseAccounts,
			editAccounts,
			watchedAccount,
			watchedToAccount,
			watchedType,
			usageRanking.accountUsage,
		]
	);
	const selectedDestinationAccount = destAccounts.find(
		(account) => account.id === watchedToAccount
	);
	const crossCurrencyTransferWarning =
		watchedType === "Transfer" &&
		editTransactionId &&
		selectedAccount &&
		selectedDestinationAccount &&
		selectedAccount.currency !== selectedDestinationAccount.currency
			? `This existing transfer moves money between ${selectedAccount.currency} and ${selectedDestinationAccount.currency}. New transfers must use accounts in the same currency because MizanTrack does not apply FX conversion.`
			: undefined;
	const amountCurrencyLabel = getCurrencyLabel(selectedAccount?.currency ?? currency);

	const categories = useMemo(
		() =>
			getTransactionCategoryOptions(
				allCategories ?? [],
				editCategory,
				watchedCategory,
				watchedType,
				usageRanking.categoryUsage
			),
		[allCategories, editCategory, watchedCategory, watchedType, usageRanking.categoryUsage]
	);

	useEffect(() => {
		function handleBlocked() {
			toast.error("Storage upgrade is blocked. Close other MizanTrack tabs, then try again.");
		}

		function handleVersionChange() {
			toast.info("MizanTrack updated in another tab. Reload this app if saving does not resume.");
		}

		window.addEventListener("mizantrack-db-blocked", handleBlocked);
		window.addEventListener("mizantrack-db-versionchange", handleVersionChange);
		return () => {
			window.removeEventListener("mizantrack-db-blocked", handleBlocked);
			window.removeEventListener("mizantrack-db-versionchange", handleVersionChange);
		};
	}, []);

	// Load existing transaction for editing
	useEffect(() => {
		let cancelled = false;

		if (!isTransactionDrawerOpen) {
			reset(getNewTransactionDefaults(newTransactionDefaultsRef.current));
			setEditAccounts([]);
			setEditCategory(null);
			setShowTravel(false);
			setConfirming(false);
			setSaving(false);
			return;
		}
		if (!editTransactionId) {
			reset(getNewTransactionDefaults(newTransactionDefaultsRef.current));
			setEditAccounts([]);
			setEditCategory(null);
			setShowTravel(false);
			setConfirming(false);
			setSaving(false);
			return;
		}

		void db.transactions
			.get(editTransactionId)
			.then(async (txn: Transaction | undefined) => {
				if (!txn || cancelled) return;
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
				setShowTravel(Boolean(txn.travelCurrency));
				const [sourceAccount, toAccount, category] = await Promise.all([
					db.accounts.get(txn.accountId),
					txn.toAccountId ? db.accounts.get(txn.toAccountId) : undefined,
					txn.categoryId ? db.categories.get(txn.categoryId) : undefined,
				]);
				if (cancelled) return;
				setEditAccounts(
					[sourceAccount, toAccount].filter((account): account is Account => Boolean(account))
				);
				setEditCategory(category ?? null);
			})
			.catch((error) => {
				if (!cancelled) toast.error(`Could not load transaction: ${errorMessage(error)}`);
			});

		return () => {
			cancelled = true;
		};
	}, [isTransactionDrawerOpen, editTransactionId, reset]);

	async function onSubmit(values: TransactionFormValues) {
		if (values.type === "Transfer" && values.toAccountId) {
			const allKnownAccounts = includeRecordsById(baseAccounts, editAccounts, [
				values.accountId,
				values.toAccountId,
			]);
			const sourceAccount = allKnownAccounts.find((account) => account.id === values.accountId);
			const destinationAccount = allKnownAccounts.find(
				(account) => account.id === values.toAccountId
			);

			if (
				!editTransactionId &&
				sourceAccount &&
				destinationAccount &&
				sourceAccount.currency !== destinationAccount.currency
			) {
				const message = "Transfers must use accounts in the same currency.";
				setError("toAccountId", { type: "validate", message });
				toast.error(message);
				return;
			}
		}

		setSaving(true);
		try {
			if (editTransactionId) {
				await updateTransaction(userId, editTransactionId, values);
				toast.success("Transaction updated");
			} else {
				await createTransaction(userId, values);
				newTransactionDefaultsRef.current = getNewTransactionDefaults({
					accountId: values.accountId,
					date: values.date,
				});
				reset(newTransactionDefaultsRef.current);
				setEditAccounts([]);
				setEditCategory(null);
				setShowTravel(false);
				toast.success("Transaction recorded");
			}
			closeTransactionDrawer();
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			setSaving(false);
		}
	}

	const onInvalid: SubmitErrorHandler<TransactionFormValues> = (formErrors) => {
		toast.error(getFirstErrorMessage(formErrors) ?? "Please check the highlighted fields.");
	};

	async function handleDelete() {
		if (!editTransactionId) return;
		if (!confirming) {
			setConfirming(true);
			setTimeout(() => setConfirming(false), 3000);
			return;
		}
		setSaving(true);
		try {
			await deleteTransaction(userId, editTransactionId);
			toast.success("Transaction deleted");
			closeTransactionDrawer();
		} catch (error) {
			toast.error(errorMessage(error));
		} finally {
			setSaving(false);
		}
	}

	return (
		<Drawer
			open={isTransactionDrawerOpen}
			handleOnly
			closeThreshold={FORM_DRAWER_CLOSE_THRESHOLD}
			onOpenChange={(open) => !open && closeTransactionDrawer()}>
			<DrawerContent className={FORM_DRAWER_CONTENT_CLASS}>
				<DrawerHeader className="shrink-0 border-b border-border/60 px-4 pb-3 text-left">
					<div className="flex items-start justify-between gap-3">
						<div>
							<DrawerTitle>
								{editTransactionId ? "Edit Transaction" : "New Transaction"}
							</DrawerTitle>
							<DrawerDescription className="sr-only">
								Record an expense, income, or transfer transaction.
							</DrawerDescription>
						</div>
						<DrawerClose asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label="Close transaction drawer"
								onClick={closeTransactionDrawer}>
								<span aria-hidden="true" className="text-xl leading-none">
									×
								</span>
							</Button>
						</DrawerClose>
					</div>
				</DrawerHeader>

				<form
					id={TRANSACTION_FORM_ID}
					onSubmit={(e) => {
						void handleSubmit(
							onSubmit,
							onInvalid
						)(e).catch((error) => {
							setSaving(false);
							toast.error(errorMessage(error));
						});
					}}
					className="flex min-h-0 flex-1 flex-col">
					<div
						data-keyboard-scroll-container="true"
						className="min-h-0 flex-1 scroll-pb-[calc(8rem_+_var(--keyboard-inset,0px))] space-y-4 overflow-y-auto overscroll-contain px-4 py-4"
						onFocusCapture={(event) => scrollFocusedFieldIntoView(event.target)}>
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
							<Label htmlFor="txn-amount">
								Amount *
								{amountCurrencyLabel && (
									<span className="ml-1 text-xs font-normal text-muted-foreground">
										{amountCurrencyLabel}
									</span>
								)}
							</Label>
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
							<Label>Date *</Label>
							<Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
								<PopoverTrigger asChild>
									<Button
										type="button"
										variant="outline"
										className="w-full justify-start font-normal">
										<CalendarIcon className="mr-2 h-4 w-4" />
										{watchedDate instanceof Date
											? format(watchedDate, "d MMMM yyyy")
											: "Pick a date"}
									</Button>
								</PopoverTrigger>
								<PopoverContent className="w-auto p-0" align="start">
									<Calendar
										mode="single"
										selected={watchedDate instanceof Date ? watchedDate : undefined}
										onSelect={(d) => {
											if (d) {
												setValue("date", d, { shouldValidate: true });
												setDatePickerOpen(false);
											}
										}}
									/>
								</PopoverContent>
							</Popover>
							{errors.date && (
								<p className="text-xs text-destructive">{errors.date.message as string}</p>
							)}
						</div>

						{/* From Account */}
						<div className="space-y-1.5">
							<Label>{watchedType === "Transfer" ? "From Account *" : "Account *"}</Label>
							<Select
								value={watchedAccount ?? ""}
								onValueChange={(v) => {
									setValue("accountId", v, { shouldValidate: true });
									if (!editTransactionId && watchedToAccount) {
										const nextSource = baseAccounts.find((account) => account.id === v);
										const currentDestination = baseAccounts.find(
											(account) => account.id === watchedToAccount
										);
										if (
											nextSource &&
											currentDestination &&
											nextSource.currency !== currentDestination.currency
										) {
											setValue("toAccountId", undefined, { shouldValidate: true });
										}
									}
								}}>
								<SelectTrigger>
									<SelectValue placeholder="Select account" />
								</SelectTrigger>
								<SelectContent>
									{accountOptions.map((a) => (
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
									value={watchedToAccount ?? ""}
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
								{destAccounts.length === 0 && (
									<p className="text-xs text-muted-foreground">
										{selectedAccount
											? `Add another active ${selectedAccount.currency} account before recording a transfer.`
											: "Select a source account before choosing a destination."}
									</p>
								)}
								{crossCurrencyTransferWarning && (
									<p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
										{crossCurrencyTransferWarning}
									</p>
								)}
							</div>
						)}

						{/* Category (Expense / Income only) */}
						{watchedType !== "Transfer" && (
							<div className="space-y-1.5">
								<Label>Category</Label>
								<Select
									value={watchedCategory ?? "none"}
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
												<span aria-hidden="true">{getCategoryIcon(c)}</span>
												<span>{c.title}</span>
											</SelectItem>
										))}
									</SelectContent>
								</Select>
								{errors.categoryId && (
									<p className="text-xs text-destructive">{errors.categoryId.message}</p>
								)}
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
							onClick={() => {
								const nextShowTravel = !showTravel;
								setShowTravel(nextShowTravel);
								if (!nextShowTravel) {
									setValue("travelCurrency", undefined, { shouldValidate: true });
								}
							}}
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
										{errors.travelCurrency?.symbol && (
											<p className="text-xs text-destructive">
												{errors.travelCurrency.symbol.message}
											</p>
										)}
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
										{errors.travelCurrency?.rate && (
											<p className="text-xs text-destructive">
												{errors.travelCurrency.rate.message}
											</p>
										)}
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
										{errors.travelCurrency?.amount && (
											<p className="text-xs text-destructive">
												{errors.travelCurrency.amount.message}
											</p>
										)}
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
										{errors.travelCurrency?.location && (
											<p className="text-xs text-destructive">
												{errors.travelCurrency.location.message}
											</p>
										)}
									</div>
								</div>
							</div>
						)}
					</div>

					<DrawerFooter className="pb-safe shrink-0 border-t border-border/60 bg-popover/95 px-4 pt-3 [padding-bottom:calc(env(safe-area-inset-bottom,0px)_+_var(--keyboard-inset,0px)_+_0.75rem)] supports-backdrop-filter:backdrop-blur">
						{editTransactionId && (
							<Button
								variant="destructive"
								type="button"
								className="w-full"
								disabled={isSubmitting || saving}
								onClick={() => {
									void handleDelete();
								}}>
								{confirming ? "Tap again to confirm delete" : "Delete Transaction"}
							</Button>
						)}
						<Button
							type="submit"
							form={TRANSACTION_FORM_ID}
							disabled={isSubmitting || saving}
							className="w-full">
							{isSubmitting || saving ? "Saving…" : editTransactionId ? "Save Changes" : "Record"}
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
			</DrawerContent>
		</Drawer>
	);
}
