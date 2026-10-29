"use client";

import { format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, ChevronDown, ChevronUp, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { Button } from "@/components/ui/button";
import { useZakatYearAssessmentContext } from "@/hooks/useZakatYearAssessments";
import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { db } from "@/lib/db/local";
import {
	getContributingZakatSnapshotAccounts,
	hasUncountedZakatSnapshotAccounts,
} from "@/lib/zakatAccountVisibility";
import { auditZakatSnapshots } from "@/lib/zakatSnapshotAudit";

import type { ZakatSnapshotAudit } from "@/lib/zakatSnapshotAudit";
import type { ZakatCalculation } from "@/types";

interface ZakatHistoryProps {
	userId: string;
	referenceCurrency: string;
	/** The zakat year chosen above the tabs, e.g. "1444-1445". Undefined shows them all. */
	islamicYear?: string;
	/** Label for that year, e.g. "2024 (1444–1445)". */
	yearLabel?: string;
}

/**
 * The audit trail of saved zakat assessments.
 *
 * Every row is a RECORD, not a live figure: "on this date I assessed X and paid Y". A
 * bookkeeping error corrected three years later does not rewrite it, which is the whole
 * point of keeping it — but it does mean a saved figure and the books can part company,
 * and the carry-forward chain follows the books. So each record is recomputed live
 * beside itself, and any figure that has moved is shown BOTH ways, saved and current.
 *
 * Re-saving a year ADDS a record rather than replacing one. Overwriting would quietly
 * destroy the determination that was actually made, which is exactly the silent rewrite
 * this screen exists to prevent; the newest record for a year is marked, and the ones it
 * supersedes stay readable underneath it.
 */
export function ZakatHistory({
	userId,
	referenceCurrency,
	islamicYear,
	yearLabel,
}: ZakatHistoryProps) {
	const [expandedId, setExpandedId] = useState<string | null>(null);
	// The year is chosen once, above the tabs, and this tab answers for it. The whole
	// trail is one click away, because a determination's worth is in the chain it sits in.
	const [showEveryYear, setShowEveryYear] = useState(false);
	const scopedToYear = islamicYear !== undefined && !showEveryYear;

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
				.reverse()
				.sortBy("assessmentDate"),
		[userId, referenceCurrency]
	);

	const payments = useLiveQuery(
		() =>
			db.zakatPayments
				.where("userId")
				.equals(userId)
				.filter(
					(p) =>
						!p.deletedAt &&
						normalizeCurrencyCode(p.currency) === normalizeCurrencyCode(referenceCurrency)
				)
				.toArray(),
		[userId, referenceCurrency]
	);

	// The books as they stand now, loaded ONCE for the whole list. A year's grid walks
	// every transaction twelve times, so a query — or a rebuild — per row would make a
	// long history crawl.
	const assessmentContext = useZakatYearAssessmentContext(userId, referenceCurrency);

	/**
	 * Newest record first within a year, so the latest determination reads above the ones
	 * it supersedes, and each row knows how many records its year holds.
	 */
	const records = useMemo(() => {
		const ordered = [...(calculations ?? [])].sort(
			(a, b) => b.assessmentDate - a.assessmentDate || b.createdAt - a.createdAt
		);

		const latestByYear = new Map<string, ZakatCalculation>();
		const savedPerYear = new Map<string, number>();
		for (const calc of ordered) {
			savedPerYear.set(calc.islamicYear, (savedPerYear.get(calc.islamicYear) ?? 0) + 1);
			const latest = latestByYear.get(calc.islamicYear);
			if (!latest || calc.createdAt > latest.createdAt) latestByYear.set(calc.islamicYear, calc);
		}

		return ordered.map((calc) => ({
			calc,
			isLatestForYear: latestByYear.get(calc.islamicYear)?.id === calc.id,
			savedForYear: savedPerYear.get(calc.islamicYear) ?? 1,
		}));
	}, [calculations]);

	// The tab answers for the year chosen above the tabs; the rest stay one click away.
	const visibleRecords = useMemo(
		() =>
			scopedToYear ? records.filter((record) => record.calc.islamicYear === islamicYear) : records,
		[islamicYear, records, scopedToYear]
	);
	const otherYearCount = records.length - visibleRecords.length;

	const audits = useMemo(
		() =>
			auditZakatSnapshots(
				records.map((record) => record.calc),
				assessmentContext
			),
		[assessmentContext, records]
	);

	async function handleDelete(id: string) {
		if (confirm("Delete this zakat calculation?")) {
			await db.zakatCalculations.update(id, { deletedAt: Date.now() });
		}
	}

	function getPaidAmount(calc: ZakatCalculation): number {
		if (!payments) return 0;
		return payments
			.filter((p) => p.calculationId === calc.id)
			.reduce((sum, p) => sum + p.amount, 0);
	}

	if (!calculations) {
		return (
			<div className="rounded-lg border bg-card p-8 text-center">
				<p className="text-sm text-muted-foreground">Loading zakat history...</p>
			</div>
		);
	}

	if (calculations.length === 0) {
		return (
			<div className="rounded-lg border bg-card p-8 text-center">
				<p className="text-sm text-muted-foreground">
					No {referenceCurrency} zakat calculations saved yet. Complete a calculation to see it
					here.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<h3 className="text-sm font-medium">
						Zakat Assessment Record
						{scopedToYear && yearLabel ? ` • ${yearLabel}` : ""}
					</h3>
					<p className="text-xs text-muted-foreground">
						What you assessed, and when you assessed it. Each record is kept exactly as it was saved
						and is never rewritten when the underlying data changes later, so it shows what was
						assessed then — not necessarily what the books say now. Where the two no longer agree,
						both figures are shown.
					</p>
				</div>
				{islamicYear !== undefined && (otherYearCount > 0 || showEveryYear) && (
					<Button size="sm" variant="outline" onClick={() => setShowEveryYear(!showEveryYear)}>
						{showEveryYear
							? `Only ${yearLabel ?? islamicYear}`
							: `Every year (${otherYearCount} more)`}
					</Button>
				)}
			</div>

			{visibleRecords.length === 0 && (
				<div className="rounded-lg border bg-card p-8 text-center">
					<p className="text-sm text-muted-foreground">
						Nothing assessed for {yearLabel ?? islamicYear} yet. Saving a calculation for this year
						records it here.
					</p>
				</div>
			)}

			<div className="space-y-2">
				{visibleRecords.map(({ calc, isLatestForYear, savedForYear }) => {
					const isExpanded = expandedId === calc.id;
					const paidAmount = getPaidAmount(calc);
					const remaining = Math.max(0, calc.zakatObligation - paidAmount);
					const audit = audits.get(calc.id);
					// Only the accounts this record can evidence as contributors: the ones it
					// counted, minus the ones that held nothing — the same zero-balance rule
					// the monthly view and the workbook follow. A record saved before the
					// snapshot was narrowed also carries accounts that were never counted;
					// they stay on the record, but they are not presented as contributors.
					const countedAccounts = calc.accountBalances.filter((a) => a.zakatable);
					const shownAccounts = getContributingZakatSnapshotAccounts(calc.accountBalances);
					const hasUncountedAccounts = hasUncountedZakatSnapshotAccounts(calc.accountBalances);
					// Silver was one weight at one price, so the price it was assessed at is
					// simply the value divided by the weight. A record saved before silver
					// existed carries neither, and reads as a year that held none.
					const silverGrams = calc.totalSilverWeightGrams ?? 0;
					const silverPricePerGram =
						silverGrams > 0 ? (calc.totalSilverValue ?? 0) / silverGrams : 0;

					return (
						<div
							key={calc.id}
							className={`overflow-hidden rounded-lg border bg-card ${
								audit?.status === "diverged" ? "border-amber-500/40" : ""
							}`}>
							{/* Header */}
							<button
								type="button"
								onClick={() => setExpandedId(isExpanded ? null : calc.id)}
								className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-accent/50">
								<div className="flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<span className="font-medium">Islamic Year {calc.islamicYear}</span>
										{savedForYear > 1 && (
											<span
												className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
													isLatestForYear
														? "bg-primary/10 text-primary"
														: "bg-muted text-muted-foreground"
												}`}>
												{isLatestForYear
													? `Latest of ${savedForYear}`
													: "Superseded by a later assessment"}
											</span>
										)}
										<ZakatSnapshotBadge audit={audit} />
									</div>
									<p className="text-xs text-muted-foreground">
										Saved {format(new Date(calc.createdAt), "d MMM yyyy, h:mm a")} • covers the
										zakat year ending {format(new Date(calc.assessmentDate), "d MMM yyyy")}
									</p>
								</div>

								<div className="flex items-center gap-4">
									{/* Zakat is owed on the wealth held, so the amount always shows. */}
									<div className="text-right">
										<CurrencyAmount
											amount={calc.zakatObligation}
											currency={calc.referenceCurrency}
											className="text-sm font-bold text-primary"
										/>
										<p className="text-xs text-muted-foreground">as assessed then</p>
										{paidAmount > 0 && (
											<p className="text-xs text-muted-foreground">
												Paid:{" "}
												<CurrencyAmount
													amount={paidAmount}
													currency={calc.referenceCurrency}
													className="font-normal tracking-normal"
												/>{" "}
												• Remaining:{" "}
												<CurrencyAmount
													amount={remaining}
													currency={calc.referenceCurrency}
													className="font-normal tracking-normal"
												/>
											</p>
										)}
									</div>

									{isExpanded ? (
										<ChevronUp className="h-4 w-4 text-muted-foreground" />
									) : (
										<ChevronDown className="h-4 w-4 text-muted-foreground" />
									)}
								</div>
							</button>

							{/* Expanded Details */}
							{isExpanded && (
								<div className="border-t bg-accent/30 p-4">
									<ZakatSnapshotComparison audit={audit} currency={calc.referenceCurrency} />

									<div className="grid gap-4 sm:grid-cols-2">
										{/* Configuration */}
										<div className="space-y-2">
											<h4 className="text-xs font-medium text-muted-foreground">
												Configuration used then
											</h4>
											<div className="space-y-1 text-sm">
												{/* Every price on this card is in the record's own currency. Zakat
												    is never converted, so a hardcoded one would have the card
												    contradicting itself: 7,776 a gram is what the 2020 sheet paid
												    in RUPEES, and the gold value two lines below says so. */}
												<div className="flex justify-between">
													<span className="text-muted-foreground">Gold Price/gram:</span>
													<CurrencyAmount
														amount={calc.goldPricePerGram}
														currency={calc.referenceCurrency}
														className="font-normal tracking-normal"
													/>
												</div>
												{silverGrams > 0 && (
													<div className="flex justify-between">
														<span className="text-muted-foreground">Silver Price/gram:</span>
														<CurrencyAmount
															amount={silverPricePerGram}
															currency={calc.referenceCurrency}
															className="font-normal tracking-normal"
														/>
													</div>
												)}
											</div>
										</div>

										{/* Results */}
										<div className="space-y-2">
											<h4 className="text-xs font-medium text-muted-foreground">
												Results as assessed
											</h4>
											<div className="space-y-1 text-sm">
												<div className="flex justify-between">
													<span className="text-muted-foreground">Total Zakatable:</span>
													<CurrencyAmount
														amount={calc.totalZakatable}
														currency={calc.referenceCurrency}
														className="font-normal tracking-normal"
													/>
												</div>
												<div className="flex justify-between font-medium">
													<span>Zakat Obligation:</span>
													<CurrencyAmount
														amount={calc.zakatObligation}
														currency={calc.referenceCurrency}
														className="text-primary"
													/>
												</div>
											</div>
										</div>

										{/* Gold */}
										{calc.totalGoldWeightGrams > 0 && (
											<div className="space-y-2">
												<h4 className="text-xs font-medium text-muted-foreground">Gold Holdings</h4>
												<div className="space-y-1 text-sm">
													<div className="flex justify-between">
														<span className="text-muted-foreground">Total Weight:</span>
														<span className="tabular-nums">
															{calc.totalGoldWeightGrams.toFixed(2)}g
														</span>
													</div>
													<div className="flex justify-between">
														<span className="text-muted-foreground">Total Value:</span>
														<CurrencyAmount
															amount={calc.totalGoldValue}
															currency={calc.referenceCurrency}
															className="font-normal tracking-normal"
														/>
													</div>
												</div>
											</div>
										)}

										{/* Silver: one weight at one price, so the price per gram IS the
										    value divided by the weight. The deprecated
										    `silverPricePerGram` is deliberately not read here — it only
										    ever held a dropped nisab threshold. */}
										{silverGrams > 0 && (
											<div className="space-y-2">
												<h4 className="text-xs font-medium text-muted-foreground">
													Silver Holdings
												</h4>
												<div className="space-y-1 text-sm">
													<div className="flex justify-between">
														<span className="text-muted-foreground">Total Weight:</span>
														<span className="tabular-nums">{silverGrams.toFixed(2)}g</span>
													</div>
													<div className="flex justify-between">
														<span className="text-muted-foreground">Total Value:</span>
														<CurrencyAmount
															amount={calc.totalSilverValue ?? 0}
															currency={calc.referenceCurrency}
															className="font-normal tracking-normal"
														/>
													</div>
												</div>
											</div>
										)}

										{/* Accounts */}
										<div className="space-y-2 sm:col-span-2">
											<h4 className="text-xs font-medium text-muted-foreground">
												Account Balances ({shownAccounts.length} of {countedAccounts.length}{" "}
												accounts)
											</h4>
											{shownAccounts.length < countedAccounts.length && (
												<p className="text-xs text-muted-foreground">
													Accounts that held nothing in this assessment are hidden, as they are on
													the monthly view and in the export. They contributed zero either way.
												</p>
											)}
											{hasUncountedAccounts && (
												<p className="text-xs text-muted-foreground">
													This record was saved before snapshots were narrowed to the accounts
													actually counted. The others are still on the record, but they took no
													part in this assessment and are not shown as contributors.
												</p>
											)}
											<div className="max-h-40 space-y-1 overflow-y-auto text-sm">
												{shownAccounts.map((account, idx) => (
													<div key={idx} className="flex items-center justify-between">
														<div className="flex items-center gap-2">
															<span>{account.accountTitle}</span>
															<span className="text-xs text-muted-foreground">
																{account.currency}
															</span>
															{account.accountType === "liability" && (
																<span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] text-destructive">
																	Liability
																</span>
															)}
														</div>
														<CurrencyAmount
															amount={account.balance}
															currency={account.currency}
															className="font-normal tracking-normal"
														/>
													</div>
												))}
											</div>
										</div>
									</div>

									{/* Actions */}
									<div className="mt-4 flex justify-end gap-2 border-t pt-3">
										<Button
											size="sm"
											variant="ghost"
											onClick={() => void handleDelete(calc.id)}
											className="text-destructive hover:text-destructive">
											<Trash2 className="mr-1.5 h-3.5 w-3.5" />
											Delete
										</Button>
									</div>
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

/** A quiet confirmation when the year still recomputes the same, a flag when it does not. */
function ZakatSnapshotBadge({ audit }: { audit: ZakatSnapshotAudit | undefined }) {
	if (!audit || audit.status === "unchecked") {
		return (
			<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
				Checking against current data...
			</span>
		);
	}

	if (audit.status === "matches") {
		return (
			<span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
				<ShieldCheck className="h-3 w-3" />
				Matches current data
			</span>
		);
	}

	return (
		<span className="flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-200">
			<AlertTriangle className="h-3 w-3" />
			Differs from current data
		</span>
	);
}

/**
 * Saved against current, figure by figure. Both are shown: the record stands, and what
 * the books now say stands beside it, so the owner can see what changed and by how much.
 */
function ZakatSnapshotComparison({
	audit,
	currency,
}: {
	audit: ZakatSnapshotAudit | undefined;
	currency: string;
}) {
	if (!audit || audit.status === "unchecked") return null;

	if (audit.status === "matches") {
		return (
			<p className="mb-4 flex items-center gap-1.5 text-xs text-muted-foreground">
				<ShieldCheck className="h-3.5 w-3.5" />
				Recomputing this year from today&apos;s data gives the same figures.
			</p>
		);
	}

	return (
		<div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
			<p className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-200">
				<AlertTriangle className="h-3.5 w-3.5" />
				This year now recomputes differently
			</p>
			<p className="mt-1 text-xs text-muted-foreground">
				The record is what was assessed on the day it was saved, and it has not changed. The data it
				was assessed from has. Carry-forward follows today&apos;s data.
			</p>
			<div className="mt-2 space-y-1 text-sm">
				{audit.differences.map((figure) => (
					<div key={figure.key} className="flex flex-wrap items-baseline justify-between gap-x-2">
						<span className="text-muted-foreground">{figure.label}</span>
						<span className="tabular-nums">
							<span className="text-muted-foreground">Saved </span>
							<CurrencyAmount
								amount={figure.saved}
								currency={currency}
								showNegativeSign
								className="font-normal tracking-normal"
							/>
							<span className="text-muted-foreground"> • Now </span>
							<CurrencyAmount
								amount={figure.current}
								currency={currency}
								showNegativeSign
								className="font-medium tracking-normal"
							/>
							<span className="text-muted-foreground">
								{" "}
								({figure.delta > 0 ? "+" : "-"}
								<CurrencyAmount
									amount={Math.abs(figure.delta)}
									currency={currency}
									className="font-normal tracking-normal"
								/>
								)
							</span>
						</span>
					</div>
				))}
			</div>
		</div>
	);
}
