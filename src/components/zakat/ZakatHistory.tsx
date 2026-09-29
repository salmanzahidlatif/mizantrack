"use client";

import { format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { useState } from "react";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/db/local";

import type { ZakatCalculation } from "@/types";

interface ZakatHistoryProps {
	userId: string;
}

export function ZakatHistory({ userId }: ZakatHistoryProps) {
	const [expandedId, setExpandedId] = useState<string | null>(null);

	const calculations = useLiveQuery(
		() =>
			db.zakatCalculations
				.where("userId")
				.equals(userId)
				.filter((c) => !c.deletedAt)
				.reverse()
				.sortBy("assessmentDate"),
		[userId]
	);

	const payments = useLiveQuery(
		() =>
			db.zakatPayments
				.where("userId")
				.equals(userId)
				.filter((p) => !p.deletedAt)
				.toArray(),
		[userId]
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
					No zakat calculations saved yet. Complete a calculation to see it here.
				</p>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<div>
				<h3 className="text-sm font-medium">Zakat Calculation History</h3>
				<p className="text-xs text-muted-foreground">View your past zakat calculations</p>
			</div>

			<div className="space-y-2">
				{calculations.map((calc) => {
					const isExpanded = expandedId === calc.id;
					const paidAmount = getPaidAmount(calc);
					const remaining = Math.max(0, calc.zakatObligation - paidAmount);

					return (
						<div key={calc.id} className="overflow-hidden rounded-lg border bg-card">
							{/* Header */}
							<button
								type="button"
								onClick={() => setExpandedId(isExpanded ? null : calc.id)}
								className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-accent/50">
								<div className="flex-1">
									<div className="flex items-center gap-2">
										<span className="font-medium">Islamic Year {calc.islamicYear}</span>
										{calc.isLiable && (
											<span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
												Liable
											</span>
										)}
										{!calc.isLiable && (
											<span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
												Not Liable
											</span>
										)}
									</div>
									<p className="text-xs text-muted-foreground">
										Assessment: {format(new Date(calc.assessmentDate), "d MMM yyyy")}
									</p>
								</div>

								<div className="flex items-center gap-4">
									{calc.isLiable && (
										<div className="text-right">
											<CurrencyAmount
												amount={calc.zakatObligation}
												currency={calc.referenceCurrency}
												className="text-sm font-bold text-primary"
											/>
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
									)}

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
									<div className="grid gap-4 sm:grid-cols-2">
										{/* Configuration */}
										<div className="space-y-2">
											<h4 className="text-xs font-medium text-muted-foreground">Configuration</h4>
											<div className="space-y-1 text-sm">
												<div className="flex justify-between">
													<span className="text-muted-foreground">Nisab Standard:</span>
													<span className="capitalize">{calc.nisabStandard}</span>
												</div>
												<div className="flex justify-between">
													<span className="text-muted-foreground">Gold Price/gram:</span>
													<CurrencyAmount
														amount={calc.goldPricePerGram}
														currency="USD"
														className="font-normal tracking-normal"
													/>
												</div>
												{calc.silverPricePerGram && (
													<div className="flex justify-between">
														<span className="text-muted-foreground">Silver Price/gram:</span>
														<CurrencyAmount
															amount={calc.silverPricePerGram}
															currency="USD"
															className="font-normal tracking-normal"
														/>
													</div>
												)}
											</div>
										</div>

										{/* Results */}
										<div className="space-y-2">
											<h4 className="text-xs font-medium text-muted-foreground">Results</h4>
											<div className="space-y-1 text-sm">
												<div className="flex justify-between">
													<span className="text-muted-foreground">Total Zakatable:</span>
													<CurrencyAmount
														amount={calc.totalZakatable}
														currency={calc.referenceCurrency}
														className="font-normal tracking-normal"
													/>
												</div>
												<div className="flex justify-between">
													<span className="text-muted-foreground">Nisab Threshold:</span>
													<CurrencyAmount
														amount={calc.nisabThreshold}
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

										{/* Accounts */}
										<div className="space-y-2 sm:col-span-2">
											<h4 className="text-xs font-medium text-muted-foreground">
												Account Balances ({calc.accountBalances.length} accounts)
											</h4>
											<div className="max-h-40 space-y-1 overflow-y-auto text-sm">
												{calc.accountBalances
													.filter((a) => a.zakatable)
													.map((account, idx) => (
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
															<span className="tabular-nums">
																{account.balance.toLocaleString("en-US", {
																	maximumFractionDigits: 0,
																})}
															</span>
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
