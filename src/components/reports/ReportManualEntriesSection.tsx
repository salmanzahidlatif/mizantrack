"use client";

import { format } from "date-fns";
import { Edit2, Plus, Save, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { CARD_SURFACE } from "@/lib/motion";
import {
	createManualEntry,
	deleteManualEntry,
	updateManualEntry,
} from "@/lib/reports/reportRepository";
import { cn } from "@/lib/utils";

import type { ReportManualEntry } from "@/types";

type ManualEntrySection = ReportManualEntry["section"];

const SECTION_OPTIONS: Array<{ value: ManualEntrySection; label: string }> = [
	{ value: "banks", label: "Banks" },
	{ value: "plots", label: "Plots" },
	{ value: "other", label: "Other" },
];

interface ReportManualEntriesSectionProps {
	userId: string;
	entries: ReportManualEntry[];
	currencies: string[];
	defaultCurrency: string;
	fiscalYearKey: string;
}

interface ManualEntryFormValues {
	label: string;
	amount: number;
	currency: string;
	section: ManualEntrySection;
	date?: number;
	note?: string;
}

export function ReportManualEntriesSection({
	userId,
	entries,
	currencies,
	defaultCurrency,
	fiscalYearKey,
}: ReportManualEntriesSectionProps) {
	const [isAdding, setIsAdding] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);

	async function handleCreate(values: ManualEntryFormValues) {
		try {
			await createManualEntry(userId, { ...values, fiscalYearKey });
			setIsAdding(false);
			toast.success("Entry added.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not add the entry.");
		}
	}

	async function handleUpdate(entryId: string, values: ManualEntryFormValues) {
		try {
			await updateManualEntry(entryId, values);
			setEditingId(null);
			toast.success("Entry updated.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not update the entry.");
		}
	}

	async function handleDelete(entry: ReportManualEntry) {
		try {
			await deleteManualEntry(entry.id);
			toast.success(`${entry.label} deleted.`);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not delete the entry.");
		}
	}

	return (
		<section className={cn(CARD_SURFACE, "space-y-4 p-4")} aria-labelledby="report-manual-heading">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<h2 id="report-manual-heading" className="text-sm font-semibold">
						Manual entries
					</h2>
					<p className="text-xs text-muted-foreground">
						Figures you type in yourself, e.g. &ldquo;Nayatel tax 4285 PKR&rdquo;. Nothing is
						calculated for you.
					</p>
				</div>
				<Button size="sm" variant="outline" onClick={() => setIsAdding(true)}>
					<Plus className="mr-1.5 h-3.5 w-3.5" />
					Add entry
				</Button>
			</div>

			{isAdding && (
				<ManualEntryForm
					currencies={currencies}
					defaultCurrency={defaultCurrency}
					onSave={(values) => void handleCreate(values)}
					onCancel={() => setIsAdding(false)}
				/>
			)}

			{entries.length === 0 && !isAdding ? (
				<p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
					No manual entries for this period yet.
				</p>
			) : (
				<div className="space-y-2">
					{entries.map((entry) =>
						editingId === entry.id ? (
							<ManualEntryForm
								key={entry.id}
								initialValues={{
									label: entry.label,
									amount: entry.amount,
									currency: entry.currency,
									section: entry.section,
									date: entry.date,
									note: entry.note,
								}}
								currencies={currencies}
								defaultCurrency={defaultCurrency}
								onSave={(values) => void handleUpdate(entry.id, values)}
								onCancel={() => setEditingId(null)}
							/>
						) : (
							<div
								key={entry.id}
								className="flex items-center justify-between gap-3 rounded-xl border bg-card p-3">
								<div className="min-w-0">
									<div className="flex flex-wrap items-center gap-2">
										<span className="truncate text-sm font-medium">{entry.label}</span>
										<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
											{SECTION_OPTIONS.find((option) => option.value === entry.section)?.label ??
												entry.section}
										</span>
									</div>
									{(entry.date !== undefined || entry.note) && (
										<p className="truncate text-xs text-muted-foreground">
											{entry.date !== undefined ? format(entry.date, "d MMM yyyy") : null}
											{entry.date !== undefined && entry.note ? " • " : null}
											{entry.note}
										</p>
									)}
								</div>
								<div className="flex items-center gap-1">
									<CurrencyAmount
										amount={entry.amount}
										currency={entry.currency}
										showNegativeSign
										className="text-sm"
									/>
									<Button
										size="sm"
										variant="ghost"
										aria-label={`Edit ${entry.label}`}
										onClick={() => setEditingId(entry.id)}
										className="h-8 w-8 p-0">
										<Edit2 className="h-3.5 w-3.5" />
									</Button>
									<Button
										size="sm"
										variant="ghost"
										aria-label={`Delete ${entry.label}`}
										onClick={() => void handleDelete(entry)}
										className="h-8 w-8 p-0 text-destructive hover:text-destructive">
										<Trash2 className="h-3.5 w-3.5" />
									</Button>
								</div>
							</div>
						)
					)}
				</div>
			)}
		</section>
	);
}

