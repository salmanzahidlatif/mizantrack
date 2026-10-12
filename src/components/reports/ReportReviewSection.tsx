"use client";

import { format } from "date-fns";
import { Check, Sparkles, Undo2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import {
	getDetectionReasonLabel,
	getReportRoleLabel,
	REPORT_ROLE_OPTIONS,
} from "@/components/reports/reportLabels";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { CARD_SURFACE } from "@/lib/motion";
import { UNASSIGNED_PROJECT_ID } from "@/lib/reports/reportEngine";
import { clearTransactionTag, setTransactionTag } from "@/lib/reports/reportRepository";
import { cn } from "@/lib/utils";

import type {
	Account,
	DetectedReportTransaction,
	ReportProject,
	ReportTransactionRole,
	Transaction,
} from "@/types";

interface ReportReviewSectionProps {
	userId: string;
	detected: DetectedReportTransaction[];
	accountsById: Map<string, Account>;
	projects: ReportProject[];
}

interface DraftState {
	role: ReportTransactionRole;
	projectId: string;
}

function resolveTitle(transaction: Transaction): string {
	const description = transaction.description?.trim();
	if (description) return description;
	const place = transaction.place?.trim();
	if (place) return place;
	return "Transfer";
}

export function ReportReviewSection({
	userId,
	detected,
	accountsById,
	projects,
}: ReportReviewSectionProps) {
	const [drafts, setDrafts] = useState<Record<string, DraftState>>({});

	const { pending, confirmed } = useMemo(
		() => ({
			pending: detected.filter((item) => !item.confirmed),
			confirmed: detected.filter((item) => item.confirmed),
		}),
		[detected]
	);

	function getDraft(item: DetectedReportTransaction): DraftState {
		return (
			drafts[item.transaction.id] ?? {
				role: item.suggestedRole,
				projectId: item.projectId ?? UNASSIGNED_PROJECT_ID,
			}
		);
	}

	function updateDraft(transactionId: string, updates: Partial<DraftState>, fallback: DraftState) {
		setDrafts((previous) => ({
			...previous,
			[transactionId]: { ...fallback, ...updates },
		}));
	}

	function clearDraft(transactionId: string) {
		setDrafts((previous) => {
			if (!(transactionId in previous)) return previous;
			const next = { ...previous };
			delete next[transactionId];
			return next;
		});
	}

	async function applyTag(transactionId: string, draft: DraftState, message: string) {
		try {
			await setTransactionTag(userId, {
				transactionId,
				role: draft.role,
				projectId: draft.projectId === UNASSIGNED_PROJECT_ID ? undefined : draft.projectId,
				confirmed: true,
			});
			clearDraft(transactionId);
			toast.success(message);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not save your decision.");
		}
	}

	async function handleUntag(transactionId: string) {
		try {
			await clearTransactionTag(userId, transactionId);
			clearDraft(transactionId);
			toast.success("Tag removed. The suggestion is back under review.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not remove the tag.");
		}
	}

	function renderRow(item: DetectedReportTransaction) {
		const transaction = item.transaction;
		const draft = getDraft(item);
		const currency = accountsById.get(transaction.accountId)?.currency;
		const isPending = !item.confirmed;

		return (
			<div
				key={transaction.id}
				data-testid={isPending ? "report-review-pending-row" : "report-review-confirmed-row"}
				className={cn(
					"space-y-3 rounded-xl border p-3",
					isPending ? "border-dashed border-primary/60 bg-primary/5" : "border-border bg-card"
				)}>
				<div className="flex flex-wrap items-start justify-between gap-2">
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-2">
							<p className="truncate text-sm font-medium">{resolveTitle(transaction)}</p>
							{isPending ? (
								<Badge variant="outline" className="border-primary/60 text-primary">
									<Sparkles className="h-3 w-3" aria-hidden="true" />
									Suggested
								</Badge>
							) : (
								<Badge variant="secondary">{getReportRoleLabel(item.suggestedRole)}</Badge>
							)}
						</div>
						<p className="mt-0.5 text-xs text-muted-foreground">
							{format(transaction.date, "d MMM yyyy")} • {getDetectionReasonLabel(item)}
						</p>
					</div>
					<CurrencyAmount amount={transaction.amount} currency={currency} className="text-sm" />
				</div>

				<div className="flex flex-wrap items-center gap-2">
					<Select
						value={draft.role}
						onValueChange={(value) => {
							const role = value as ReportTransactionRole;
							if (isPending) {
								updateDraft(transaction.id, { role }, draft);
								return;
							}
							void applyTag(
								transaction.id,
								{ ...draft, role },
								`Saved as ${getReportRoleLabel(role)}.`
							);
						}}>
						<SelectTrigger size="sm" className="w-40" aria-label="Role">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{REPORT_ROLE_OPTIONS.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					{draft.role === "plot-payment" && (
						<Select
							value={draft.projectId}
							onValueChange={(projectId) => {
								if (isPending) {
									updateDraft(transaction.id, { projectId }, draft);
									return;
								}
								void applyTag(transaction.id, { ...draft, projectId }, "Project updated.");
							}}>
							<SelectTrigger size="sm" className="w-48" aria-label="Project">
								<SelectValue placeholder="Unassigned" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={UNASSIGNED_PROJECT_ID}>Unassigned</SelectItem>
								{projects.map((project) => (
									<SelectItem key={project.id} value={project.id}>
										{project.title}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}

					<div className="ml-auto flex items-center gap-2">
						{isPending ? (
							<>
								<Button
									size="sm"
									variant="ghost"
									onClick={() =>
										void applyTag(
											transaction.id,
											{ ...draft, role: "excluded" },
											"Suggestion dismissed."
										)
									}>
									<X className="mr-1.5 h-3.5 w-3.5" />
									Dismiss
								</Button>
								<Button
									size="sm"
									onClick={() =>
										void applyTag(
											transaction.id,
											draft,
											`Confirmed as ${getReportRoleLabel(draft.role)}.`
										)
									}>
									<Check className="mr-1.5 h-3.5 w-3.5" />
									Confirm
								</Button>
							</>
						) : (
							<Button size="sm" variant="ghost" onClick={() => void handleUntag(transaction.id)}>
								<Undo2 className="mr-1.5 h-3.5 w-3.5" />
								Untag
							</Button>
						)}
					</div>
				</div>
			</div>
		);
	}

	return (
		<section className={cn(CARD_SURFACE, "space-y-4 p-4")} aria-labelledby="report-review-heading">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h2 id="report-review-heading" className="text-sm font-semibold">
						Review &amp; confirm
					</h2>
					<p className="text-xs text-muted-foreground">
						Suggestions are never counted until you confirm them.
					</p>
				</div>
				<Badge
					variant={pending.length > 0 ? "default" : "secondary"}
					data-testid="report-pending-count">
					{pending.length} pending review
				</Badge>
			</div>

			{pending.length === 0 ? (
				<p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
					Nothing new detected for this period.
				</p>
			) : (
				<div className="space-y-2">{pending.map(renderRow)}</div>
			)}

			<div className="space-y-2">
				<p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Confirmed ({confirmed.length})
				</p>
				{confirmed.length === 0 ? (
					<p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
						Confirm a suggestion and it will appear here and in the report below.
					</p>
				) : (
					confirmed.map(renderRow)
				)}
			</div>
		</section>
	);
}
