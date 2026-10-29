"use client";

import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AccountIcon } from "@/components/icons/AccountIcon";
import { FieldSwitch } from "@/components/shared/FieldSwitch";
import { IconGridPicker } from "@/components/shared/IconGridPicker";
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
import { bulkDeleteTransactions, bulkUpdateTransactions } from "@/lib/actions/transactions";
import { getCategoryIcon } from "@/lib/categoryIcons";
import { cn } from "@/lib/utils";

import type { BulkTransactionEditValues } from "@/lib/validations/transaction";
import type { Account, Category, Transaction } from "@/types";

const UNCATEGORIZED_VALUE = "__uncategorized__";
const AMOUNT_MODES = [
	{ value: "set", label: "Set to" },
	{ value: "adjustAmount", label: "Add / subtract" },
	{ value: "adjustPercent", label: "Change by %" },
] as const;

type AmountMode = (typeof AMOUNT_MODES)[number]["value"];

const AMOUNT_HINT: Record<AmountMode, string> = {
	set: "Every selected transaction gets this exact amount.",
	adjustAmount: "Added to each amount. Use a negative number to subtract.",
	adjustPercent: "A 5% rent rise is 5. A 10% cut is -10.",
};

interface FieldToggleProps {
	id: string;
	label: string;
	enabled: boolean;
	onEnabledChange: (enabled: boolean) => void;
	children: React.ReactNode;
}

function FieldToggle({ id, label, enabled, onEnabledChange, children }: FieldToggleProps) {
	return (
		<div
			className={cn(
				"space-y-2 rounded-lg border p-3 transition-colors",
				enabled ? "border-primary/50 bg-primary/5" : "border-border"
			)}>
			<div className="flex items-center justify-between gap-3">
				<Label htmlFor={id} className="text-sm font-medium">
					{label}
				</Label>
				<FieldSwitch
					id={id}
					label={`Change ${label}`}
					checked={enabled}
					onCheckedChange={onEnabledChange}
				/>
			</div>
			{enabled && children}
		</div>
	);
}

interface BulkEditTransactionsDrawerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	userId: string;
	/** The transactions the owner ticked. Kept whole so the form can adapt to their mix. */
	transactions: Transaction[];
	accounts: Account[];
	categories: Category[];
	onDone: () => void;
}

