"use client";

import { format } from "date-fns";
import { CalendarIcon, RotateCcw } from "lucide-react";
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
	/** Grams this year is assessed on, rolled up from the pieces IT held. */
	gramsByPurity: Map<GoldPurity, number>;
	/** Grams of silver saved for THIS year. Zero until the owner types a weight. */
	silverGrams: number;
	/** Price per gram of silver for THIS year, on the same date as the gold prices. */
	silverPricePerGram: number;
	/** Date the prices were taken on; the sheet prices gold at 1 Ramaḍān. */
	priceDate: Date;
	/** `grams × price per gram`, summed over the karats, for this year. */
	goldValue: number;
	/** `grams × price per gram` for this year's silver. Zero when it holds none. */
	silverValue: number;
	/** Basis + gold + silver: what this year's rate is actually taken from. */
	totalZakatable: number;
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

/** A typed figure, or undefined: anything that is not a positive number is not one. */
function parseDraftAmount(raw: string): number | undefined {
	const trimmed = raw.trim();
	if (trimmed === "") return undefined;
	const value = Number(trimmed);
	if (!Number.isFinite(value) || value <= 0) return undefined;
	return value;
}

/**
 * The gold and silver prices for ONE zakat year, in the selected currency.
 *
 * The price always belongs to the year — the owner's sheet carried 170.52 g of 21k from
 * 2021 to 2024 at four different prices — and so does the holding it is multiplied by.
 * Gold is edited piece by piece just below in `ZakatGoldYearInventory`; silver is one
 * weight at one price, typed right here, because that is how the owner keeps it.
 */
