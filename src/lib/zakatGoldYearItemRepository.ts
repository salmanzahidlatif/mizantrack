/**
 * Persistence for the gold a zakat year was actually held on.
 *
 * `goldItems` is the CURRENT holding and stays exactly as it was — synced, exported to
 * the Hysab Kytab sheet and the workbook, and never rewritten from here. What a year was
 * assessed on is itemised in `zakatGoldYearItems`: one list per year, so selling a 10 g
 * piece today cannot reach back and empty 2020.
 *
 * Copy-forward is the point, not a convenience: most pieces carry over untouched, so a
 * fresh year inherits the previous year's list and the owner edits only what changed.
 * The copy keeps each piece's `lineageId`, so the same necklace is recognisably the same
 * necklace in every year it was held, and the row id is derived from that lineage so two
 * devices inheriting the same year converge on one row instead of duplicating the gold.
 */

import { v4 as uuid } from "uuid";

import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { db } from "@/lib/db/local";
import {
	buildZakatGoldYearItemId,
	buildZakatGoldYearItemsFromGrams,
	buildZakatGoldYearItemsFromInventory,
	copyZakatGoldYearItemsTo,
	findZakatGoldYearItemsToInherit,
	isUsableZakatGoldWeight,
	sortZakatGoldYearItems,
	toZakatGoldYearItemMap,
} from "@/lib/zakatGoldYearItems";
import { buildZakatGoldYearId, hasZakatGoldYearGramsSnapshot } from "@/lib/zakatGoldYearRepository";

import type { GoldPurity, ZakatGoldYearItem } from "@/types";

/** How a year's list came to exist, so the screen can say what it did. */
export type ZakatGoldYearItemsOrigin = "existing" | "pinned" | "inherited" | "inventory" | "empty";

export interface EnsureZakatGoldYearItemsResult {
	items: ZakatGoldYearItem[];
	origin: ZakatGoldYearItemsOrigin;
	/** The year the list was inherited from, when it was. */
	inheritedFromIslamicYear?: number;
}

export async function listZakatGoldYearItems(userId: string): Promise<ZakatGoldYearItem[]> {
	const records = await db.zakatGoldYearItems.where("userId").equals(userId).toArray();
	return records.filter((record) => !record.deletedAt);
}

/** Every live piece for one user and currency, whatever year it belongs to. */
async function listCurrencyItems(userId: string, currency: string): Promise<ZakatGoldYearItem[]> {
	const records = await db.zakatGoldYearItems
		.where("[userId+currency]")
		.equals([userId, normalizeCurrencyCode(currency)])
		.toArray();
	return records.filter((record) => !record.deletedAt);
}

/** The pieces one year holds, oldest first. */
export async function listZakatGoldYearItemsForYear(
	userId: string,
	currency: string,
	islamicYear: number
): Promise<ZakatGoldYearItem[]> {
	const records = await db.zakatGoldYearItems
		.where("[userId+currency+islamicYear]")
		.equals([userId, normalizeCurrencyCode(currency), islamicYear])
		.toArray();
	return sortZakatGoldYearItems(records.filter((record) => !record.deletedAt));
}

/**
 * The stamp a new piece enters a year with.
 *
 * `createdAt` is what keeps a year's list in the order the owner built it, and it travels
 * with the piece through every copy-forward — so two pieces added in the same millisecond
 * must not tie, or the list would reshuffle itself on the next read.
 */
async function nextCreatedAt(
	userId: string,
	currency: string,
	islamicYear: number
): Promise<number> {
	const existing = await listZakatGoldYearItemsForYear(userId, currency, islamicYear);
	const latest = existing.reduce((newest, item) => Math.max(newest, item.createdAt), 0);
	return Math.max(Date.now(), latest + 1);
}

export interface SaveZakatGoldYearItemInput {
	userId: string;
	currency: string;
	islamicYear: number;
	/** Absent for a piece that enters the record now; present when one is edited. */
	lineageId?: string;
	title: string;
	weight: number;
	purity: GoldPurity;
	notes?: string;
}

/**
 * Writes ONE piece into ONE year. A piece edited here is edited for this year only —
 * the same lineage in another year keeps whatever that year recorded.
 */
