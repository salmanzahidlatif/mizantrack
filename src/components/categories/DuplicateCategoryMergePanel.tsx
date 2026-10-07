"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
	mergeDuplicateCategories,
	loadDuplicateCategoryGroups,
	type DuplicateCategoryGroup,
} from "@/components/categories/duplicateCategoryMerge";
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
import { getCurrencyByCode } from "@/lib/currencies";

interface DuplicateCategoryMergePanelProps {
	userId: string;
}

function formatCount(count: number, singular: string, plural = `${singular}s`) {
	return `${count} ${count === 1 ? singular : plural}`;
}

function getCandidateLabel(group: DuplicateCategoryGroup, categoryId: string): string {
	const candidate = group.candidates.find((item) => item.category.id === categoryId);
	if (!candidate) return "selected category";
	return `"${candidate.category.title}"`;
}

export function DuplicateCategoryMergePanel({ userId }: DuplicateCategoryMergePanelProps) {
	const groups = useLiveQuery(() => loadDuplicateCategoryGroups(userId), [userId]);
	const [selectedSurvivors, setSelectedSurvivors] = useState<Record<string, string>>({});
	const [confirmingGroup, setConfirmingGroup] = useState<DuplicateCategoryGroup | null>(null);
	const [merging, setMerging] = useState(false);

	function getSelectedSurvivorId(group: DuplicateCategoryGroup): string {
		return selectedSurvivors[group.key] ?? group.candidates[0]?.category.id ?? "";
	}

	function selectSurvivor(group: DuplicateCategoryGroup, categoryId: string) {
		setSelectedSurvivors((current) => ({ ...current, [group.key]: categoryId }));
	}

	async function handleConfirmMerge() {
		if (!confirmingGroup) return;

		const survivorId = getSelectedSurvivorId(confirmingGroup);
		const loserIds = confirmingGroup.candidates
			.map((candidate) => candidate.category.id)
			.filter((categoryId) => categoryId !== survivorId);

		setMerging(true);
		try {
			const result = await mergeDuplicateCategories(userId, survivorId, loserIds);
			toast.success(
				`Merged ${formatCount(result.softDeletedCategories, "duplicate")} and moved ${formatCount(
					result.movedTransactions,
					"transaction"
				)}.`
			);
			setConfirmingGroup(null);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to merge duplicate categories.");
		} finally {
			setMerging(false);
		}
	}

	if (groups === undefined) {
		return (
			<div className="rounded-xl border border-border/60 bg-card p-4 text-sm text-muted-foreground">
				Checking for duplicate categories…
			</div>
		);
	}

	return (
		<div className="space-y-3 rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
			<div className="space-y-1">
				<div className="flex items-center justify-between gap-3">
					<h2 className="font-semibold">Duplicate Categories</h2>
					<Badge variant={groups.length > 0 ? "default" : "outline"}>
						{formatCount(groups.length, "group")}
					</Badge>
				</div>
				<p className="text-sm text-muted-foreground">
					Finds same-title duplicates only inside the same currency and type. Shared categories are
					left alone.
				</p>
			</div>

			{groups.length === 0 ? (
				<p className="rounded-lg border border-border/60 bg-muted/30 p-3 text-sm text-muted-foreground">
					No same-currency duplicate categories found.
				</p>
			) : (
				<div className="space-y-3">
					{groups.map((group) => {
						const currency = getCurrencyByCode(group.currency);
						const selectedSurvivorId = getSelectedSurvivorId(group);

						return (
							<div key={group.key} className="space-y-3 rounded-xl border border-border/70 p-3">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div>
										<div className="font-medium">
											{group.normalizedTitle} · {group.type}
										</div>
										<div className="text-xs text-muted-foreground">
											{currency?.flag ?? "🌐"} {group.currency} ·{" "}
											{formatCount(group.totalTransactionCount, "transaction")} across this group
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
										const category = candidate.category;
										const selected = selectedSurvivorId === category.id;

										return (
											<button
												key={category.id}
												type="button"
												onClick={() => selectSurvivor(group, category.id)}
												className={`w-full rounded-lg border p-3 text-left transition-colors ${
													selected
														? "border-primary bg-primary/5"
														: "border-border/70 bg-background hover:bg-muted/50"
												}`}>
												<div className="flex flex-wrap items-center justify-between gap-2">
													<div className="font-medium">{category.title}</div>
													<Badge variant={selected ? "default" : "outline"}>
														{selected ? "Survivor" : "Duplicate"}
													</Badge>
												</div>
												<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
													<span>
														{currency?.flag ?? "🌐"} {group.currency}
													</span>
													<span>{formatCount(candidate.transactionCount, "transaction")}</span>
													<span>
														{formatCount(
															candidate.childCount,
															"child category",
															"child categories"
														)}
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
						<DialogTitle>Merge duplicate categories?</DialogTitle>
						<DialogDescription>
							This moves every transaction in the duplicate group to the survivor, reparents child
							categories, and soft-deletes the losing categories for sync.
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
							<p className="text-muted-foreground">
								Losers will not be hard-deleted. Their transactions will move first so analytics
								keep the same totals.
							</p>
						</div>
					)}
					<DialogFooter>
						<Button variant="outline" onClick={() => setConfirmingGroup(null)} disabled={merging}>
							Cancel
						</Button>
						<Button onClick={() => void handleConfirmMerge()} disabled={merging}>
							{merging ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
							Merge into selected category
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