export function ZakatGoldYearPricing({
	userId,
	currency,
	islamicYear,
	yearLabel,
	pricesByPurity,
	gramsByPurity,
	silverGrams,
	silverPricePerGram,
	priceDate,
	goldValue,
	silverValue,
	totalZakatable,
}: ZakatGoldYearPricingProps) {
	const [draft, setDraft] = useState(() => toDraftPrices(pricesByPurity));
	const [draftSilverGrams, setDraftSilverGrams] = useState(() => formatInputAmount(silverGrams));
	const [draftSilverPrice, setDraftSilverPrice] = useState(() =>
		formatInputAmount(silverPricePerGram)
	);
	const [draftDate, setDraftDate] = useState(priceDate);
	const [calendarOpen, setCalendarOpen] = useState(false);
	const [saving, setSaving] = useState(false);

	// Switching year, or a pull from another device, replaces the draft outright: a price
	// typed for one year must never leak into the next.
	useEffect(() => {
		setDraft(toDraftPrices(pricesByPurity));
	}, [islamicYear, pricesByPurity]);

	useEffect(() => {
		setDraftSilverGrams(formatInputAmount(silverGrams));
	}, [islamicYear, silverGrams]);

	useEffect(() => {
		setDraftSilverPrice(formatInputAmount(silverPricePerGram));
	}, [islamicYear, silverPricePerGram]);

	useEffect(() => {
		setDraftDate(priceDate);
	}, [islamicYear, priceDate]);

	const parsedDraft = parseDraftPrices(draft);
	const parsedSilverGrams = parseDraftAmount(draftSilverGrams);
	const parsedSilverPrice = parseDraftAmount(draftSilverPrice);
	const isDirty =
		JSON.stringify(parsedDraft) !== JSON.stringify(pricesByPurity) ||
		(parsedSilverGrams ?? 0) !== silverGrams ||
		(parsedSilverPrice ?? 0) !== silverPricePerGram ||
		draftDate.getTime() !== priceDate.getTime();
	const isPriced = Object.keys(pricesByPurity).length > 0 || silverPricePerGram > 0;
	// Weight is always required for silver: a price with no weight is worth nothing, and
	// saying so here is kinder than silently contributing zero to the year.
	const silverNeedsWeight = parsedSilverPrice !== undefined && parsedSilverGrams === undefined;
	const totalGoldGrams = [...gramsByPurity.values()].reduce((sum, grams) => sum + grams, 0);

	async function handleSave() {
		setSaving(true);
		try {
			await saveZakatGoldYearPrices({
				userId,
				currency,
				islamicYear,
				pricesByPurity: parsedDraft,
				priceDate: draftDate.getTime(),
				silverGrams: parsedSilverGrams,
				silverPricePerGram: parsedSilverPrice,
			});
			toast.success(`Gold and silver prices saved for ${yearLabel}.`);
		} catch (error) {
			console.error("Failed to save the year's metal prices", error);
			toast.error("Could not save the prices.");
		} finally {
			setSaving(false);
		}
	}

	async function handleReset() {
		setSaving(true);
		try {
			await clearZakatGoldYear(userId, currency, islamicYear);
			toast.success(`Gold and silver prices cleared for ${yearLabel}.`);
		} catch (error) {
			console.error("Failed to clear the year's metal prices", error);
			toast.error("Could not clear the prices.");
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className={cn(CARD_SURFACE, "space-y-3 p-4")}>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<h3 className="text-sm font-medium">Gold / Silver price per gram ({currency})</h3>
					<p className="text-xs text-muted-foreground">
						One price per karat of gold, plus the silver this year held, for {yearLabel}, in{" "}
						{currency}. Each year keeps its own prices — the same weight is worth something
						different every year.
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

			{/* Silver: one weight, one price, for this year alone. Not itemised like gold. */}
			<div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
				<div className="space-y-1">
					<Label htmlFor="silver-grams" className="text-xs text-muted-foreground">
						Silver held (grams)
					</Label>
					<Input
						id="silver-grams"
						type="number"
						min={0}
						step="any"
						inputMode="decimal"
						disabled={saving}
						value={draftSilverGrams}
						onChange={(event) => setDraftSilverGrams(event.target.value)}
						placeholder="0.00"
					/>
				</div>
				<div className="space-y-1">
					<Label htmlFor="silver-price" className="text-xs text-muted-foreground">
						Silver price per gram
					</Label>
					<Input
						id="silver-price"
						type="number"
						min={0}
						step="any"
						inputMode="decimal"
						disabled={saving}
						value={draftSilverPrice}
						onChange={(event) => setDraftSilverPrice(event.target.value)}
						placeholder="0.00"
					/>
				</div>
				{silverNeedsWeight && (
					<p className="text-xs text-destructive sm:col-span-2">
						Enter the silver weight too — a price on its own adds nothing to this year.
					</p>
				)}
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
						Defaults to 1 Ramaḍān, the day the owner&apos;s sheet prices gold. Silver is priced on
						the same day.
					</p>
				</div>

				<div className="space-y-1.5">
					<Label>This year&apos;s metals</Label>
					<div className="space-y-1 text-sm">
						<div className="flex justify-between">
							<span className="text-muted-foreground tabular-nums">
								Gold • {totalGoldGrams.toFixed(2)}g
							</span>
							<CurrencyAmount amount={goldValue} currency={currency} className="font-medium" />
						</div>
						<div className="flex justify-between">
							<span className="text-muted-foreground tabular-nums">
								Silver • {silverGrams.toFixed(2)}g
							</span>
							<CurrencyAmount amount={silverValue} currency={currency} className="font-medium" />
						</div>
						<div className="flex justify-between border-t pt-1">
							<span className="font-medium">Total for {yearLabel}</span>
							<CurrencyAmount
								amount={totalZakatable}
								currency={currency}
								showNegativeSign
								className="font-bold"
							/>
						</div>
					</div>
					<p className="text-xs text-muted-foreground">
						The pieces listed below plus this year&apos;s silver, at the prices typed above, on top
						of the accounts basis. All of it belongs to this year alone.
					</p>
				</div>
			</div>

			<div className="flex flex-wrap items-center gap-2 border-t pt-3">
				<Button variant="outline" disabled={saving || !isDirty} onClick={() => void handleSave()}>
					Save
				</Button>
				{isPriced && (
					<Button
						variant="ghost"
						size="icon"
						disabled={saving}
						aria-label="Clear this year's gold and silver prices"
						onClick={() => void handleReset()}>
						<RotateCcw className="h-4 w-4" />
					</Button>
				)}
			</div>
		</div>
	);
}
