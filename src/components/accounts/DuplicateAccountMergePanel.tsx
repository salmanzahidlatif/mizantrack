"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
	loadDuplicateAccountGroups,
	mergeDuplicateAccounts,
	type DuplicateAccountGroup,
} from "@/components/accounts/duplicateAccountMerge";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { getCurrencyByCode } from "@/lib/currencies";

interface DuplicateAccountMergePanelProps {
	userId: string;
	currency?: string;
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
	return `${count} ${count === 1 ? singular : plural}`;
}

function getDefaultSurvivorId(group: DuplicateAccountGroup): string {
	const [firstCandidate, ...remainingCandidates] = group.candidates;
	if (!firstCandidate) return "";

	const defaultCandidate = remainingCandidates.reduce(
		(best, candidate) => (candidate.transactionCount > best.transactionCount ? candidate : best),
		firstCandidate
	);
	return defaultCandidate.account.id;
}

function getCandidateLabel(group: DuplicateAccountGroup, accountId: string): string {
	const candidate = group.candidates.find((item) => item.account.id === accountId);
	if (!candidate) return "selected account";
	return `"${candidate.account.title}"`;
}

function getLoserStats(group: DuplicateAccountGroup, survivorId: string) {
	const losers = group.candidates.filter((candidate) => candidate.account.id !== survivorId);
	const transactionIds = new Set<string>();
	for (const loser of losers) {
		for (const transactionId of loser.transactionIds) transactionIds.add(transactionId);
	}

	return {
		loserCount: losers.length,
		transactionCount: transactionIds.size,
		openingBalance: losers.reduce(
			(total, candidate) => total + (candidate.account.openingBalance ?? 0),
			0
		),
	};
}

