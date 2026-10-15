"use client";

import { format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Trash2, Edit2, Save, X } from "lucide-react";
import { useState } from "react";
import { v4 as uuid } from "uuid";

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
import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { db } from "@/lib/db/local";

import type { ZakatPayment } from "@/types";

interface ZakatPaymentsProps {
	userId: string;
	referenceCurrency: string;
	/** The selected zakat year, e.g. "1444-1445". Payments belong to exactly one. */
	islamicYear: string;
	/** Label for the sheet this year maps to, e.g. "2024 (1444–1445)". */
	yearLabel: string;
}

/**
 * The payment list for ONE zakat year.
 *
 * A payment is attributed to the year that was selected when it was recorded, and the
 * list and the Paid total show that year only — the same filter the engine applies when
 * it settles the year, so the screen, the carry-forward chain and the export cannot
 * disagree about what was paid.
 */
export function ZakatPayments({
	userId,
	referenceCurrency,
	islamicYear,
	yearLabel,
}: ZakatPaymentsProps) {
	const [isAdding, setIsAdding] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);

	const payments = useLiveQuery(
		() =>
			db.zakatPayments
				.where("userId")
				.equals(userId)
				.filter(
					(p) =>
						!p.deletedAt &&
						p.islamicYear === islamicYear &&
						normalizeCurrencyCode(p.currency) === normalizeCurrencyCode(referenceCurrency)
				)
				.reverse()
				.sortBy("date"),
		[userId, referenceCurrency, islamicYear]
	);

	const calculations = useLiveQuery(
		() =>
			db.zakatCalculations
				.where("userId")
				.equals(userId)
				.filter(
					(c) =>
						!c.deletedAt &&
						normalizeCurrencyCode(c.currency) === normalizeCurrencyCode(referenceCurrency)
				)
				.toArray(),
		[userId, referenceCurrency]
	);

	async function handleAdd(
		payment: Omit<ZakatPayment, "id" | "userId" | "currency" | "createdAt" | "updatedAt">
	) {
		await db.zakatPayments.add({
			...payment,
			id: uuid(),
			userId,
			currency: referenceCurrency,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		setIsAdding(false);
	}

	async function handleUpdate(id: string, updates: Partial<ZakatPayment>) {
		// `date` is passed through even when undefined so clearing it actually clears it.
		await db.zakatPayments.update(id, { ...updates, date: updates.date, updatedAt: Date.now() });
		setEditingId(null);
	}

	async function handleDelete(id: string) {
		if (confirm("Delete this payment record?")) {
			await db.zakatPayments.update(id, { deletedAt: Date.now() });
		}
	}

	// The year's Paid, which is exactly what `calculateZakatAssessment` sums for it.
	const totalPaid = payments?.reduce((sum, p) => sum + p.amount, 0) ?? 0;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-sm font-medium">Zakat Payments • {yearLabel}</h3>
					<p className="text-xs text-muted-foreground">
						Payments recorded against this zakat year. Switch the year in Monthly View to record
						against another one.
					</p>
				</div>
				<Button size="sm" variant="outline" onClick={() => setIsAdding(true)}>
					<Plus className="mr-1.5 h-3.5 w-3.5" />
					Add Payment
				</Button>
			</div>

			{/* Summary */}
			<div className="rounded-lg border bg-card p-3">
				<p className="text-xs text-muted-foreground">Paid ({yearLabel})</p>
				<p className="text-lg font-bold tabular-nums">
					<CurrencyAmount
						amount={totalPaid}
						currency={referenceCurrency}
						className="text-lg font-bold"
					/>
				</p>
			</div>

			{/* Add Form */}
			{isAdding && (
				<PaymentForm
					calculations={calculations ?? []}
					islamicYear={islamicYear}
					onSave={(data) => void handleAdd(data)}
					onCancel={() => setIsAdding(false)}
					referenceCurrency={referenceCurrency}
				/>
			)}

			{/* Payments List */}
			<div className="space-y-2">
				{payments?.map((payment) =>
					editingId === payment.id ? (
						<PaymentForm
							key={payment.id}
							initialData={payment}
							calculations={calculations ?? []}
							islamicYear={islamicYear}
							onSave={(data) => void handleUpdate(payment.id, data)}
							onCancel={() => setEditingId(null)}
							referenceCurrency={referenceCurrency}
						/>
					) : (
						<div
							key={payment.id}
							className="flex items-center justify-between rounded-lg border bg-card p-3 text-sm">
							<div className="flex-1">
								<div className="flex items-center gap-2">
									<CurrencyAmount
										amount={payment.amount}
										currency={payment.currency}
										className="font-medium"
									/>
									<span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
										{payment.islamicYear}
									</span>
								</div>
								<p className="text-xs text-muted-foreground">
									{payment.date ? format(new Date(payment.date), "d MMM yyyy") : "No date recorded"}
									{payment.recipient && ` • ${payment.recipient}`}
								</p>
								{payment.notes && (
									<p className="mt-1 text-xs text-muted-foreground">{payment.notes}</p>
								)}
							</div>
							<div className="flex items-center gap-1">
								<Button
									size="sm"
									variant="ghost"
									onClick={() => setEditingId(payment.id)}
									className="h-8 w-8 p-0">
									<Edit2 className="h-3.5 w-3.5" />
								</Button>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => void handleDelete(payment.id)}
									className="h-8 w-8 p-0 text-destructive hover:text-destructive">
									<Trash2 className="h-3.5 w-3.5" />
								</Button>
							</div>
						</div>
					)
				)}

				{payments?.length === 0 && !isAdding && (
					<p className="py-8 text-center text-sm text-muted-foreground">
						No {referenceCurrency} payments recorded for {yearLabel} yet. Add your first payment
						above.
					</p>
				)}
			</div>
		</div>
	);
}