export async function saveZakatGoldYearItem({
	userId,
	currency,
	islamicYear,
	lineageId = uuid(),
	title,
	weight,
	purity,
	notes,
}: SaveZakatGoldYearItemInput): Promise<ZakatGoldYearItem> {
	const normalizedCurrency = normalizeCurrencyCode(currency);
	const id = buildZakatGoldYearItemId(userId, normalizedCurrency, islamicYear, lineageId);
	const existing = await db.zakatGoldYearItems.get(id);
	const now = Date.now();
	const record: ZakatGoldYearItem = {
		...existing,
		id,
		userId,
		currency: normalizedCurrency,
		islamicYear,
		lineageId,
		title: title.trim(),
		weight,
		purity,
		createdAt:
			existing?.createdAt ?? (await nextCreatedAt(userId, normalizedCurrency, islamicYear)),
		updatedAt: now,
		deletedAt: undefined,
	};

	if (notes?.trim()) record.notes = notes.trim();
	else delete record.notes;

	await db.zakatGoldYearItems.put(record);
	return record;
}

/**
 * Removes a piece from ONE year — the owner sold it, or it was never held that year.
 * Soft-deleted so the removal reaches his other devices instead of being resurrected,
 * and so the years that still hold the piece are untouched.
 */
export async function deleteZakatGoldYearItem(
	userId: string,
	currency: string,
	islamicYear: number,
	lineageId: string
): Promise<void> {
	const id = buildZakatGoldYearItemId(userId, currency, islamicYear, lineageId);
	const existing = await db.zakatGoldYearItems.get(id);
	if (!existing || existing.deletedAt) return;

	const now = Date.now();
	await db.zakatGoldYearItems.update(id, { deletedAt: now, updatedAt: now });
}

/** Tombstones every piece a year holds, leaving the year with no gold recorded. */
export async function clearZakatGoldYearItems(
	userId: string,
	currency: string,
	islamicYear: number
): Promise<void> {
	const existing = await listZakatGoldYearItemsForYear(userId, currency, islamicYear);
	if (existing.length === 0) return;

	const now = Date.now();
	await db.zakatGoldYearItems.bulkPut(
		existing.map((item) => ({ ...item, deletedAt: now, updatedAt: now }))
	);
}

/**
 * Makes one year hold exactly these pieces: the ones given are written, and anything the
 * year held that is not among them is tombstoned. A piece with a lineage the year
 * already knows keeps that lineage, which is how a holding stays the same holding.
 */
export async function setZakatGoldYearItems({
	userId,
	currency,
	islamicYear,
	items,
}: {
	userId: string;
	currency: string;
	islamicYear: number;
	items: ZakatGoldYearItem[];
}): Promise<ZakatGoldYearItem[]> {
	const normalizedCurrency = normalizeCurrencyCode(currency);
	const now = Date.now();
	const next = copyZakatGoldYearItemsTo(items, {
		userId,
		currency: normalizedCurrency,
		islamicYear,
		now,
	});
	const keptLineage = new Set(next.map((item) => item.lineageId));
	const existing = await listZakatGoldYearItemsForYear(userId, normalizedCurrency, islamicYear);
	const removed = existing
		.filter((item) => !keptLineage.has(item.lineageId))
		.map((item) => ({ ...item, deletedAt: now, updatedAt: now }));

	await db.zakatGoldYearItems.bulkPut([...next, ...removed]);
	return sortZakatGoldYearItems(next);
}

/** Restates one year's holding as another year's, lineage and all. */
export async function copyZakatGoldYearItems({
	userId,
	currency,
	fromIslamicYear,
	toIslamicYear,
}: {
	userId: string;
	currency: string;
	fromIslamicYear: number;
	toIslamicYear: number;
}): Promise<ZakatGoldYearItem[]> {
	if (fromIslamicYear === toIslamicYear) {
		return listZakatGoldYearItemsForYear(userId, currency, toIslamicYear);
	}

	const source = await listZakatGoldYearItemsForYear(userId, currency, fromIslamicYear);
	return setZakatGoldYearItems({ userId, currency, islamicYear: toIslamicYear, items: source });
}

/**
 * Gives every year in an inclusive range the same holding.
 *
 * A piece bought years ago and still held is not news the owner should have to retype
 * year by year, so one holding can be stated across the stretch of years it covers.
 * The source year is included, which makes re-applying the same range a no-op.
 */
