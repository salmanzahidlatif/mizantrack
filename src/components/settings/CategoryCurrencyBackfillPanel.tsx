"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Loader2, RotateCcw, Tags } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	getCategoryCurrencyBackfillStatus,
	resetAutoAssignedCategoryCurrencies,
	runCategoryCurrencyBackfill,
} from "@/lib/db/categoryCurrencyBackfill";

interface CategoryCurrencyBackfillPanelProps {
	userId: string;
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
	return `${count} ${count === 1 ? singular : plural}`;
}

export function CategoryCurrencyBackfillPanel({ userId }: CategoryCurrencyBackfillPanelProps) {
	const status = useLiveQuery(() => getCategoryCurrencyBackfillStatus(userId), [userId]);
	const [running, setRunning] = useState(false);
	const [resetting, setResetting] = useState(false);

	async function handleRun() {
		setRunning(true);
		try {
			const result = await runCategoryCurrencyBackfill(userId);
			if (result.alreadyCompleted) {
				toast.info("Category currency backfill was already completed.");
				return;
			}
			toast.success(
				`Tagged ${formatCount(result.tagged, "category")}; kept ${formatCount(
					result.skippedMultiCurrency,
					"multi-currency category",
					"multi-currency categories"
				)} shared.`
			);
		} catch {
			toast.error("Failed to backfill category currencies.");
		} finally {
			setRunning(false);
		}
	}

	async function handleReset() {
		setResetting(true);
		try {
			const result = await resetAutoAssignedCategoryCurrencies(userId);
			toast.success(
				`Reset ${formatCount(result.reset, "auto-assigned category", "auto-assigned categories")}.`
			);
			if (result.skipped > 0) {
				toast.info(
					`${formatCount(
						result.skipped,
						"category",
						"categories"
					)} changed since backfill and were left untouched.`
				);
			}
		} catch {
			toast.error("Failed to reset auto-assigned category currencies.");
		} finally {
			setResetting(false);
		}
	}

	const canReset = (status?.resettableTagged ?? 0) > 0;

	return (
		<div className="space-y-3 rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
			<div className="flex items-start justify-between gap-3">
				<div className="space-y-1">
					<div className="flex items-center gap-2">
						<Tags className="h-4 w-4 text-muted-foreground" />
						<h2 className="font-semibold">Category Currency Tags</h2>
					</div>
					<p className="text-sm text-muted-foreground">
						One-time, local backfill that tags only shared categories used by active accounts in
						exactly one currency. Transfers count both accounts; multi-currency and unused
						categories stay shared.
					</p>
				</div>
				<Button
					variant={status?.completed ? "outline" : "default"}
					onClick={() => void handleRun()}
					disabled={running || resetting || status === undefined || status?.completed}>
					{running ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
					{status?.completed ? "Backfill Complete" : "Run Backfill"}
				</Button>
			</div>

			{status?.completed ? (
				<div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
					<div className="rounded-lg border border-border/60 bg-muted/30 p-2">
						<span className="font-medium text-foreground">{status.tagged}</span> tagged and marked
						for sync
					</div>
					<div className="rounded-lg border border-border/60 bg-muted/30 p-2">
						<span className="font-medium text-foreground">{status.skippedMultiCurrency}</span> kept
						shared because they use multiple currencies
					</div>
					<div className="rounded-lg border border-border/60 bg-muted/30 p-2">
						<span className="font-medium text-foreground">{status.skippedUnused}</span> unused and
						left shared
					</div>
					<div className="rounded-lg border border-border/60 bg-muted/30 p-2">
						<span className="font-medium text-foreground">{status.skippedTreeConflict}</span> left
						shared to keep parent/child trees coherent
					</div>
				</div>
			) : (
				<p className="text-xs text-muted-foreground">
					Run this after your devices have synced so the decision uses complete account and
					transaction history. Changes are not repeated on every sync.
				</p>
			)}

			<div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
				<Button
					variant="outline"
					size="sm"
					onClick={() => void handleReset()}
					disabled={!canReset || running || resetting}>
					{resetting ? (
						<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
					) : (
						<RotateCcw className="mr-1.5 h-3.5 w-3.5" />
					)}
					Reset Auto-assigned Tags
				</Button>
				<p className="text-xs text-muted-foreground">
					You can also review or change any category currency from the category editor.
				</p>
			</div>
		</div>
	);
}
