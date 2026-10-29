/**
 * Persistence for the gold inputs that belong to ONE zakat year.
 *
 * The owner's workbook carried the same 170.52 g of 21k gold from `2021` to `2024` and
 * repriced it every year: 8,427 → 10,725 → 16,778.12 → 18,846.3 per gram. The price is
 * the thing that belongs to the year, and it still lives here, per user, per currency,
 * per Islamic year.
 *
 * The HOLDING now belongs to the year as well, itemised in `zakatGoldYearItems`, because
 * pieces are sold and bought one at a time: a 10 g piece of the 21k left and a 14 g 22k
 * piece arrived years later, and the years before that must keep reporting what was
 * actually held then. See `@/lib/zakatGoldYearItemRepository`.
 *
 * `gramsByPurity` is what pinned a year before items existed. It is kept — never written
 * for a year that has items — so a year the owner pinned under the old model reads back
 * exactly as it did, and is honoured below an itemised list and above the shared
 * inventory.
 *
 * Silver rides on the same row, deliberately as ONE weight at ONE price per gram. It is
 * not itemised and never will be: the owner keeps silver as a single line he retypes
 * each year, priced on the same date as that year's gold.
 */

import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { db } from "@/lib/db/local";
import { calculateSilverValue } from "@/lib/zakatEngine";
import { getZakatGoldYearItems, hasZakatGoldYearItemInventory } from "@/lib/zakatGoldYearItems";

import type { SilverHoldingInput } from "@/lib/zakatEngine";
import type { GoldItem, GoldPurity, ZakatGoldYear, ZakatGoldYearItem } from "@/types";

/** The karats the screen prices. 21k and 22k are the two the owner actually holds. */
export const ZAKAT_GOLD_PURITIES: GoldPurity[] = ["21k", "22k", "24k"];

export function buildZakatGoldYearId(
	userId: string,
	currency: string,
	islamicYear: number
): string {
	return `${userId}:${normalizeCurrencyCode(currency)}:${islamicYear}`;
}

/** Only usable prices survive: a NaN or a negative is not a price the owner typed. */
function toUsableAmounts(
	amounts: Partial<Record<GoldPurity, number>> | undefined
): Partial<Record<GoldPurity, number>> {
	const usable: Partial<Record<GoldPurity, number>> = {};
	for (const purity of ZAKAT_GOLD_PURITIES) {
		const amount = amounts?.[purity];
		if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) continue;
		usable[purity] = amount;
	}
	return usable;
}

/** The live records for one currency, keyed by the Islamic year they belong to. */
export function toZakatGoldYearMap(
	records: ZakatGoldYear[],
	currency: string
): Map<number, ZakatGoldYear> {
	const normalizedCurrency = normalizeCurrencyCode(currency);
	const byYear = new Map<number, ZakatGoldYear>();
	for (const record of records) {
		if (record.deletedAt) continue;
		if (normalizeCurrencyCode(record.currency) !== normalizedCurrency) continue;
		byYear.set(record.islamicYear, record);
	}
	return byYear;
}

/** Price per gram per karat for a year; an unpriced year contributes no gold value. */
export function getZakatGoldYearPrices(
	record: ZakatGoldYear | undefined
): Partial<Record<GoldPurity, number>> {
	return toUsableAmounts(record?.pricesByPurity);
}

/** Itemised pieces rolled up to per-karat grams, the way the owner's sheet prices gold. */
export function getZakatGoldGramsByPurity(
	items: Pick<GoldItem, "weight" | "purity">[]
): Map<GoldPurity, number> {
	const grams = new Map<GoldPurity, number>();
	for (const item of items) {
		if (!Number.isFinite(item.weight)) continue;
		grams.set(item.purity, (grams.get(item.purity) ?? 0) + item.weight);
	}
	return grams;
}

export function hasZakatGoldYearGramsSnapshot(record: ZakatGoldYear | undefined): boolean {
	return Object.keys(toUsableAmounts(record?.gramsByPurity)).length > 0;
}

/**
 * The grams a year is assessed on: the snapshot the owner pinned for it, else the
 * inventory as it stands today.
 */
export function resolveZakatGoldGramsByPurity(
	record: ZakatGoldYear | undefined,
	items: Pick<GoldItem, "weight" | "purity">[]
): Map<GoldPurity, number> {
	if (!hasZakatGoldYearGramsSnapshot(record)) return getZakatGoldGramsByPurity(items);

	const snapshot = toUsableAmounts(record?.gramsByPurity);
	return new Map(Object.entries(snapshot).map(([purity, grams]) => [purity as GoldPurity, grams]));
}

