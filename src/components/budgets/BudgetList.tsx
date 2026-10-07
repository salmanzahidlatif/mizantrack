"use client";

import { AlertTriangle, CheckCircle2, Pencil, Trash2, WalletCards } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { Button } from "@/components/ui/button";
import { deleteBudget, type BudgetProgressRow } from "@/hooks/useBudgets";
import { useHaptics } from "@/hooks/useHaptics";
import { CARD_SURFACE, LIST_ROW, staggerDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface BudgetListProps {
	userId: string;
	rows: BudgetProgressRow[];
	currency: string;
	monthLabel: string;
	onEdit: (row: BudgetProgressRow) => void;
}

const STATUS_COPY = {
	under: {
		label: "On track",
		description: "Available to spend",
		icon: CheckCircle2,
		cardClass: "border-emerald-500/20 bg-emerald-500/5",
		barClass: "bg-emerald-500",
		badgeClass: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
	},
	near: {
		label: "Near limit",
		description: "Watch this category",
		icon: AlertTriangle,
		cardClass: "border-amber-500/30 bg-amber-500/10",
		barClass: "bg-amber-500",
		badgeClass: "bg-amber-500/15 text-amber-800 dark:text-amber-200",
	},
	over: {
		label: "OVER BUDGET",
		description: "Overspent by",
		icon: AlertTriangle,
		cardClass: "border-red-500/60 bg-red-500/10 ring-2 ring-red-500/25",
		barClass: "bg-red-600",
		badgeClass: "bg-red-600 text-white shadow-sm",
	},
} as const;

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message;
	return "Something went wrong. Please try again.";
}

function BudgetEmptyState({ currency, monthLabel }: { currency: string; monthLabel: string }) {
	return (
		<div
			className={cn(
				CARD_SURFACE,
				"fade-scale-in flex flex-col items-center gap-3 px-5 py-10 text-center"
			)}
			data-testid="budget-empty-state">
			<div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
				<WalletCards className="h-7 w-7" />
			</div>
			<div className="space-y-1">
				<h2 className="text-lg font-semibold">No budgets for {monthLabel}</h2>
				<p className="text-sm text-muted-foreground">
					Create per-category budgets for {currency} to track monthly spending progress.
				</p>
			</div>
		</div>
	);
}

function BudgetCard({
	row,
	userId,
	onEdit,
	index,
}: {
	row: BudgetProgressRow;
	userId: string;
	onEdit: (row: BudgetProgressRow) => void;
	index: number;
}) {
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const haptics = useHaptics();
	const status = STATUS_COPY[row.status];
	const StatusIcon = status.icon;
	const remainingLabel = row.status === "over" ? Math.abs(row.remaining) : row.remaining;

	async function handleDelete() {
		if (!confirmingDelete) {
			haptics.warning();
			setConfirmingDelete(true);
			window.setTimeout(() => setConfirmingDelete(false), 3000);
			return;
		}

		setDeleting(true);
		try {
			await deleteBudget(userId, row.budget.id);
			haptics.success();
			toast.success("Budget deleted");
		} catch (error) {
			haptics.error();
			toast.error(errorMessage(error));
		} finally {
			setDeleting(false);
			setConfirmingDelete(false);
		}
	}

	return (
		<article
			className={cn(CARD_SURFACE, LIST_ROW, "space-y-4 p-4", status.cardClass)}
			style={staggerDelay(index)}
			data-testid="budget-row"
			data-status={row.status}>
			<div className="flex items-start justify-between gap-3">
				<div className="flex min-w-0 items-start gap-3">
					<div
						className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-background text-xl shadow-sm"
						style={row.color ? { color: row.color } : undefined}>
						{row.icon ?? "🏷️"}
					</div>
					<div className="min-w-0 space-y-1">
						<h2 className="truncate text-base font-semibold">{row.title}</h2>
						<div
							className={cn(
								"inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold tracking-wide",
								status.badgeClass
							)}>
							<StatusIcon className="h-3.5 w-3.5" />
							<span>{status.label}</span>
						</div>
					</div>
				</div>
				<div className="flex shrink-0 gap-1">
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label={`Edit ${row.title} budget`}
						onClick={() => onEdit(row)}>
						<Pencil className="h-4 w-4" />
					</Button>
					<Button
						type="button"
						variant={confirmingDelete ? "destructive" : "ghost"}
						size="icon"
						disabled={deleting}
						aria-label={
							confirmingDelete ? `Confirm delete ${row.title} budget` : `Delete ${row.title} budget`
						}
						onClick={() => {
							void handleDelete();
						}}>
						<Trash2 className="h-4 w-4" />
					</Button>
				</div>
			</div>

			<div className="grid grid-cols-3 gap-2 text-sm">
				<div className="rounded-xl bg-background/70 p-2">
					<p className="text-xs text-muted-foreground">Budgeted</p>
					<CurrencyAmount amount={row.budgeted} currency={row.currency} className="tabular-nums" />
				</div>
				<div className="rounded-xl bg-background/70 p-2">
					<p className="text-xs text-muted-foreground">Spent</p>
					<CurrencyAmount amount={row.spent} currency={row.currency} className="tabular-nums" />
				</div>
				<div className="rounded-xl bg-background/70 p-2">
					<p className="text-xs text-muted-foreground">{status.description}</p>
					<CurrencyAmount
						amount={remainingLabel}
						currency={row.currency}
						variant={row.status === "over" ? "negative" : "positive"}
						className="tabular-nums"
					/>
				</div>
			</div>

			<div className="space-y-2">
				<div className="h-3 overflow-hidden rounded-full bg-background shadow-inner">
					<div
						className={cn(
							"h-full rounded-full transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-out-expo)]",
							status.barClass
						)}
						style={{ width: `${row.progressPercent}%` }}
					/>
				</div>
				<div className="flex items-center justify-between text-xs text-muted-foreground">
					<span>{Math.round(row.progressRatio * 100)}% used</span>
					{row.status === "over" && (
						<span className="font-semibold text-red-700 dark:text-red-300">
							Spending exceeded the budget limit
						</span>
					)}
				</div>
			</div>
		</article>
	);
}

export function BudgetList({ userId, rows, currency, monthLabel, onEdit }: BudgetListProps) {
	if (rows.length === 0) {
		return <BudgetEmptyState currency={currency} monthLabel={monthLabel} />;
	}

	return (
		<div className="space-y-3" data-testid="budget-list">
			{rows.map((row, index) => (
				<BudgetCard key={row.budget.id} row={row} userId={userId} onEdit={onEdit} index={index} />
			))}
		</div>
	);
}
