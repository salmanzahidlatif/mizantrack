"use client";

import { format } from "date-fns";
import { CalendarIcon, Lock, RotateCcw, Unlock } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CARD_SURFACE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import {
	clearZakatGoldYear,
	clearZakatGoldYearGrams,
	saveZakatGoldYearGrams,
	saveZakatGoldYearPrices,
	ZAKAT_GOLD_PURITIES,
} from "@/lib/zakatGoldYearRepository";

import type { GoldPurity } from "@/types";

interface ZakatGoldYearPricingProps {
	userId: string;
	/** The single currency this year is priced in. Never converted. */
	currency: string;
	islamicYear: number;
	/** Label for the sheet this year maps to, e.g. "2024 (1444–1445)". */
	yearLabel: string;
	/** Prices saved for THIS year. Empty until the owner types them. */
	pricesByPurity: Partial<Record<GoldPurity, number>>;
	/** Grams this year is assessed on: the pinned snapshot, else today's inventory. */
	gramsByPurity: Map<GoldPurity, number>;
	/** Grams the inventory holds today, for comparison against a pinned snapshot. */
	inventoryGramsByPurity: Map<GoldPurity, number>;
	/** True when the year's grams were pinned rather than read from the inventory. */
	hasGramsSnapshot: boolean;
	/** Date the prices were taken on; the sheet prices gold at 1 Ramaḍān. */
	priceDate: Date;
	/** `grams × price per gram`, summed over the karats, for this year. */
	goldValue: number;
}

function formatInputAmount(amount: number | undefined): string {
	if (amount === undefined || !Number.isFinite(amount) || amount === 0) return "";
	return String(Number(amount.toFixed(4)));
}

function toDraftPrices(prices: Partial<Record<GoldPurity, number>>): Record<GoldPurity, string> {
	return Object.fromEntries(
		ZAKAT_GOLD_PURITIES.map((purity) => [purity, formatInputAmount(prices[purity])])
	) as Record<GoldPurity, string>;
}

function parseDraftPrices(draft: Record<GoldPurity, string>): Partial<Record<GoldPurity, number>> {
	const parsed: Partial<Record<GoldPurity, number>> = {};
	for (const purity of ZAKAT_GOLD_PURITIES) {
		const raw = draft[purity].trim();
		if (raw === "") continue;
		const value = Number(raw);
		if (!Number.isFinite(value) || value <= 0) continue;
		parsed[purity] = value;
	}
	return parsed;
}

/**
 * The gold price for ONE zakat year, in the selected currency.
 *
 * The weight barely moves between years while the price always does — the owner's sheet
 * carried 170.52 g of 21k from 2021 to 2024 at four different prices — so the inventory
 * is shared and only the price belongs to the year. A year whose holding genuinely
 * differed can pin its own grams, after which editing the inventory no longer rewrites it.
 */