/**
 * The grams ONE zakat year is assessed on, in order of what the owner actually said:
 *
 * 1. the pieces recorded for THAT year — the holding he itemised, and the only answer
 *    that can describe a 10 g piece leaving while the rest carried on;
 * 2. the per-karat snapshot pinned for the year before items existed, so a year settled
 *    under the old model still reads back exactly as it did;
 * 3. the shared `goldItems` holding, but ONLY while no year in this currency has an
 *    itemised holding at all — that is the pre-per-year world, and it is what every year
 *    showed in it;
 * 4. otherwise nothing. Once holdings belong to years, a year with no gold recorded is
 *    worth zero rather than borrowing another year's gold.
 */
export function resolveZakatGoldGramsForYear({
	islamicYear,
	record,
	itemsByYear,
	inventoryItems,
}: {
	islamicYear: number;
	record: ZakatGoldYear | undefined;
	itemsByYear: Map<number, ZakatGoldYearItem[]>;
	inventoryItems: Pick<GoldItem, "weight" | "purity">[];
}): Map<GoldPurity, number> {
	const yearItems = getZakatGoldYearItems(itemsByYear, islamicYear);
	if (yearItems.length > 0) return getZakatGoldGramsByPurity(yearItems);
	if (hasZakatGoldYearGramsSnapshot(record)) return resolveZakatGoldGramsByPurity(record, []);
	if (hasZakatGoldYearItemInventory(itemsByYear)) return new Map<GoldPurity, number>();
	return getZakatGoldGramsByPurity(inventoryItems);
}

/**
 * Per-karat grams as the engine's gold items: one synthetic piece per karat, which is
 * exactly what `calculateGoldValue` multiplies by that karat's price.
 */
export function toZakatGoldItems(
	gramsByPurity: Map<GoldPurity, number>
): Pick<GoldItem, "weight" | "purity">[] {
	return [...gramsByPurity.entries()].map(([purity, weight]) => ({ purity, weight }));
}

export function sumZakatGoldGrams(gramsByPurity: Map<GoldPurity, number>): number {
	let total = 0;
	for (const grams of gramsByPurity.values()) total += grams;
	return total;
}

/** A usable positive number, or undefined: a NaN or a negative is not a figure typed. */
function toUsableAmount(amount: number | undefined): number | undefined {
	if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return undefined;
	return amount;
}

/**
 * The silver ONE zakat year held: a weight and a price per gram, both the owner's own.
 *
 * Nothing is inherited from another year and nothing falls back to an inventory — silver
 * is a single line he retypes each year — so a year he never typed one for is silent
 * here, and silent means worth zero.
 */
export function getZakatYearSilver(record: ZakatGoldYear | undefined): SilverHoldingInput {
	const grams = toUsableAmount(record?.silverGrams);
	const pricePerGram = toUsableAmount(record?.silverPricePerGram);
	return {
		...(grams !== undefined ? { grams } : {}),
		...(pricePerGram !== undefined ? { pricePerGram } : {}),
	};
}

/** `grams × price per gram` for the year's silver; zero whenever either half is missing. */
export function getZakatYearSilverValue(record: ZakatGoldYear | undefined): number {
	return calculateSilverValue(getZakatYearSilver(record));
}

/** The grams of silver a year is assessed on. Zero for every year that recorded none. */
export function getZakatYearSilverGrams(record: ZakatGoldYear | undefined): number {
	return getZakatYearSilver(record).grams ?? 0;
}

export async function listZakatGoldYears(userId: string): Promise<ZakatGoldYear[]> {
	const records = await db.zakatGoldYears.where("userId").equals(userId).toArray();
	return records.filter((record) => !record.deletedAt);
}

/** The live record for a year and currency, ignoring one that has been reset. */
async function getLiveGoldYear(
	userId: string,
	currency: string,
	islamicYear: number
): Promise<ZakatGoldYear | undefined> {
	const existing = await db.zakatGoldYears.get(buildZakatGoldYearId(userId, currency, islamicYear));
	return existing && !existing.deletedAt ? existing : undefined;
}

