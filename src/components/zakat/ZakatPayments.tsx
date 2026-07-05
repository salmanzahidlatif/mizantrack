"use client";

import { format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Trash2, Edit2, Save, X } from "lucide-react";
import { useState } from "react";
import { v4 as uuid } from "uuid";

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
import { db } from "@/lib/db/local";
import { getZakatYear } from "@/lib/islamicCalendar";
import type { ZakatPayment } from "@/types";

interface ZakatPaymentsProps {
	userId: string;
	referenceCurrency: string;
}

export function ZakatPayments({ userId, referenceCurrency }: ZakatPaymentsProps) {
	const [isAdding, setIsAdding] = useState(false);
	const [editingId, setEditingId] = useState<string | null>(null);

	const payments = useLiveQuery(
		() =>
			db.zakatPayments
				.where("userId")
				.equals(userId)
				.filter((p) => !p.deletedAt)
				.reverse()
				.sortBy("date"),
		[userId]
	);

	const calculations = useLiveQuery(
		() =>
			db.zakatCalculations
				.where("userId")
				.equals(userId)
				.filter((c) => !c.deletedAt)
				.toArray(),
		[userId]
	);

	async function handleAdd(payment: Omit<ZakatPayment, "id" | "userId" | "createdAt" | "updatedAt">) {
		await db.zakatPayments.add({
			...payment,
			id: uuid(),
			userId,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});
		setIsAdding(false);
	}

	async function handleUpdate(id: string, updates: Partial<ZakatPayment>) {
		await db.zakatPayments.update(id, { ...updates, updatedAt: Date.now() });
		setEditingId(null);
	}

	async function handleDelete(id: string) {
		if (confirm("Delete this payment record?")) {
			await db.zakatPayments.update(id, { deletedAt: Date.now() });
		}
	}

	const totalPaid = payments?.reduce((sum, p) => sum + p.amount, 0) ?? 0;

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-sm font-medium">Zakat Payments</h3>
					<p className="text-xs text-muted-foreground">Track when and where you paid zakat</p>
				</div>
				<Button size="sm" variant="outline" onClick={() => setIsAdding(true)}>
					<Plus className="mr-1.5 h-3.5 w-3.5" />
					Add Payment
				</Button>
			</div>

			{/* Summary */}
			<div className="rounded-lg border bg-card p-3">
				<p className="text-xs text-muted-foreground">Total Paid (All Time)</p>
				<p className="text-lg font-bold tabular-nums">
					{totalPaid.toLocaleString("en-US", { minimumFractionDigits: 2 })} {referenceCurrency}
				</p>
			</div>

			{/* Add Form */}
			{isAdding && (
				<PaymentForm
					calculations={calculations ?? []}
					onSave={handleAdd}
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
							onSave={(data) => handleUpdate(payment.id, data)}
							onCancel={() => setEditingId(null)}
							referenceCurrency={referenceCurrency}
						/>
					) : (
						<div
							key={payment.id}
							className="flex items-center justify-between rounded-lg border bg-card p-3 text-sm">
							<div className="flex-1">
								<div className="flex items-center gap-2">
									<span className="font-medium">
										{payment.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}{" "}
										{payment.currency}
									</span>
									<span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
										{payment.islamicYear}
									</span>
								</div>
								<p className="text-xs text-muted-foreground">
									{format(new Date(payment.date), "d MMM yyyy")}
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
						No payments recorded yet. Add your first payment above.
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
	onSave: (data: Omit<ZakatPayment, "id" | "userId" | "createdAt" | "updatedAt">) => void;
	onCancel: () => void;
	referenceCurrency: string;
}

function PaymentForm({
	initialData,
	calculations,
	onSave,
	onCancel,
	referenceCurrency,
}: PaymentFormProps) {
	const [date, setDate] = useState(
		initialData?.date
			? new Date(initialData.date).toISOString().split("T")[0]
			: new Date().toISOString().split("T")[0]
	);
	const [amount, setAmount] = useState(initialData?.amount ?? 0);
	const [currency, setCurrency] = useState(initialData?.currency ?? referenceCurrency);
	const [islamicYear, setIslamicYear] = useState(
		initialData?.islamicYear ?? getZakatYear(new Date())
	);
	const [calculationId, setCalculationId] = useState(initialData?.calculationId ?? "");
	const [recipient, setRecipient] = useState(initialData?.recipient ?? "");
	const [notes, setNotes] = useState(initialData?.notes ?? "");

	// Get unique Islamic years from calculations
	const uniqueYears = Array.from(new Set(calculations.map((c) => c.islamicYear))).sort().reverse();

	// If no calculations, allow manual entry
	const availableYears = uniqueYears.length > 0 ? uniqueYears : [islamicYear];

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!date || amount <= 0) return;

		onSave({
			date: new Date(date).getTime(),
			amount,
			currency,
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
					<Label className="text-xs">Payment Date *</Label>
					<Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
				</div>

				{/* Amount */}
				<div className="space-y-1">
					<Label className="text-xs">Amount *</Label>
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

				{/* Currency */}
				<div className="space-y-1">
					<Label className="text-xs">Currency</Label>
					<Input
						value={currency}
						onChange={(e) => setCurrency(e.target.value)}
						placeholder={referenceCurrency}
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
