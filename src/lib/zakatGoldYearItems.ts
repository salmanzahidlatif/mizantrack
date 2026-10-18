/**
 * The per-year gold holding, as pure data.
 *
 * Gold drifts piece by piece, not wholesale: the owner's 168.4 g of 21k lost a 10 g
 * piece and gained a 14 g 22k piece years later, and every year in between kept its own
 * mix. A single current inventory cannot say that — recording today's sale would rewrite
 * 2020 as though the piece had never been owned — so each zakat year owns its own list.
 *
 * Nothing here touches Dexie. The repository layer does the IO and the Dexie upgrade
 * reuses `buildZakatGoldYearItemBackfill` from here, so the migration that moves the old
 * single inventory into the per-year model can be read and tested on its own.
 *
 * Nothing here computes tax. Zakat is a religious obligation; this module only decides
 * which pieces a year was held on.
 */

import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";

import type {
	GoldItem,
	GoldPurity,
	ZakatCalculation,
	ZakatGoldYear,
	ZakatGoldYearItem,
} from "@/types";

/**
 * The row key is derived from the piece's lineage, not minted fresh, so two devices that
 * copy the same year forward converge on ONE row instead of duplicating the holding.
 */
export function buildZakatGoldYearItemId(
	userId: string,
	currency: string,
	islamicYear: number,
	lineageId: string
): string {
	return `${userId}:${normalizeCurrencyCode(currency)}:${islamicYear}:${lineageId}`;
}

/**
 * The lineage of a karat bucket, for a holding that was only ever recorded as grams.
 * One bucket per karat, carried across years like any other piece.
 */
export function buildZakatGoldKaratLineageId(purity: GoldPurity): string {
	return `karat-${purity}`;
}

/** A weight only counts when it is a real, positive number of grams. */
export function isUsableZakatGoldWeight(weight: unknown): weight is number {
	return typeof weight === "number" && Number.isFinite(weight) && weight > 0;
}

/** A sale year only counts when it is a real Islamic year. */
export function isUsableZakatGoldSoldYear(islamicYear: unknown): islamicYear is number {
	return typeof islamicYear === "number" && Number.isFinite(islamicYear);
}

/** True for the ONE row that records a sale: the year the piece stopped counting. */
export function isZakatGoldYearItemSale(item: ZakatGoldYearItem): boolean {
	return isUsableZakatGoldSoldYear(item.soldInIslamicYear);
}

/**
 * The year each lineage was sold in, read off the one row that records the sale.
 *
 * A sale belongs to the PIECE, not to a year: it is recorded once, in the first year the
 * piece stops counting, and every later year reads it from there. Writing a tombstone
 * into each following year instead would mean maintaining the sale forever — and a year
 * the owner has not opened yet would quietly inherit the piece back.
 */
export function buildZakatGoldSoldLineages(
	records: ZakatGoldYearItem[],
	currency: string
): Map<string, number> {
	const normalizedCurrency = normalizeCurrencyCode(currency);
	const soldFrom = new Map<string, number>();

	for (const record of records) {
		if (record.deletedAt) continue;
		if (normalizeCurrencyCode(record.currency) !== normalizedCurrency) continue;
		if (!isUsableZakatGoldSoldYear(record.soldInIslamicYear)) continue;
		const existing = soldFrom.get(record.lineageId);
		if (existing === undefined || record.soldInIslamicYear < existing) {
			soldFrom.set(record.lineageId, record.soldInIslamicYear);
		}
	}
	return soldFrom;
}

/** The year a piece stopped counting, or undefined while it is still held. */
export function getZakatGoldSoldFromYear(
	soldLineages: Map<string, number>,
	lineageId: string
): number | undefined {
	return soldLineages.get(lineageId);
}

/**
 * True once a year has reached the sale. "Sold in 1446" means 1446 itself no longer
 * counts the piece, so 1445 is the last year that does.
 */
export function isZakatGoldLineageSold(
	soldLineages: Map<string, number>,
	lineageId: string,
	islamicYear: number
): boolean {
	const soldFrom = soldLineages.get(lineageId);
	return soldFrom !== undefined && islamicYear >= soldFrom;
}

/** The pieces a list still holds in one year; anything sold by then is left behind. */
export function selectZakatGoldYearItemsHeldIn(
	items: ZakatGoldYearItem[],
	islamicYear: number,
	soldLineages: Map<string, number>
): ZakatGoldYearItem[] {
	return items.filter((item) => !isZakatGoldLineageSold(soldLineages, item.lineageId, islamicYear));
}

/**
 * Oldest piece first, then by lineage. `createdAt` travels with the piece through every
 * copy-forward, so a year's list keeps the same order the owner built it in.
 */
export function sortZakatGoldYearItems(items: ZakatGoldYearItem[]): ZakatGoldYearItem[] {
	return [...items].sort(
		(left, right) =>
			left.createdAt - right.createdAt || left.lineageId.localeCompare(right.lineageId)
	);
}