export function ZakatGoldYearPricing({
	userId,
	currency,
	islamicYear,
	yearLabel,
	pricesByPurity,
	gramsByPurity,
	inventoryGramsByPurity,
	hasGramsSnapshot,
	priceDate,
	goldValue,
}: ZakatGoldYearPricingProps) {
	const [draft, setDraft] = useState(() => toDraftPrices(pricesByPurity));
	const [draftDate, setDraftDate] = useState(priceDate);
	const [calendarOpen, setCalendarOpen] = useState(false);
	const [saving, setSaving] = useState(false);

	// Switching year, or a pull from another device, replaces the draft outright: a price
	// typed for one year must never leak into the next.
	useEffect(() => {
		setDraft(toDraftPrices(pricesByPurity));
	}, [islamicYear, pricesByPurity]);

	useEffect(() => {
		setDraftDate(priceDate);
	}, [islamicYear, priceDate]);

	const parsedDraft = parseDraftPrices(draft);
	const isDirty =
		JSON.stringify(parsedDraft) !== JSON.stringify(pricesByPurity) ||
		draftDate.getTime() !== priceDate.getTime();
	const isPriced = Object.keys(pricesByPurity).length > 0;

	async function handleSave() {
		setSaving(true);
		try {
			await saveZakatGoldYearPrices({
				userId,
				currency,
				islamicYear,
				pricesByPurity: parsedDraft,
				priceDate: draftDate.getTime(),
			});
			toast.success(`Gold price saved for ${yearLabel}.`);
		} catch (error) {
			console.error("Failed to save the year's gold price", error);
			toast.error("Could not save the gold price.");
		} finally {
			setSaving(false);
		}
	}

	async function handleReset() {
		setSaving(true);
		try {
			await clearZakatGoldYear(userId, currency, islamicYear);
			toast.success(`Gold price cleared for ${yearLabel}.`);
		} catch (error) {
			console.error("Failed to clear the year's gold price", error);
			toast.error("Could not clear the gold price.");
		} finally {
			setSaving(false);
		}
	}

	async function handleToggleGramsSnapshot() {
		setSaving(true);
		try {
			if (hasGramsSnapshot) {
				await clearZakatGoldYearGrams(userId, currency, islamicYear);
				toast.success(`${yearLabel} follows the gold inventory again.`);
			} else {
				await saveZakatGoldYearGrams({
					userId,
					currency,
					islamicYear,
					gramsByPurity: inventoryGramsByPurity,
				});
				toast.success(`Weight pinned for ${yearLabel}.`);
			}
		} catch (error) {
			console.error("Failed to change the year's gold weight", error);
			toast.error("Could not change the gold weight for this year.");
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className={cn(CARD_SURFACE, "space-y-3 p-4")}>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<h3 className="text-sm font-medium">Gold Price per gram ({currency})</h3>
					<p className="text-xs text-muted-foreground">
						One price per karat for {yearLabel}, in {currency}. Each year keeps its own price — the
						same weight is worth something different every year.
					</p>
				</div>
				<Badge variant={isPriced ? "secondary" : "outline"}>
					{isPriced ? "Priced" : "Not priced yet"}
				</Badge>
			</div>

			<div className="grid gap-3 sm:grid-cols-3">
				{ZAKAT_GOLD_PURITIES.map((purity) => {
					const grams = gramsByPurity.get(purity) ?? 0;
					return (
						<div key={purity} className="space-y-1">
							<Label htmlFor={`gold-price-${purity}`} className="text-xs text-muted-foreground">
								{purity} price per gram
							</Label>
							<Input
								id={`gold-price-${purity}`}
								type="number"
								min={0}
								step="any"
								inputMode="decimal"
								disabled={saving}
								value={draft[purity]}
								onChange={(event) =>
									setDraft((previous) => ({ ...previous, [purity]: event.target.value }))
								}
								placeholder="0.00"
							/>
							<p className="text-xs text-muted-foreground tabular-nums">{grams.toFixed(2)}g held</p>
						</div>
					);
				})}
			</div>

			<div className="grid gap-3 sm:grid-cols-2">
				<div className="space-y-1.5">
					<Label>Priced on</Label>
					<Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
						<PopoverTrigger asChild>
							<Button
								variant="outline"
								disabled={saving}
								className="w-full justify-start font-normal">
								<CalendarIcon className="mr-2 h-4 w-4" />
								{format(draftDate, "d MMMM yyyy")}
							</Button>
						</PopoverTrigger>
						<PopoverContent className="w-auto p-0" align="start">
							<Calendar
								mode="single"
								selected={draftDate}
								defaultMonth={draftDate}
								onSelect={(date) => {
									if (!date) return;
									setDraftDate(date);
									setCalendarOpen(false);
								}}
							/>
						</PopoverContent>
					</Popover>
					<p className="text-xs text-muted-foreground">
						Defaults to 1 Ramaḍān, the day the owner&apos;s sheet prices gold.
					</p>
				</div>

				<div className="space-y-1.5">
					<Label>This year&apos;s gold value</Label>
					<p className="text-lg font-bold tabular-nums">
						<CurrencyAmount amount={goldValue} currency={currency} className="text-lg font-bold" />
					</p>
					<p className="text-xs text-muted-foreground">
						{hasGramsSnapshot
							? "Weight pinned to this year; the inventory no longer changes it."
							: "Weight follows the gold inventory below."}
					</p>
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-2 border-t pt-3">
				<Button variant="outline" disabled={saving || !isDirty} onClick={() => void handleSave()}>
					Save
				</Button>
				<Button variant="ghost" disabled={saving} onClick={() => void handleToggleGramsSnapshot()}>
					{hasGramsSnapshot ? (
						<Unlock className="mr-1.5 h-3.5 w-3.5" />
					) : (
						<Lock className="mr-1.5 h-3.5 w-3.5" />
					)}
					{hasGramsSnapshot ? "Follow inventory" : "Pin this year's weight"}
				</Button>
				{isPriced && (
					<Button
						variant="ghost"
						size="icon"
						disabled={saving}
						aria-label="Clear this year's gold price"
						onClick={() => void handleReset()}>
						<RotateCcw className="h-4 w-4" />
					</Button>
				)}
			</div>
		</div>
	);
}
