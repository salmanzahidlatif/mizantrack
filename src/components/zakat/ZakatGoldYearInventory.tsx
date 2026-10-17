"use client";

import { CopyPlus, Layers, Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";
import {
	applyZakatGoldYearItemsToRange,
	copyZakatGoldYearItems,
	deleteZakatGoldYearItem,
	ensureZakatGoldYearItems,
	saveZakatGoldYearItem,
	sumZakatGoldYearItemWeight,
} from "@/lib/zakatGoldYearItemRepository";
import { findZakatGoldYearItemsToInherit } from "@/lib/zakatGoldYearItems";
import { ZAKAT_GOLD_PURITIES } from "@/lib/zakatGoldYearRepository";

import type { GoldPurity, ZakatGoldYearItem } from "@/types";

interface ZakatGoldYearInventoryProps {
	userId: string;
	/** The single currency this year is priced in. Never converted. */
	currency: string;
	islamicYear: number;
	/** Label for the sheet this year maps to, e.g. "2024 (1444–1445)". */
	yearLabel: string;
	/** The pieces recorded for THIS year. */
	items: ZakatGoldYearItem[];
	/** Every year's pieces, so a fresh year can inherit and a range can be applied. */
	itemsByYear: Map<number, ZakatGoldYearItem[]>;
	/** The Islamic years the screen offers, oldest first. */
	availableIslamicYears: number[];
	/** Price per gram for each karat, for this year. */
	pricesByPurity: Partial<Record<GoldPurity, number>>;
}

interface GoldPieceDraft {
	title: string;
	weight: string;
	purity: GoldPurity;
}

function toDraft(item?: ZakatGoldYearItem): GoldPieceDraft {
	return {
		title: item?.title ?? "",
		weight: item ? String(item.weight) : "",
		purity: item?.purity ?? "21k",
	};
}

function parseDraftWeight(weight: string): number {
	const parsed = Number(weight.trim());
	return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The gold held in ONE zakat year.
 *
 * Holdings drift piece by piece: the owner's 168.4 g of 21k lost a 10 g piece and gained
 * a 14 g 22k piece years later. So each year owns its list, a year opened for the first
 * time inherits the previous year's rather than asking for it all again, and editing a
 * year touches nothing but that year — which is the whole point: recording today's sale
 * must not reach back and empty 2020.
 */
export function ZakatGoldYearInventory({
	userId,
	currency,
	islamicYear,
	yearLabel,
	items,
	itemsByYear,
	availableIslamicYears,
	pricesByPurity,
}: ZakatGoldYearInventoryProps) {
	const [isAdding, setIsAdding] = useState(false);
	const [editingLineageId, setEditingLineageId] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [rangeThroughYear, setRangeThroughYear] = useState<number>(islamicYear);
	// One inheritance attempt per year and currency: a year that genuinely holds nothing
	// must stay empty instead of being re-seeded on every render.
	const inheritedFor = useRef<string | null>(null);

	const inheritable = findZakatGoldYearItemsToInherit(itemsByYear, islamicYear);
	const totalGrams = sumZakatGoldYearItemWeight(items);
	const totalValue = items.reduce(
		(total, item) => total + item.weight * (pricesByPurity[item.purity] ?? 0),
		0
	);
	const laterYears = availableIslamicYears.filter((year) => year >= islamicYear);

	useEffect(() => {
		setEditingLineageId(null);
		setIsAdding(false);
		setRangeThroughYear(islamicYear);
	}, [islamicYear]);

	// A year with no holding yet inherits the previous year's. Most pieces carry over
	// untouched, so asking the owner to retype them is how a holding loses a piece.
	useEffect(() => {
		const key = `${currency}:${islamicYear}`;
		if (items.length > 0 || inheritedFor.current === key) return;
		inheritedFor.current = key;

		void ensureZakatGoldYearItems({ userId, currency, islamicYear }).catch((error: unknown) => {
			console.error("Failed to open the year's gold holding", error);
		});
	}, [currency, islamicYear, items.length, userId]);

	async function handleSavePiece(lineageId: string | undefined, draft: GoldPieceDraft) {
		const weight = parseDraftWeight(draft.weight);
		if (!draft.title.trim() || weight <= 0) return;

		setSaving(true);
		try {
			await saveZakatGoldYearItem({
				userId,
				currency,
				islamicYear,
				lineageId,
				title: draft.title,
				weight,
				purity: draft.purity,
			});
			setIsAdding(false);
			setEditingLineageId(null);
		} catch (error) {
			console.error("Failed to save the gold piece", error);
			toast.error("Could not save this gold item.");
		} finally {
			setSaving(false);
		}
	}

	async function handleDeletePiece(item: ZakatGoldYearItem) {
		setSaving(true);
		try {
			await deleteZakatGoldYearItem(userId, currency, islamicYear, item.lineageId);
			toast.success(`${item.title} removed from ${yearLabel}. Earlier years keep it.`);
		} catch (error) {
			console.error("Failed to remove the gold piece", error);
			toast.error("Could not remove this gold item.");
		} finally {
			setSaving(false);
		}
	}

	async function handleInherit() {
		if (!inheritable) return;

		setSaving(true);
		try {
			await copyZakatGoldYearItems({
				userId,
				currency,
				fromIslamicYear: inheritable.islamicYear,
				toIslamicYear: islamicYear,
			});
			toast.success(`${yearLabel} now holds what ${inheritable.islamicYear} held.`);
		} catch (error) {
			console.error("Failed to carry the previous year's gold forward", error);
			toast.error("Could not copy the previous year's gold.");
		} finally {
			setSaving(false);
		}
	}

	async function handleApplyRange() {
		setSaving(true);
		try {
			const applied = await applyZakatGoldYearItemsToRange({
				userId,
				currency,
				sourceIslamicYear: islamicYear,
				fromIslamicYear: islamicYear,
				throughIslamicYear: rangeThroughYear,
			});
			toast.success(
				applied.length > 1
					? `This holding now applies to ${applied.length} years, ${applied[0]}–${applied[applied.length - 1]}.`
					: `This holding applies to ${islamicYear} only.`
			);
		} catch (error) {
			console.error("Failed to apply the holding across the years", error);
			toast.error("Could not apply this holding to those years.");
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className={cn(CARD_SURFACE, "space-y-3 p-4")}>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<h3 className="text-sm font-medium">Gold held • {yearLabel}</h3>
					<p className="text-xs text-muted-foreground">
						The pieces held in this zakat year. Selling one here leaves every earlier year exactly
						as it was.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Badge variant={items.length > 0 ? "secondary" : "outline"}>
						{items.length > 0 ? `${items.length} item${items.length === 1 ? "" : "s"}` : "No gold"}
					</Badge>
					<Button size="sm" variant="outline" disabled={saving} onClick={() => setIsAdding(true)}>
						<Plus className="mr-1.5 h-3.5 w-3.5" />
						Add item
					</Button>
				</div>
			</div>

			<div className="grid grid-cols-2 gap-3 rounded-lg border bg-card p-3">
				<div>
					<p className="text-xs text-muted-foreground">Total this year</p>
					<p className="text-lg font-bold tabular-nums">{totalGrams.toFixed(2)}g</p>
				</div>
				<div>
					<p className="text-xs text-muted-foreground">Value at this year&apos;s price</p>
					<p className="text-lg font-bold tabular-nums">
						<CurrencyAmount amount={totalValue} currency={currency} className="text-lg font-bold" />
					</p>
				</div>
			</div>

			{isAdding && (
				<GoldPieceForm
					saving={saving}
					onSave={(draft) => void handleSavePiece(undefined, draft)}
					onCancel={() => setIsAdding(false)}
				/>
			)}

			<div className="space-y-2">
				{items.map((item) =>
					editingLineageId === item.lineageId ? (
						<GoldPieceForm
							key={item.lineageId}
							item={item}
							saving={saving}
							onSave={(draft) => void handleSavePiece(item.lineageId, draft)}
							onCancel={() => setEditingLineageId(null)}
						/>
					) : (
						<div
							key={item.lineageId}
							className="flex items-center justify-between rounded-lg border bg-card p-3 text-sm">
							<button
								type="button"
								className="flex-1 text-left"
								disabled={saving}
								onClick={() => setEditingLineageId(item.lineageId)}>
								<span className="flex items-center gap-2">
									<span className="font-medium">{item.title}</span>
									<span className="rounded bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
										{item.purity}
									</span>
								</span>
								<span className="block text-xs text-muted-foreground">
									{item.weight}g {item.purity} ={" "}
									<CurrencyAmount
										amount={item.weight * (pricesByPurity[item.purity] ?? 0)}
										currency={currency}
										className="font-normal tracking-normal"
									/>
								</span>
							</button>
							<Button
								size="sm"
								variant="ghost"
								disabled={saving}
								aria-label={`Remove ${item.title} from ${yearLabel}`}
								onClick={() => void handleDeletePiece(item)}
								className="h-8 w-8 p-0 text-destructive hover:text-destructive">
								<Trash2 className="h-3.5 w-3.5" />
							</Button>
						</div>
					)
				)}

				{items.length === 0 && !isAdding && (
					<p className="py-6 text-center text-sm text-muted-foreground">
						No gold recorded for {yearLabel}. This year is valued at zero rather than borrowing
						another year&apos;s holding.
					</p>
				)}
			</div>

			<div className="flex flex-wrap items-end gap-3 border-t pt-3">
				{inheritable && (
					<Button variant="ghost" disabled={saving} onClick={() => void handleInherit()}>
						<CopyPlus className="mr-1.5 h-3.5 w-3.5" />
						Copy {inheritable.islamicYear}&apos;s gold here
					</Button>
				)}

				<div className="space-y-1.5">
					<Label htmlFor="zakat-gold-range" className="text-xs text-muted-foreground">
						Apply this holding through
					</Label>
					<div className="flex items-center gap-2">
						<Select
							value={String(rangeThroughYear)}
							onValueChange={(value) => setRangeThroughYear(Number(value))}>
							<SelectTrigger id="zakat-gold-range" className="w-[140px]">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{laterYears.map((year) => (
									<SelectItem key={year} value={String(year)}>
										{year}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<Button
							variant="outline"
							disabled={saving || items.length === 0}
							onClick={() => void handleApplyRange()}>
							<Layers className="mr-1.5 h-3.5 w-3.5" />
							Apply
						</Button>
					</div>
					<p className="text-xs text-muted-foreground">
						Sets every year from {islamicYear} to {rangeThroughYear} to this holding, so a piece
						held for years is stated once.
					</p>
				</div>
			</div>
		</div>
	);
}

interface GoldPieceFormProps {
	item?: ZakatGoldYearItem;
	saving: boolean;
	onSave: (draft: GoldPieceDraft) => void;
	onCancel: () => void;
}

function GoldPieceForm({ item, saving, onSave, onCancel }: GoldPieceFormProps) {
	const [draft, setDraft] = useState<GoldPieceDraft>(() => toDraft(item));

	function handleSubmit(event: React.FormEvent) {
		event.preventDefault();
		onSave(draft);
	}

	return (
		<form onSubmit={handleSubmit} className="space-y-3 rounded-lg border bg-accent/50 p-4">
			<div className="grid gap-3 sm:grid-cols-3">
				<div className="space-y-1">
					<Label className="text-xs">Item *</Label>
					<Input
						value={draft.title}
						disabled={saving}
						onChange={(event) =>
							setDraft((previous) => ({ ...previous, title: event.target.value }))
						}
						placeholder="e.g., Wedding Set"
						required
					/>
				</div>

				<div className="space-y-1">
					<Label className="text-xs">Weight (grams) *</Label>
					<Input
						type="number"
						min={0}
						step="any"
						inputMode="decimal"
						disabled={saving}
						value={draft.weight}
						onChange={(event) =>
							setDraft((previous) => ({ ...previous, weight: event.target.value }))
						}
						placeholder="0.00"
						required
					/>
				</div>

				<div className="space-y-1">
					<Label className="text-xs">Purity *</Label>
					<Select
						value={draft.purity}
						onValueChange={(value) =>
							setDraft((previous) => ({ ...previous, purity: value as GoldPurity }))
						}>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{ZAKAT_GOLD_PURITIES.map((purity) => (
								<SelectItem key={purity} value={purity}>
									{purity}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			<div className="flex justify-end gap-2">
				<Button type="button" size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
					<X className="mr-1.5 h-3.5 w-3.5" />
					Cancel
				</Button>
				<Button type="submit" size="sm" disabled={saving}>
					<Save className="mr-1.5 h-3.5 w-3.5" />
					Save
				</Button>
			</div>
		</form>
	);
}