/**
 * Every piece each year has on its books for one currency, sold ones included.
 *
 * This is the RECORD, not the holding: a piece sold in 1446 is still listed under 1446,
 * marked as sold, so the screen can say what happened to it instead of the piece simply
 * vanishing. Use `toZakatGoldYearItemMap` for what a year is actually assessed on.
 */
export function toZakatGoldYearItemLedger(
	records: ZakatGoldYearItem[],
	currency: string
): Map<number, ZakatGoldYearItem[]> {
	const normalizedCurrency = normalizeCurrencyCode(currency);
	const byYear = new Map<number, ZakatGoldYearItem[]>();

	for (const record of records) {
		if (record.deletedAt) continue;
		if (normalizeCurrencyCode(record.currency) !== normalizedCurrency) continue;
		if (!isUsableZakatGoldWeight(record.weight)) continue;
		const items = byYear.get(record.islamicYear);
		if (items) items.push(record);
		else byYear.set(record.islamicYear, [record]);
	}

	for (const [islamicYear, items] of byYear) {
		byYear.set(islamicYear, sortZakatGoldYearItems(items));
	}
	return byYear;
}

/**
 * The live pieces for one currency, grouped by the zakat year they were HELD in.
 *
 * A piece sold in 1446 drops out of 1446 and everything after it, and stays in every
 * earlier year exactly as it was — which is the whole point of holdings belonging to
 * years. The sale is read off the one row that records it, so no later year needs a
 * tombstone of its own.
 */
export function toZakatGoldYearItemMap(
	records: ZakatGoldYearItem[],
	currency: string
): Map<number, ZakatGoldYearItem[]> {
	const soldLineages = buildZakatGoldSoldLineages(records, currency);
	const byYear = toZakatGoldYearItemLedger(records, currency);

	for (const [islamicYear, items] of byYear) {
		const held = selectZakatGoldYearItemsHeldIn(items, islamicYear, soldLineages);
		if (held.length === items.length) continue;
		if (held.length === 0) byYear.delete(islamicYear);
		else byYear.set(islamicYear, held);
	}
	return byYear;
}

/** True once ANY year in this currency has a holding of its own recorded. */
export function hasZakatGoldYearItemInventory(
	itemsByYear: Map<number, ZakatGoldYearItem[]>
): boolean {
	for (const items of itemsByYear.values()) {
		if (items.length > 0) return true;
	}
	return false;
}

/** The pieces a year holds in its own right, or an empty list when it holds none. */
export function getZakatGoldYearItems(
	itemsByYear: Map<number, ZakatGoldYearItem[]>,
	islamicYear: number
): ZakatGoldYearItem[] {
	return itemsByYear.get(islamicYear) ?? [];
}

/**
 * The nearest EARLIER year that has a holding, which is what a fresh year inherits.
 * Only earlier years count: a later year's edits are not history this year can borrow.
 */
export function findZakatGoldYearItemsToInherit(
	itemsByYear: Map<number, ZakatGoldYearItem[]>,
	islamicYear: number
): { islamicYear: number; items: ZakatGoldYearItem[] } | undefined {
	let best: { islamicYear: number; items: ZakatGoldYearItem[] } | undefined;
	for (const [year, items] of itemsByYear) {
		if (year >= islamicYear || items.length === 0) continue;
		if (!best || year > best.islamicYear) best = { islamicYear: year, items };
	}
	return best;
}

export interface ZakatGoldYearItemTarget {
	userId: string;
	currency: string;
	islamicYear: number;
	/** Unix ms stamped on the written rows. */
	now: number;
}

function toYearItem(
	target: ZakatGoldYearItemTarget,
	piece: {
		lineageId: string;
		title: string;
		weight: number;
		purity: GoldPurity;
		notes?: string;
		sourceGoldItemId?: string;
		createdAt: number;
	}
): ZakatGoldYearItem {
	const currency = normalizeCurrencyCode(target.currency);
	const record: ZakatGoldYearItem = {
		id: buildZakatGoldYearItemId(target.userId, currency, target.islamicYear, piece.lineageId),
		userId: target.userId,
		currency,
		islamicYear: target.islamicYear,
		lineageId: piece.lineageId,
		title: piece.title,
		weight: piece.weight,
		purity: piece.purity,
		createdAt: piece.createdAt,
		updatedAt: target.now,
	};

	if (piece.notes) record.notes = piece.notes;
	if (piece.sourceGoldItemId) record.sourceGoldItemId = piece.sourceGoldItemId;
	return record;
}

/**
 * One year's holding, restated for another year.
 *
 * Lineage and `createdAt` travel with each piece, so the same necklace is recognisably
 * the same necklace in 1440 and 1446 — the copy is the SAME item, held again, not a new
 * one that happens to weigh the same. A sale marker never travels: it is recorded once,
 * against the year the piece stopped counting, and read from there by every later year.
 */
export function copyZakatGoldYearItemsTo(
	items: ZakatGoldYearItem[],
	target: ZakatGoldYearItemTarget
): ZakatGoldYearItem[] {
	return items
		.filter((item) => !item.deletedAt && isUsableZakatGoldWeight(item.weight))
		.map((item) =>
			toYearItem(target, {
				lineageId: item.lineageId,
				title: item.title,
				weight: item.weight,
				purity: item.purity,
				notes: item.notes,
				sourceGoldItemId: item.sourceGoldItemId,
				createdAt: item.createdAt,
			})
		);
}