export async function applyZakatGoldYearItemsToRange({
	userId,
	currency,
	sourceIslamicYear,
	fromIslamicYear,
	throughIslamicYear,
}: {
	userId: string;
	currency: string;
	sourceIslamicYear: number;
	fromIslamicYear: number;
	throughIslamicYear: number;
}): Promise<number[]> {
	const first = Math.min(fromIslamicYear, throughIslamicYear);
	const last = Math.max(fromIslamicYear, throughIslamicYear);
	if (!Number.isFinite(first) || !Number.isFinite(last)) return [];

	const source = await listZakatGoldYearItemsForYear(userId, currency, sourceIslamicYear);
	const applied: number[] = [];
	for (let islamicYear = first; islamicYear <= last; islamicYear += 1) {
		await setZakatGoldYearItems({ userId, currency, islamicYear, items: source });
		applied.push(islamicYear);
	}
	return applied;
}

/**
 * The holding a year works from, materialised if it has none yet.
 *
 * A year opened for the first time inherits the previous year's list — most pieces carry
 * over untouched, and re-entering them would be how a holding quietly loses a piece.
 * After that the year stands on its own: editing it changes nothing else, and editing
 * the year it came from changes nothing here.
 *
 * A year pinned under the old per-karat model is materialised from ITS OWN pinned grams,
 * never from a neighbour: the owner already said what that year held, and inheriting
 * over the top of it would rewrite a year he had settled.
 *
 * With nothing to inherit, the shared `goldItems` holding seeds the year, which is what
 * that year showed before gold belonged to a year at all.
 */
export async function ensureZakatGoldYearItems({
	userId,
	currency,
	islamicYear,
}: {
	userId: string;
	currency: string;
	islamicYear: number;
}): Promise<EnsureZakatGoldYearItemsResult> {
	const normalizedCurrency = normalizeCurrencyCode(currency);
	const existing = await listZakatGoldYearItemsForYear(userId, normalizedCurrency, islamicYear);
	if (existing.length > 0) return { items: existing, origin: "existing" };

	const now = Date.now();
	const goldYear = await db.zakatGoldYears.get(
		buildZakatGoldYearId(userId, normalizedCurrency, islamicYear)
	);
	if (!goldYear?.deletedAt && hasZakatGoldYearGramsSnapshot(goldYear)) {
		const pinned = buildZakatGoldYearItemsFromGrams(goldYear?.gramsByPurity ?? {}, {
			userId,
			currency: normalizedCurrency,
			islamicYear,
			now,
		});
		await db.zakatGoldYearItems.bulkPut(pinned);
		return { items: sortZakatGoldYearItems(pinned), origin: "pinned" };
	}

	const itemsByYear = toZakatGoldYearItemMap(
		await listCurrencyItems(userId, normalizedCurrency),
		normalizedCurrency
	);
	const inherited = findZakatGoldYearItemsToInherit(itemsByYear, islamicYear);

	if (inherited) {
		const items = await setZakatGoldYearItems({
			userId,
			currency: normalizedCurrency,
			islamicYear,
			items: inherited.items,
		});
		return { items, origin: "inherited", inheritedFromIslamicYear: inherited.islamicYear };
	}

	const inventory = await db.goldItems.where("userId").equals(userId).toArray();
	const seeded = buildZakatGoldYearItemsFromInventory(inventory, {
		userId,
		currency: normalizedCurrency,
		islamicYear,
		now,
	});
	if (seeded.length === 0) return { items: [], origin: "empty" };

	await db.zakatGoldYearItems.bulkPut(seeded);
	return { items: sortZakatGoldYearItems(seeded), origin: "inventory" };
}

/**
 * Pins a year's holding the moment a calculation is saved for it.
 *
 * "On this date I assessed X" is a determination, and a year that has been assessed must
 * stop drifting: materialising the list it was assessed on is what stops a later edit to
 * another year's gold from changing what this one meant.
 */
export async function pinZakatGoldYearItems({
	userId,
	currency,
	islamicYear,
}: {
	userId: string;
	currency: string;
	islamicYear: number;
}): Promise<ZakatGoldYearItem[]> {
	return (await ensureZakatGoldYearItems({ userId, currency, islamicYear })).items;
}

/** Total grams a list of pieces comes to, ignoring anything that is not a weight. */
export function sumZakatGoldYearItemWeight(items: ZakatGoldYearItem[]): number {
	return items.reduce(
		(total, item) => (isUsableZakatGoldWeight(item.weight) ? total + item.weight : total),
		0
	);
}