export function DuplicateAccountMergePanel({ userId, currency }: DuplicateAccountMergePanelProps) {
	const groups = useLiveQuery(() => loadDuplicateAccountGroups(userId), [userId]);
	const [selectedSurvivors, setSelectedSurvivors] = useState<Record<string, string>>({});
	const [confirmingGroup, setConfirmingGroup] = useState<DuplicateAccountGroup | null>(null);
	const [merging, setMerging] = useState(false);
	const scopedCurrency = normalizeCurrencyCode(currency);
	const visibleGroups = scopedCurrency
		? groups?.filter((group) => normalizeCurrencyCode(group.currency) === scopedCurrency)
		: groups;

	function getSelectedSurvivorId(group: DuplicateAccountGroup): string {
		return selectedSurvivors[group.key] ?? getDefaultSurvivorId(group);
	}

	function selectSurvivor(group: DuplicateAccountGroup, accountId: string) {
		setSelectedSurvivors((current) => ({ ...current, [group.key]: accountId }));
	}

	async function handleConfirmMerge() {
		if (!confirmingGroup) return;

		const survivorId = getSelectedSurvivorId(confirmingGroup);
		const loserIds = confirmingGroup.candidates
			.map((candidate) => candidate.account.id)
			.filter((accountId) => accountId !== survivorId);

		setMerging(true);
		try {
			const result = await mergeDuplicateAccounts(userId, survivorId, loserIds);
			toast.success(
				`Merged ${formatCount(result.softDeletedAccounts, "duplicate")} and updated ${formatCount(
					result.movedTransactions + result.movedTransferLegs,
					"account reference"
				)}.`
			);
			if (result.selfTransfersCreated > 0) {
				toast.info(
					`${formatCount(
						result.selfTransfersCreated,
						"transfer"
					)} now move within one account and net to zero. Review them if needed.`
				);
			}
			setConfirmingGroup(null);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to merge duplicate accounts.");
		} finally {
			setMerging(false);
		}
	}

	if (groups === undefined || visibleGroups === undefined) {
		return (
			<div className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">
				Checking for duplicate accounts…
			</div>
		);
	}

	return (
		<div className="space-y-3 rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
			<div className="space-y-1">
				<div className="flex items-center justify-between gap-3">
					<h2 className="font-semibold">Duplicate Accounts</h2>
					<Badge variant={visibleGroups.length > 0 ? "default" : "outline"}>
						{formatCount(visibleGroups.length, "group")}
					</Badge>
				</div>
				<p className="text-sm text-muted-foreground">
					Finds same-title duplicates only inside the same currency. Accounts without a currency and
					soft-deleted records are left alone.
				</p>
			</div>

			{visibleGroups.length === 0 ? (
				<p className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
					No same-currency duplicate accounts found{scopedCurrency ? ` for ${scopedCurrency}` : ""}.
				</p>
			) : (
				<div className="space-y-3">
					{visibleGroups.map((group) => {
						const currencyEntry = getCurrencyByCode(group.currency);
						const selectedSurvivorId = getSelectedSurvivorId(group);

						return (
							<div key={group.key} className="space-y-3 rounded-xl border border-border/70 p-3">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div>
										<div className="flex flex-wrap items-center gap-2 font-medium">
											<span>{group.normalizedTitle}</span>
											<Badge variant="outline">
												{currencyEntry?.flag ?? "🌐"} {group.currency}
											</Badge>
										</div>
										<div className="text-xs text-muted-foreground">
											{formatCount(group.activeTransactionCount, "transaction")} and{" "}
											{formatCount(group.totalTransactionCount, "account reference")} across this
											group
										</div>
									</div>
									<Button
										size="sm"
										onClick={() => setConfirmingGroup(group)}
										disabled={!selectedSurvivorId || merging}>
										Review merge
									</Button>
								</div>

								<div className="space-y-2">
									{group.candidates.map((candidate) => {
										const account = candidate.account;
										const selected = selectedSurvivorId === account.id;

										return (
											<button
												key={account.id}
												type="button"
												onClick={() => selectSurvivor(group, account.id)}
												aria-pressed={selected}
												className={`w-full rounded-lg border p-3 text-left transition-colors ${
													selected
														? "border-primary bg-primary/5"
														: "border-border/70 bg-background hover:bg-muted/50"
												}`}>
												<div className="flex flex-wrap items-center justify-between gap-2">
													<div className="font-medium">{account.title}</div>
													<div className="flex flex-wrap items-center gap-1.5">
														{candidate.isArchived && <Badge variant="secondary">Archived</Badge>}
														<Badge variant={selected ? "default" : "outline"}>
															{selected ? "Survivor" : "Duplicate"}
														</Badge>
													</div>
												</div>
												<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
													<span>{formatCount(candidate.transactionCount, "transaction")}</span>
													<span className="flex items-center gap-1">
														Opening
														<CurrencyAmount
															amount={candidate.openingBalance}
															currency={group.currency}
															showNegativeSign
															className="text-xs"
														/>
													</span>
												</div>
											</button>
										);
									})}
								</div>
							</div>
						);
					})}
				</div>
			)}

			<Dialog
				open={confirmingGroup !== null}
				onOpenChange={(open) => {
					if (!open && !merging) setConfirmingGroup(null);
				}}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>Merge duplicate accounts?</DialogTitle>
						<DialogDescription>
							This moves both transaction account references and transfer destination references to
							the survivor, absorbs loser opening balances, and soft-deletes the losing accounts.
						</DialogDescription>
					</DialogHeader>
					{confirmingGroup && (
						<div className="space-y-2 text-sm">
							<p>
								Survivor:{" "}
								<span className="font-medium">
									{getCandidateLabel(confirmingGroup, getSelectedSurvivorId(confirmingGroup))}
								</span>
							</p>
							<p>
								Currency: <span className="font-medium">{confirmingGroup.currency}</span>
							</p>
							<p className="text-muted-foreground">
								This will move{" "}
								{formatCount(
									getLoserStats(confirmingGroup, getSelectedSurvivorId(confirmingGroup))
										.transactionCount,
									"transaction"
								)}
								{", absorb "}
								<CurrencyAmount
									amount={
										getLoserStats(confirmingGroup, getSelectedSurvivorId(confirmingGroup))
											.openingBalance
									}
									currency={confirmingGroup.currency}
									showNegativeSign
									className="text-sm"
								/>{" "}
								in opening balances, and remove{" "}
								{formatCount(
									getLoserStats(confirmingGroup, getSelectedSurvivorId(confirmingGroup)).loserCount,
									"duplicate account"
								)}{" "}
								from active lists. Losers are soft-deleted, not hard-deleted.
							</p>
						</div>
					)}
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirmingGroup(null)} disabled={merging}>
							Cancel
						</Button>
						<Button onClick={() => void handleConfirmMerge()} disabled={merging}>
							{merging ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
							Merge into selected account
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
