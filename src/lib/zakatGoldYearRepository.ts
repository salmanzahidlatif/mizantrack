/**
 * Persistence for the gold inputs that belong to ONE zakat year.
 *
 * The owner's workbook carried the same 170.52 g of 21k gold from `2021` to `2024` and
 * repriced it every year: 8,427 → 10,725 → 16,778.12 → 18,846.3 per gram. The weight is
 * the thing that persists; the price is the thing that belongs to the year. So the
 * inventory is NOT duplicated per year — `goldItems` stays one list — and only the price
 * per gram the owner typed is stored here, per user, per currency, per Islamic year.
 *
 * A per-karat grams snapshot is optional, for the year whose holding genuinely differed
 * (a piece sold, a piece bought). Absent, a year values today's inventory at that year's
 * price, which is how the sheet behaved. Present, it wins outright so a year the owner
 * pinned can never drift when the inventory is edited later.
 */

import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { db } from "@/lib/db/local";

import type { GoldItem, GoldPurity, ZakatGoldYear } from "@/types";

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
	return new Map(
		Object.entries(snapshot).map(([purity, grams]) => [purity as GoldPurity, grams])
	);
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
	const existing = await db.zakatGoldYears.get(
		buildZakatGoldYearId(userId, currency, islamicYear)
	);
	return existing && !existing.deletedAt ? existing : undefined;
}

export interface SaveZakatGoldYearInput {
	userId: string;
	currency: string;
	islamicYear: number;
	pricesByPurity: Partial<Record<GoldPurity, number>>;
	/** Unix ms the prices were taken on; the sheet prices gold at 1 Ramaḍān. */
	priceDate?: number;
}

/**
 * Saves the price per gram the owner typed for one year, in one currency.
 *
 * A grams snapshot already pinned for the year is left untouched: the two are
 * independent inputs that happen to share a row.
 */
export async function saveZakatGoldYearPrices({
	userId,
	currency,
	islamicYear,
	pricesByPurity,
	priceDate,
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

	await db.zakatGoldYears.put(record);
	return record;
}

/**
 * Pins the grams a year actually held, so later edits to the inventory cannot rewrite a
 * year the owner already settled.
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
	if (!existing || existing.gramsByPurity === undefined) return;

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
	const existing = await db.zakatGoldYears.get(
		buildZakatGoldYearId(userId, currency, islamicYear)
	);
	if (!existing || existing.deletedAt) return;

	const now = Date.now();
	await db.zakatGoldYears.update(existing.id, { deletedAt: now, updatedAt: now });
}
