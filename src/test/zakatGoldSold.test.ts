/**
 * Selling a piece of gold, as opposed to removing it.
 *
 * The owner's own account of how his gold moved: "I did not sell all 168.4 g of 21k,
 * instead I sold an item of 10 g from it and bought 14 g of 22k instead, like that". The
 * replacement serves the year of the sale, so the piece sold stops counting FROM that
 * year on — the year before it is the last one that counts it — and every earlier year
 * keeps it exactly as it was.
 *
 * A sale is recorded ONCE, against the lineage, in the first year that stops counting it.
 * Later years read it from there, so nothing has to be tombstoned year by year and a year
 * the owner has not opened yet cannot inherit the piece back. Removal stays available and
 * stays different: it is how a mis-typed entry is corrected, and it leaves no trace.
 *
 * Nothing here computes tax. Zakat is a religious obligation; this file only proves which
 * pieces a year was held on.
 */
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/local";
import {
	applyZakatGoldYearItemsToRange,
	clearZakatGoldYearItemSold,
	copyZakatGoldYearItems,
	deleteZakatGoldYearItem,
	ensureZakatGoldYearItems,
	getZakatGoldSoldLineages,
	listZakatGoldYearItems,
	listZakatGoldYearItemsForYear,
	listZakatGoldYearItemsHeldInYear,
	markZakatGoldYearItemSold,
	saveZakatGoldYearItem,
} from "@/lib/zakatGoldYearItemRepository";
import {
	buildZakatGoldSoldLineages,
	isZakatGoldLineageSold,
	toZakatGoldYearItemLedger,
	toZakatGoldYearItemMap,
} from "@/lib/zakatGoldYearItems";
import { resolveZakatGoldGramsForYear, sumZakatGoldGrams } from "@/lib/zakatGoldYearRepository";

import type { GoldPurity, ZakatGoldYearItem } from "@/types";

const USER_ID = "zakat-gold-sold-user";
const CURRENCY = "PKR";

/** The wedding holding: 168.4 g of 21k, in three pieces. */
const WEDDING_PIECES = [
	{ title: "Wedding Set", weight: 100, purity: "21k" as GoldPurity },
	{ title: "Bangles", weight: 58.4, purity: "21k" as GoldPurity },
	{ title: "Chain", weight: 10, purity: "21k" as GoldPurity },
];

async function addPiece(
	islamicYear: number,
	piece: { title: string; weight: number; purity: GoldPurity },
	lineageId?: string
): Promise<ZakatGoldYearItem> {
	return saveZakatGoldYearItem({
		userId: USER_ID,
		currency: CURRENCY,
		islamicYear,
		lineageId,
		...piece,
	});
}

/** The wedding holding recorded for 1440 and carried forward to 1441 and 1446. */
async function recordWeddingHistory(): Promise<void> {
	for (const piece of WEDDING_PIECES) await addPiece(1440, piece, piece.title.toLowerCase());
	for (const toIslamicYear of [1441, 1442, 1443, 1444, 1445, 1446]) {
		await copyZakatGoldYearItems({
			userId: USER_ID,
			currency: CURRENCY,
			fromIslamicYear: toIslamicYear - 1,
			toIslamicYear,
		});
	}
}

async function heldTitles(islamicYear: number): Promise<string[]> {
	return (await listZakatGoldYearItemsHeldInYear(USER_ID, CURRENCY, islamicYear)).map(
		(item) => item.title
	);
}

/** The grams a year is assessed on, resolved exactly as the calculator resolves them. */
async function gramsFor(islamicYear: number): Promise<Map<GoldPurity, number>> {
	return resolveZakatGoldGramsForYear({
		islamicYear,
		record: undefined,
		itemsByYear: toZakatGoldYearItemMap(await listZakatGoldYearItems(USER_ID), CURRENCY),
		inventoryItems: [],
	});
}

beforeEach(async () => {
	await Promise.all([
		db.zakatGoldYearItems.where("userId").equals(USER_ID).delete(),
		db.zakatGoldYears.where("userId").equals(USER_ID).delete(),
		db.goldItems.where("userId").equals(USER_ID).delete(),
	]);
});