export function BulkEditTransactionsDrawer({
	open,
	onOpenChange,
	userId,
	transactions,
	accounts,
	categories,
	onDone,
}: BulkEditTransactionsDrawerProps) {
	const [amountEnabled, setAmountEnabled] = useState(false);
	const [amountMode, setAmountMode] = useState<AmountMode>("set");
	const [amountValue, setAmountValue] = useState("");
	const [categoryEnabled, setCategoryEnabled] = useState(false);
	const [categoryId, setCategoryId] = useState<string>(UNCATEGORIZED_VALUE);
	const [accountEnabled, setAccountEnabled] = useState(false);
	const [accountId, setAccountId] = useState<string | undefined>(undefined);
	const [descriptionEnabled, setDescriptionEnabled] = useState(false);
	const [description, setDescription] = useState("");
	const [placeEnabled, setPlaceEnabled] = useState(false);
	const [place, setPlace] = useState("");
	const [dateEnabled, setDateEnabled] = useState(false);
	const [date, setDate] = useState<Date | undefined>(undefined);
	const [datePickerOpen, setDatePickerOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const [confirmingDelete, setConfirmingDelete] = useState(false);

	const count = transactions.length;
	// A transfer has no category, so the field only makes sense when something in the
	// selection could actually take one.
	const hasCategorizable = transactions.some((txn) => txn.type !== "Transfer");
	const categorizableCount = transactions.filter((txn) => txn.type !== "Transfer").length;
	const selectionTypes = useMemo(
		() => Array.from(new Set(transactions.map((txn) => txn.type))),
		[transactions]
	);
	const categoryType = selectionTypes.includes("Expense") ? "Expense" : "Income";
	const categoryOptions = useMemo(
		() =>
			categories.filter(
				(category) =>
					// A mixed Expense/Income selection has no single valid category list, so
					// nothing is offered rather than silently mis-filing half the rows.
					selectionTypes.filter((type) => type !== "Transfer").length === 1 &&
					category.type === categoryType
			),
		[categories, categoryType, selectionTypes]
	);

	useEffect(() => {
		if (open) return;
		setAmountEnabled(false);
		setAmountMode("set");
		setAmountValue("");
		setCategoryEnabled(false);
		setCategoryId(UNCATEGORIZED_VALUE);
		setAccountEnabled(false);
		setAccountId(undefined);
		setDescriptionEnabled(false);
		setDescription("");
		setPlaceEnabled(false);
		setPlace("");
		setDateEnabled(false);
		setDate(undefined);
		setSaving(false);
		setConfirmingDelete(false);
	}, [open]);

	const accountPickerItems = useMemo(
		() =>
			accounts.map((account) => ({
				badge: account.currency,
				color: account.color,
				icon: <AccountIcon account={account} className="h-6 w-6" />,
				id: account.id,
				title: account.title,
			})),
		[accounts]
	);
	const categoryPickerItems = useMemo(
		() => [
			{ icon: "🏷️", id: UNCATEGORIZED_VALUE, title: "Uncategorized" },
			...categoryOptions.map((category) => ({
				color: category.color,
				icon: getCategoryIcon(category),
				id: category.id,
				title: category.title,
			})),
		],
		[categoryOptions]
	);

	function buildValues(): BulkTransactionEditValues {
		const values: BulkTransactionEditValues = {};

		if (amountEnabled) {
			// The mode travels even without a value so validation can say "enter an amount"
			// rather than the vaguer "choose a field to change".
			values.amountMode = amountMode;
			if (amountValue.trim() !== "") values.amountValue = Number(amountValue);
		}
		if (categoryEnabled) {
			if (categoryId === UNCATEGORIZED_VALUE) values.clearCategory = true;
			else values.categoryId = categoryId;
		}
		if (accountEnabled && accountId) values.accountId = accountId;
		if (descriptionEnabled) values.description = description;
		if (placeEnabled) {
			if (place.trim() === "") values.clearPlace = true;
			else values.place = place;
		}
		if (dateEnabled && date) values.date = date;

		return values;
	}

	async function handleSave() {
		const ids = transactions.map((txn) => txn.id);
		setSaving(true);
		try {
			const updated = await bulkUpdateTransactions(userId, ids, buildValues());
			if (updated === 0) {
				toast.info("Those transactions already matched the values you entered.");
			} else {
				toast.success(`${updated} ${updated === 1 ? "transaction" : "transactions"} updated`);
			}
			onOpenChange(false);
			onDone();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not update the transactions.");
		} finally {
			setSaving(false);
		}
	}

	async function handleDelete() {
		if (!confirmingDelete) {
			setConfirmingDelete(true);
			setTimeout(() => setConfirmingDelete(false), 3000);
			return;
		}
		setSaving(true);
		try {
			const deleted = await bulkDeleteTransactions(
				userId,
				transactions.map((txn) => txn.id)
			);
			toast.success(`${deleted} ${deleted === 1 ? "transaction" : "transactions"} deleted`);
			onOpenChange(false);
			onDone();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not delete the transactions.");
		} finally {
			setSaving(false);
		}
	}

	return (
		<Drawer open={open} handleOnly onOpenChange={onOpenChange}>
			<DrawerContent className="overflow-hidden pb-0 data-[vaul-drawer-direction=bottom]:h-[calc(100dvh_-_env(safe-area-inset-top,0px)_-_1rem)] data-[vaul-drawer-direction=bottom]:max-h-[95dvh] data-[vaul-drawer-direction=bottom]:pb-0">
				<DrawerHeader className="shrink-0 border-b border-border/60 px-4 pb-3 text-left">
					<DrawerTitle>
						Edit {count} {count === 1 ? "transaction" : "transactions"}
					</DrawerTitle>
					<DrawerDescription>
						Switch on only the fields you want to change. Everything else is left exactly as it is
						on each transaction.
					</DrawerDescription>
				</DrawerHeader>

				<div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
					<FieldToggle
						id="bulk-amount"
						label="Amount"
						enabled={amountEnabled}
						onEnabledChange={setAmountEnabled}>
						<div className="grid grid-cols-3 gap-1.5">
							{AMOUNT_MODES.map((mode) => (
								<button
									key={mode.value}
									type="button"
									aria-pressed={amountMode === mode.value}
									onClick={() => setAmountMode(mode.value)}
									className={cn(
										"rounded-lg border py-2 text-xs font-medium transition-colors",
										amountMode === mode.value
											? "border-primary bg-primary text-primary-foreground"
											: "border-border hover:border-primary"
									)}>
									{mode.label}
								</button>
							))}
						</div>
						<Input
							id="bulk-amount-value"
							type="number"
							step="0.01"
							inputMode="decimal"
							placeholder={amountMode === "adjustPercent" ? "e.g. 5" : "0.00"}
							aria-label="Bulk amount value"
							value={amountValue}
							onChange={(event) => setAmountValue(event.target.value)}
						/>
						<p className="text-xs text-muted-foreground">{AMOUNT_HINT[amountMode]}</p>
					</FieldToggle>

					{hasCategorizable && (
						<FieldToggle
							id="bulk-category"
							label="Category"
							enabled={categoryEnabled}
							onEnabledChange={setCategoryEnabled}>
							{categoryPickerItems.length > 1 ? (
								<IconGridPicker
									items={categoryPickerItems}
									value={categoryId}
									onChange={setCategoryId}
								/>
							) : (
								<p className="text-xs text-muted-foreground">
									The selection mixes expenses and income, so there is no single category list to
									choose from. Filter to one type first.
								</p>
							)}
							{categorizableCount !== count && (
								<p className="text-xs text-muted-foreground">
									Applies to {categorizableCount} of {count} — transfers have no category.
								</p>
							)}
						</FieldToggle>
					)}

					<FieldToggle
						id="bulk-account"
						label="Account"
						enabled={accountEnabled}
						onEnabledChange={setAccountEnabled}>
						<IconGridPicker
							items={accountPickerItems}
							value={accountId}
							emptyMessage="No accounts available in this currency."
							onChange={setAccountId}
						/>
					</FieldToggle>

					<FieldToggle
						id="bulk-description"
						label="Description"
						enabled={descriptionEnabled}
						onEnabledChange={setDescriptionEnabled}>
						<Input
							placeholder="e.g. Monthly rent"
							aria-label="Bulk description"
							value={description}
							onChange={(event) => setDescription(event.target.value)}
						/>
					</FieldToggle>

					<FieldToggle
						id="bulk-place"
						label="Place"
						enabled={placeEnabled}
						onEnabledChange={setPlaceEnabled}>
						<Input
							placeholder="Leave empty to clear the place"
							aria-label="Bulk place"
							value={place}
							onChange={(event) => setPlace(event.target.value)}
						/>
					</FieldToggle>

					<FieldToggle
						id="bulk-date"
						label="Date"
						enabled={dateEnabled}
						onEnabledChange={setDateEnabled}>
						<Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
							<PopoverTrigger asChild>
								<Button
									type="button"
									variant="outline"
									className="w-full justify-start font-normal">
									<CalendarIcon className="mr-2 h-4 w-4" />
									{date ? format(date, "d MMMM yyyy") : "Pick a date"}
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-auto p-0" align="start">
								<Calendar
									mode="single"
									selected={date}
									onSelect={(next) => {
										if (!next) return;
										setDate(next);
										setDatePickerOpen(false);
									}}
								/>
							</PopoverContent>
						</Popover>
						<p className="text-xs text-muted-foreground">
							Every selected transaction moves to this one date.
						</p>
					</FieldToggle>
				</div>

				<DrawerFooter className="pb-safe shrink-0 border-t border-border/60 bg-popover/95 px-4 pt-3 [padding-bottom:calc(env(safe-area-inset-bottom,0px)_+_0.75rem)] supports-backdrop-filter:backdrop-blur">
					<Button
						type="button"
						className="w-full"
						disabled={saving}
						onClick={() => {
							void handleSave();
						}}>
						{saving
							? "Saving…"
							: `Apply to ${count} ${count === 1 ? "transaction" : "transactions"}`}
					</Button>
					<Button
						type="button"
						variant="destructive"
						className="w-full"
						disabled={saving}
						onClick={() => {
							void handleDelete();
						}}>
						{confirmingDelete
							? "Tap again to confirm delete"
							: `Delete ${count} ${count === 1 ? "transaction" : "transactions"}`}
					</Button>
					<DrawerClose asChild>
						<Button variant="outline" type="button" className="w-full">
							Cancel
						</Button>
					</DrawerClose>
				</DrawerFooter>
			</DrawerContent>
		</Drawer>
	);
}