export interface SaveZakatGoldYearInput {
	userId: string;
	currency: string;
	islamicYear: number;
	pricesByPurity: Partial<Record<GoldPurity, number>>;
	/** Unix ms the prices were taken on; the sheet prices gold at 1 Ramaḍān. */
	priceDate?: number;
	/** Total silver held that year, in grams. Omitted clears it, as `priceDate` does. */
	silverGrams?: number;
	/** Price per gram of silver, on the same `priceDate` as the gold prices. */
	silverPricePerGram?: number;
}

/**
 * Saves the per-gram prices the owner typed for one year, in one currency — the gold
 * prices per karat, and the silver weight and price that share the same priced-on date.
 *
 * The screen saves that block WHOLE, so a field left out is a field cleared, exactly as
 * `priceDate` already behaves. A grams snapshot pinned for the year is left untouched:
 * it is an independent input that happens to share a row.
 */
export async function saveZakatGoldYearPrices({
	userId,
	currency,
	islamicYear,
	pricesByPurity,
	priceDate,
	silverGrams,
	silverPricePerGram,
}: SaveZakatGoldYearInput): Promise<ZakatGoldYear> {
	const existing = await getLiveGoldYear(userId, currency, islamicYear);
	const record: ZakatGoldYear = {
		...existing,
		id: buildZakatGoldYearId(userId, currency, islamicYear),
		userId,
		currency: normalizeCurrencyCode(currency),
		islamicYear,
		pricesByPurity: toUsableAmounts(pricesByPurity),
		updatedAt: Date.now(),
		deletedAt: undefined,
	};

	if (priceDate !== undefined && Number.isFinite(priceDate)) record.priceDate = priceDate;
	else delete record.priceDate;

	const usableSilverGrams = toUsableAmount(silverGrams);
	if (usableSilverGrams !== undefined) record.silverGrams = usableSilverGrams;
	else delete record.silverGrams;

	const usableSilverPrice = toUsableAmount(silverPricePerGram);
	if (usableSilverPrice !== undefined) record.silverPricePerGram = usableSilverPrice;
	else delete record.silverPricePerGram;

	await db.zakatGoldYears.put(record);
	return record;
}

/**
 * Pins the grams a year actually held, per karat.
 *
 * @deprecated Superseded by `setZakatGoldYearItems`, which records the pieces rather
 * than a karat total. Kept so a year pinned this way still round-trips and so nothing
 * already stored breaks; new pins materialise the year's items instead.
 */
export async function saveZakatGoldYearGrams({
	userId,
	currency,
	islamicYear,
	gramsByPurity,
}: {
	userId: string;
	currency: string;
	islamicYear: number;
	gramsByPurity: Partial<Record<GoldPurity, number>> | Map<GoldPurity, number>;
}): Promise<ZakatGoldYear> {
	const grams =
		gramsByPurity instanceof Map
			? (Object.fromEntries(gramsByPurity) as Partial<Record<GoldPurity, number>>)
			: gramsByPurity;
	const existing = await getLiveGoldYear(userId, currency, islamicYear);
	const record: ZakatGoldYear = {
		...existing,
		id: buildZakatGoldYearId(userId, currency, islamicYear),
		userId,
		currency: normalizeCurrencyCode(currency),
		islamicYear,
		pricesByPurity: toUsableAmounts(existing?.pricesByPurity),
		gramsByPurity: toUsableAmounts(grams),
		updatedAt: Date.now(),
		deletedAt: undefined,
	};

	await db.zakatGoldYears.put(record);
	return record;
}

/** Drops a pinned snapshot so the year follows the inventory again. */
export async function clearZakatGoldYearGrams(
	userId: string,
	currency: string,
	islamicYear: number
): Promise<void> {
	const existing = await getLiveGoldYear(userId, currency, islamicYear);
	if (existing?.gramsByPurity === undefined) return;

	const kept: ZakatGoldYear = { ...existing, updatedAt: Date.now() };
	delete kept.gramsByPurity;
	await db.zakatGoldYears.put(kept);
}

/**
 * Drops everything saved for a year's gold. Soft-deleted rather than removed, so the
 * reset propagates to the user's other devices instead of being resurrected by a pull.
 */
export async function clearZakatGoldYear(
	userId: string,
	currency: string,
	islamicYear: number
): Promise<void> {
	const existing = await db.zakatGoldYears.get(buildZakatGoldYearId(userId, currency, islamicYear));
	if (!existing || existing.deletedAt) return;

	const now = Date.now();
	await db.zakatGoldYears.update(existing.id, { deletedAt: now, updatedAt: now });
}