/**
 * The shared `goldItems` inventory restated as one year's holding.
 *
 * The inventory row's own id becomes the lineage, so a piece that was in the inventory
 * before the per-year model existed keeps one identity through every year it survives.
 */
export function buildZakatGoldYearItemsFromInventory(
	inventory: GoldItem[],
	target: ZakatGoldYearItemTarget
): ZakatGoldYearItem[] {
	const currency = normalizeCurrencyCode(target.currency);
	return inventory
		.filter(
			(item) =>
				!item.deletedAt &&
				normalizeCurrencyCode(item.currency) === currency &&
				isUsableZakatGoldWeight(item.weight)
		)
		.map((item) =>
			toYearItem(target, {
				lineageId: item.id,
				title: item.title,
				weight: item.weight,
				purity: item.purity,
				notes: item.notes,
				sourceGoldItemId: item.id,
				createdAt: item.purchaseDate ?? item.updatedAt,
			})
		);
}

/**
 * A per-karat grams snapshot restated as one year's holding — one bucket per karat.
 * This is how a year pinned under the old `gramsByPurity` model keeps its exact weight.
 */
export function buildZakatGoldYearItemsFromGrams(
	gramsByPurity: Partial<Record<GoldPurity, number>>,
	target: ZakatGoldYearItemTarget
): ZakatGoldYearItem[] {
	return Object.entries(gramsByPurity)
		.filter(([, grams]) => isUsableZakatGoldWeight(grams))
		.map(([purity, grams]) =>
			toYearItem(target, {
				lineageId: buildZakatGoldKaratLineageId(purity as GoldPurity),
				title: `Gold ${purity}`,
				weight: grams,
				purity: purity as GoldPurity,
				createdAt: target.now,
			})
		);
}

/** `"1444-1445"` is the stored shape of a zakat year; the year it opens in identifies it. */
export function parseZakatCalculationIslamicYear(islamicYear: string): number | undefined {
	const leading = /^\s*(\d{3,4})/.exec(islamicYear ?? "");
	if (!leading) return undefined;
	const parsed = Number(leading[1]);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export interface ZakatGoldYearItemBackfillInput {
	goldItems: GoldItem[];
	goldYears: ZakatGoldYear[];
	calculations: Pick<ZakatCalculation, "userId" | "currency" | "islamicYear" | "deletedAt">[];
	now: number;
}

/**
 * Moving an existing holding into the per-year model, once.
 *
 * Every year the owner already settled — one he priced, one he pinned, one he saved a
 * calculation for — is given its own copy of the holding it was assessed on: the pinned
 * grams where he pinned them, otherwise the inventory, which is exactly what that year
 * showed before. Nothing is taken away: `goldItems` is left untouched, so the current
 * holding, the Hysab Kytab sheet export and the workbook all still read what they did.
 *
 * Without this, the first year the owner edited would silently empty every other year —
 * the same present-rewrites-history failure the per-year model exists to end.
 */
export function buildZakatGoldYearItemBackfill({
	goldItems,
	goldYears,
	calculations,
	now,
}: ZakatGoldYearItemBackfillInput): ZakatGoldYearItem[] {
	const liveInventory = goldItems.filter((item) => !item.deletedAt);
	const rows: ZakatGoldYearItem[] = [];
	const seeded = new Set<string>();

	function seed(
		userId: string,
		currency: string,
		islamicYear: number,
		seedRows: () => ZakatGoldYearItem[]
	) {
		const normalizedCurrency = normalizeCurrencyCode(currency);
		if (!userId || !normalizedCurrency || !Number.isFinite(islamicYear)) return;
		const key = `${userId}|${normalizedCurrency}|${islamicYear}`;
		if (seeded.has(key)) return;
		seeded.add(key);
		rows.push(...seedRows());
	}

	for (const goldYear of goldYears) {
		if (goldYear.deletedAt) continue;
		seed(goldYear.userId, goldYear.currency, goldYear.islamicYear, () => {
			const target: ZakatGoldYearItemTarget = {
				userId: goldYear.userId,
				currency: goldYear.currency,
				islamicYear: goldYear.islamicYear,
				now,
			};
			const pinned = buildZakatGoldYearItemsFromGrams(goldYear.gramsByPurity ?? {}, target);
			return pinned.length > 0
				? pinned
				: buildZakatGoldYearItemsFromInventory(liveInventory, target);
		});
	}

	for (const calculation of calculations) {
		if (calculation.deletedAt) continue;
		const islamicYear = parseZakatCalculationIslamicYear(calculation.islamicYear);
		if (islamicYear === undefined) continue;
		seed(calculation.userId, calculation.currency, islamicYear, () =>
			buildZakatGoldYearItemsFromInventory(liveInventory, {
				userId: calculation.userId,
				currency: calculation.currency,
				islamicYear,
				now,
			})
		);
	}

	return rows;
}