interface ManualEntryFormProps {
	initialValues?: ManualEntryFormValues;
	currencies: string[];
	defaultCurrency: string;
	onSave: (values: ManualEntryFormValues) => void;
	onCancel: () => void;
}

function ManualEntryForm({
	initialValues,
	currencies,
	defaultCurrency,
	onSave,
	onCancel,
}: ManualEntryFormProps) {
	const [label, setLabel] = useState(initialValues?.label ?? "");
	const [amount, setAmount] = useState(initialValues?.amount ?? 0);
	const [currency, setCurrency] = useState(initialValues?.currency ?? defaultCurrency);
	const [section, setSection] = useState<ManualEntrySection>(initialValues?.section ?? "other");
	const [date, setDate] = useState(
		initialValues?.date ? new Date(initialValues.date).toISOString().split("T")[0] : ""
	);
	const [note, setNote] = useState(initialValues?.note ?? "");

	const currencyOptions = currencies.includes(currency) ? currencies : [currency, ...currencies];

	function handleSubmit(event: React.FormEvent) {
		event.preventDefault();
		if (!label.trim()) return;

		onSave({
			label,
			amount,
			currency,
			section,
			date: date ? new Date(date).getTime() : undefined,
			note: note.trim() || undefined,
		});
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-3 rounded-lg border bg-accent/50 p-4">
			<div className="grid gap-3 sm:grid-cols-2">
				<div className="space-y-1">
					<Label className="text-xs">Label *</Label>
					<Input
						value={label}
						onChange={(event) => setLabel(event.target.value)}
						placeholder="e.g. Nayatel tax"
						required
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-xs">Amount *</Label>
					<Input
						type="number"
						step="any"
						value={amount || ""}
						onChange={(event) => setAmount(parseFloat(event.target.value) || 0)}
						placeholder="0.00"
						required
					/>
				</div>
				<div className="space-y-1">
					<Label className="text-xs">Currency</Label>
					<Select value={currency} onValueChange={setCurrency}>
						<SelectTrigger className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{currencyOptions.map((code) => (
								<SelectItem key={code} value={code}>
									{code}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-1">
					<Label className="text-xs">Section</Label>
					<Select
						value={section}
						onValueChange={(value) => setSection(value as ManualEntrySection)}>
						<SelectTrigger className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{SECTION_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
				<div className="space-y-1">
					<Label className="text-xs">Date</Label>
					<Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
				</div>
				<div className="space-y-1">
					<Label className="text-xs">Note</Label>
					<Input
						value={note}
						onChange={(event) => setNote(event.target.value)}
						placeholder="Optional"
					/>
				</div>
			</div>
			<div className="flex justify-end gap-2">
				<Button type="button" size="sm" variant="ghost" onClick={onCancel}>
					<X className="mr-1.5 h-3.5 w-3.5" />
					Cancel
				</Button>
				<Button type="submit" size="sm">
					<Save className="mr-1.5 h-3.5 w-3.5" />
					Save
				</Button>
			</div>
		</form>
	);
}