describe("a piece sold in a year", () => {
	/**
	 * The owner's scenario, verbatim: the 10 g chain goes and 14 g of 22k arrives in its
	 * place. The replacement serves 1446, so 1446 must NOT count both — and 1445, the
	 * last year the chain was held, keeps the full 168.4 g.
	 */
	it("stops counting from that year on, leaving every earlier year untouched", async () => {
		await recordWeddingHistory();

		await markZakatGoldYearItemSold({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1446,
			lineageId: "chain",
		});
		await addPiece(1446, { title: "New Bangle", weight: 14, purity: "22k" });

		for (const islamicYear of [1440, 1441, 1442, 1443, 1444, 1445]) {
			const grams = await gramsFor(islamicYear);
			expect(grams.get("21k")).toBeCloseTo(168.4, 6);
			expect(sumZakatGoldGrams(grams)).toBeCloseTo(168.4, 6);
		}

		const sale = await gramsFor(1446);
		expect(sale.get("21k")).toBeCloseTo(158.4, 6);
		expect(sale.get("22k")).toBeCloseTo(14, 6);
	});

	it("stays sold in every year after the sale, with no tombstone written for them", async () => {
		await recordWeddingHistory();
		await markZakatGoldYearItemSold({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1444,
			lineageId: "chain",
		});

		expect(await heldTitles(1443)).toContain("Chain");
		for (const islamicYear of [1444, 1445, 1446]) {
			expect(await heldTitles(islamicYear)).not.toContain("Chain");
		}

		// The sale is ONE row. 1445 and 1446 still have their copy of the piece on the
		// books, untombstoned — they simply no longer count it.
		const marked = (await listZakatGoldYearItems(USER_ID)).filter(
			(item) => item.soldInIslamicYear !== undefined
		);
		expect(marked).toHaveLength(1);
		expect(marked[0]).toMatchObject({ islamicYear: 1444, lineageId: "chain" });
	});

	it("is still on the record, marked sold, in the year it was sold in", async () => {
		await recordWeddingHistory();
		await markZakatGoldYearItemSold({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1446,
			lineageId: "chain",
		});

		const ledger = await listZakatGoldYearItemsForYear(USER_ID, CURRENCY, 1446);
		const chain = ledger.find((item) => item.lineageId === "chain");
		expect(chain).toMatchObject({ title: "Chain", weight: 10, soldInIslamicYear: 1446 });

		// And in the years it WAS held, it is a plain holding that still counts.
		const held1445 = await listZakatGoldYearItemsForYear(USER_ID, CURRENCY, 1445);
		expect(held1445.find((item) => item.lineageId === "chain")?.soldInIslamicYear).toBeUndefined();
		expect(await heldTitles(1445)).toContain("Chain");
	});

	it("names the year it was sold in, so the last year that counts it is readable", async () => {
		await recordWeddingHistory();
		await markZakatGoldYearItemSold({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1446,
			lineageId: "chain",
		});

		const soldLineages = await getZakatGoldSoldLineages(USER_ID, CURRENCY);
		expect(soldLineages.get("chain")).toBe(1446);
		expect(isZakatGoldLineageSold(soldLineages, "chain", 1445)).toBe(false);
		expect(isZakatGoldLineageSold(soldLineages, "chain", 1446)).toBe(true);
		expect(isZakatGoldLineageSold(soldLineages, "chain", 1447)).toBe(true);
	});

	it("records the sale against the year even when that year never held a copy", async () => {
		for (const piece of WEDDING_PIECES) await addPiece(1440, piece, piece.title.toLowerCase());

		const sale = await markZakatGoldYearItemSold({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1444,
			lineageId: "chain",
		});

		expect(sale).toMatchObject({ islamicYear: 1444, title: "Chain", soldInIslamicYear: 1444 });
		expect(await heldTitles(1440)).toContain("Chain");
		expect(await heldTitles(1444)).not.toContain("Chain");
	});

	it("keeps one currency's sale out of another's books", async () => {
		await addPiece(1444, { title: "Chain", weight: 10, purity: "21k" }, "chain");
		await saveZakatGoldYearItem({
			userId: USER_ID,
			currency: "AED",
			islamicYear: 1444,
			lineageId: "chain",
			title: "Dubai Chain",
			weight: 25,
			purity: "22k",
		});

		await markZakatGoldYearItemSold({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1444,
			lineageId: "chain",
		});

		expect(await heldTitles(1444)).toEqual([]);
		expect(
			(await listZakatGoldYearItemsHeldInYear(USER_ID, "AED", 1444)).map((item) => item.title)
		).toEqual(["Dubai Chain"]);
	});
});