// ============================================================================
// Payment Form Component
// ============================================================================

interface PaymentFormProps {
	initialData?: Partial<ZakatPayment>;
	calculations: Array<{ id: string; islamicYear: string; zakatObligation: number }>;
	/** The selected zakat year a new payment is attributed to. */
	islamicYear: string;
	onSave: (
		data: Omit<ZakatPayment, "id" | "userId" | "currency" | "createdAt" | "updatedAt">
	) => void;
	onCancel: () => void;
	referenceCurrency: string;
}

function PaymentForm({
	initialData,
	calculations,
	islamicYear: selectedIslamicYear,
	onSave,
	onCancel,
	referenceCurrency,
}: PaymentFormProps) {
	// Decision 3: the date is optional and nothing is preselected. Zakat is usually
	// recorded after it was paid, so a past date is normal and must be accepted.
	const [date, setDate] = useState(
		initialData?.date ? new Date(initialData.date).toISOString().split("T")[0] : ""
	);
	const [amount, setAmount] = useState(initialData?.amount ?? 0);
	// A payment belongs to the year that was selected when it was recorded, not to the
	// year that happens to be running today.
	const [islamicYear, setIslamicYear] = useState(initialData?.islamicYear ?? selectedIslamicYear);
	const [calculationId, setCalculationId] = useState(initialData?.calculationId ?? "");
	const [recipient, setRecipient] = useState(initialData?.recipient ?? "");
	const [notes, setNotes] = useState(initialData?.notes ?? "");

	// The selected year always leads the list, so recording against it is the default.
	const availableYears = Array.from(
		new Set([islamicYear, selectedIslamicYear, ...calculations.map((c) => c.islamicYear)])
	);

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (amount <= 0) return;

		onSave({
			date: date ? new Date(date).getTime() : undefined,
			amount,
			islamicYear,
			calculationId: calculationId || undefined,
			recipient: recipient.trim() || undefined,
			notes: notes.trim() || undefined,
		});
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-3 rounded-lg border bg-accent/50 p-4">
			<div className="grid gap-3 sm:grid-cols-2">
				{/* Date */}
				<div className="space-y-1">
					<Label htmlFor="zakat-payment-date" className="text-xs">
						Payment Date
					</Label>
					<Input
						id="zakat-payment-date"
						type="date"
						value={date}
						onChange={(e) => setDate(e.target.value)}
					/>
					<p className="text-xs text-muted-foreground">
						Optional. Past dates are fine — record it whenever it was paid.
					</p>
				</div>

				{/* Amount */}
				<div className="space-y-1">
					<Label className="text-xs">Amount ({referenceCurrency}) *</Label>
					<Input
						type="number"
						min={0}
						step="any"
						value={amount || ""}
						onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
						placeholder="0.00"
						required
					/>
				</div>

				{/* Islamic Year */}
				<div className="space-y-1">
					<Label className="text-xs">Islamic Year</Label>
					{availableYears.length > 1 ? (
						<Select value={islamicYear} onValueChange={setIslamicYear}>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{availableYears.map((year) => (
									<SelectItem key={year} value={year}>
										{year}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					) : (
						<Input
							value={islamicYear}
							onChange={(e) => setIslamicYear(e.target.value)}
							placeholder="e.g., 1446-1447"
						/>
					)}
				</div>

				{/* Calculation Link */}
				{calculations.length > 0 && (
					<div className="space-y-1 sm:col-span-2">
						<Label className="text-xs">Link to Calculation (Optional)</Label>
						<Select value={calculationId} onValueChange={setCalculationId}>
							<SelectTrigger>
								<SelectValue placeholder="Select a calculation..." />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="">None</SelectItem>
								{calculations.map((calc) => (
									<SelectItem key={calc.id} value={calc.id}>
										{calc.islamicYear} - {calc.zakatObligation.toFixed(2)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				)}

				{/* Recipient */}
				<div className="space-y-1 sm:col-span-2">
					<Label className="text-xs">Recipient</Label>
					<Input
						value={recipient}
						onChange={(e) => setRecipient(e.target.value)}
						placeholder="e.g., Local Masjid, Charity Organization"
					/>
				</div>

				{/* Notes */}
				<div className="space-y-1 sm:col-span-2">
					<Label className="text-xs">Notes</Label>
					<Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
				</div>
			</div>

			{/* Actions */}
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