describe("copy-forward never resurrects a sold piece", () => {
	it("leaves it behind when a fresh year inherits the previous one", async () => {
		await recordWeddingHistory();
		await markZakatGoldYearItemSold({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1446,
			lineageId: "chain",
		});

		const opened = await ensureZakatGoldYearItems({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1447,
		});

		expect(opened.origin).toBe("inherited");
		expect(opened.items.map((item) => item.lineageId).sort()).toEqual(["bangles", "wedding set"]);
		expect(await heldTitles(1447)).not.toContain("Chain");
	});

	it("leaves it behind when one year's holding is copied onto another", async () => {
		await recordWeddingHistory();
		await markZakatGoldYearItemSold({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1444,
			lineageId: "chain",
		});

		// 1443 still holds the chain; copying 1443 onto 1446 must not carry it over.
		expect(await heldTitles(1443)).toContain("Chain");
		await copyZakatGoldYearItems({
			userId: USER_ID,
			currency: CURRENCY,
			fromIslamicYear: 1443,
			toIslamicYear: 1446,
		});

		expect(await heldTitles(1446)).not.toContain("Chain");
	});

	it("leaves it behind across a range, without undoing the sale it passes through", async () => {
		await recordWeddingHistory();
		await markZakatGoldYearItemSold({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1445,
			lineageId: "chain",
		});

		await applyZakatGoldYearItemsToRange({
			userId: USER_ID,
			currency: CURRENCY,
			sourceIslamicYear: 1444,
			fromIslamicYear: 1444,
			throughIslamicYear: 1448,
		});

		expect(await heldTitles(1444)).toContain("Chain");
		for (const islamicYear of [1445, 1446, 1447, 1448]) {
			expect(await heldTitles(islamicYear)).not.toContain("Chain");
		}
		// Restating the years did not tombstone the one row that records the sale.
		expect((await getZakatGoldSoldLineages(USER_ID, CURRENCY)).get("chain")).toBe(1445);
	});
});

describe("removal is a correction, not a sale", () => {
	it("removes the piece from one year only and leaves no sale on the record", async () => {
		await recordWeddingHistory();

		await deleteZakatGoldYearItem(USER_ID, CURRENCY, 1444, "chain");

		expect(await heldTitles(1444)).not.toContain("Chain");
		// Every other year, before AND after, is untouched: nothing was sold.
		for (const islamicYear of [1443, 1445, 1446]) {
			expect(await heldTitles(islamicYear)).toContain("Chain");
		}
		expect((await getZakatGoldSoldLineages(USER_ID, CURRENCY)).size).toBe(0);
	});

	it("takes a sale back, so the piece counts again from the year it was sold in", async () => {
		await recordWeddingHistory();
		await markZakatGoldYearItemSold({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1445,
			lineageId: "chain",
		});
		expect(await heldTitles(1446)).not.toContain("Chain");

		await clearZakatGoldYearItemSold({ userId: USER_ID, currency: CURRENCY, lineageId: "chain" });

		expect((await getZakatGoldSoldLineages(USER_ID, CURRENCY)).size).toBe(0);
		for (const islamicYear of [1445, 1446]) {
			expect(await heldTitles(islamicYear)).toContain("Chain");
		}
	});
});

describe("the ledger and the holding read differently, on purpose", () => {
	it("keeps a sold piece in the record while dropping it from what a year is assessed on", () => {
		const base = {
			userId: USER_ID,
			currency: CURRENCY,
			lineageId: "chain",
			title: "Chain",
			weight: 10,
			purity: "21k" as GoldPurity,
			createdAt: 1_000,
			updatedAt: 2_000,
		};
		const records: ZakatGoldYearItem[] = [
			{ ...base, id: `${USER_ID}:PKR:1445:chain`, islamicYear: 1445 },
			{ ...base, id: `${USER_ID}:PKR:1446:chain`, islamicYear: 1446, soldInIslamicYear: 1446 },
		];

		const ledger = toZakatGoldYearItemLedger(records, CURRENCY);
		expect(ledger.get(1445)).toHaveLength(1);
		expect(ledger.get(1446)).toHaveLength(1);

		const held = toZakatGoldYearItemMap(records, CURRENCY);
		expect(held.get(1445)).toHaveLength(1);
		expect(held.get(1446)).toBeUndefined();

		expect(buildZakatGoldSoldLineages(records, CURRENCY).get("chain")).toBe(1446);
	});
});
