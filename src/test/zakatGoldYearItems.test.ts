/**
 * Gold HOLDINGS belong to a zakat year, piece by piece.
 *
 * Ground truth is the owner's own account of how his gold moved: 168.4 g of 21k from the
 * wedding, then "I did not sell all 168.4 g of 21k, instead I sold an item of 10 g from
 * it and bought 14 g of 22k instead, like that". Most pieces carry over untouched year to
 * year while the odd one leaves or arrives, and both the total and the karat mix move
 * with them.
 *
 * A single current inventory cannot say that: recording the sale would rewrite every
 * earlier year as though the piece had never been owned, which is the same failure class
 * as an opening balance applied retroactively. So each year owns its list, a fresh year
 * inherits the previous one's, and a piece keeps one identity across every year it was
 * held in.
 *
 * Nothing here computes tax. Zakat is a religious obligation; this file only proves the
 * owner's own holdings reproduce, year by year.
 */
import "fake-indexeddb/auto";

import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";

import { db, MizanTrackDB, MIZAN_TRACK_DEXIE_VERSION } from "@/lib/db/local";
import { calculateZakatAssessment, getZakatYearDefinitionByIslamicYear } from "@/lib/zakatEngine";
import { buildZakatWorkbook } from "@/lib/zakatExport";
import {
	applyZakatGoldYearItemsToRange,
	clearZakatGoldYearItems,
	copyZakatGoldYearItems,
	deleteZakatGoldYearItem,
	ensureZakatGoldYearItems,
	listZakatGoldYearItems,
	listZakatGoldYearItemsForYear,
	pinZakatGoldYearItems,
	saveZakatGoldYearItem,
	sumZakatGoldYearItemWeight,
} from "@/lib/zakatGoldYearItemRepository";
import {
	buildZakatGoldYearItemBackfill,
	buildZakatGoldYearItemId,
	parseZakatCalculationIslamicYear,
	toZakatGoldYearItemMap,
} from "@/lib/zakatGoldYearItems";
import {
	listZakatGoldYears,
	resolveZakatGoldGramsForYear,
	saveZakatGoldYearGrams,
	saveZakatGoldYearPrices,
	sumZakatGoldGrams,
	toZakatGoldItems,
	toZakatGoldYearMap,
} from "@/lib/zakatGoldYearRepository";
import {
	buildZakatYearAssessment,
	prepareZakatYearAssessmentContext,
} from "@/lib/zakatYearAssessment";

import type { GoldItem, GoldPurity, ZakatGoldYearItem } from "@/types";
import type * as XLSX from "xlsx";

const USER_ID = "zakat-gold-year-items-user";
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

async function itemsByYear(currency = CURRENCY): Promise<Map<number, ZakatGoldYearItem[]>> {
	return toZakatGoldYearItemMap(await listZakatGoldYearItems(USER_ID), currency);
}

/** The grams a year is assessed on, resolved exactly as the calculator resolves them. */
async function gramsFor(
	islamicYear: number,
	options: { inventory?: Pick<GoldItem, "weight" | "purity">[]; currency?: string } = {}
): Promise<Map<GoldPurity, number>> {
	const currency = options.currency ?? CURRENCY;
	return resolveZakatGoldGramsForYear({
		islamicYear,
		record: toZakatGoldYearMap(await listZakatGoldYears(USER_ID), currency).get(islamicYear),
		itemsByYear: await itemsByYear(currency),
		inventoryItems: options.inventory ?? [],
	});
}

async function goldValueFor(
	islamicYear: number,
	options: { inventory?: Pick<GoldItem, "weight" | "purity">[] } = {}
): Promise<number> {
	const record = toZakatGoldYearMap(await listZakatGoldYears(USER_ID), CURRENCY).get(islamicYear);
	return calculateZakatAssessment({
		monthlyTotals: [0],
		basis: "minimum",
		goldItems: toZakatGoldItems(await gramsFor(islamicYear, options)),
		goldPrices: {
			priceDate: "2023-03-24",
			pricesByPurity: record?.pricesByPurity ?? {},
		},
		ratePercent: 2.5,
		pastRemaining: 0,
		payments: [],
	}).goldValue;
}

/** The wedding holding, recorded for one year as three separate pieces. */
async function recordWeddingHolding(islamicYear: number): Promise<ZakatGoldYearItem[]> {
	const items: ZakatGoldYearItem[] = [];
	for (const piece of WEDDING_PIECES) items.push(await addPiece(islamicYear, piece));
	return items;
}

beforeEach(async () => {
	await Promise.all([
		db.zakatGoldYearItems.where("userId").equals(USER_ID).delete(),
		db.zakatGoldYears.where("userId").equals(USER_ID).delete(),
		db.goldItems.where("userId").equals(USER_ID).delete(),
	]);
});

describe("each zakat year holds its own gold", () => {
	it("values two years independently when their items, grams and purity differ", async () => {
		await addPiece(1443, { title: "Wedding Set", weight: 100, purity: "21k" });
		await addPiece(1446, { title: "New Set", weight: 80, purity: "22k" });
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1443,
			pricesByPurity: { "21k": 16_778.12 },
		});
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1446,
			pricesByPurity: { "22k": 24_000 },
		});

		expect([...(await gramsFor(1443))]).toEqual([["21k", 100]]);
		expect([...(await gramsFor(1446))]).toEqual([["22k", 80]]);
		expect(await goldValueFor(1443)).toBeCloseTo(1_677_812, 4);
		expect(await goldValueFor(1446)).toBeCloseTo(1_920_000, 4);
	});

	/**
	 * The owner's own scenario, verbatim: 168.4 g of 21k from the wedding, carried for
	 * years; later ONE 10 g piece is sold and 14 g of 22k bought instead. The early years
	 * must still report 168.4 g of 21k — losing a gram of it would be the present rewriting
	 * history, which is exactly what per-year holdings exist to stop.
	 */
	it("leaves the early years untouched when a piece is sold years later", async () => {
		await recordWeddingHolding(1440);
		await copyZakatGoldYearItems({
			userId: USER_ID,
			currency: CURRENCY,
			fromIslamicYear: 1440,
			toIslamicYear: 1441,
		});
		await copyZakatGoldYearItems({
			userId: USER_ID,
			currency: CURRENCY,
			fromIslamicYear: 1441,
			toIslamicYear: 1446,
		});

		const chain = (await listZakatGoldYearItemsForYear(USER_ID, CURRENCY, 1446)).find(
			(item) => item.title === "Chain"
		)!;
		await deleteZakatGoldYearItem(USER_ID, CURRENCY, 1446, chain.lineageId);
		await addPiece(1446, { title: "New Bangle", weight: 14, purity: "22k" });

		for (const islamicYear of [1440, 1441]) {
			const grams = await gramsFor(islamicYear);
			expect(grams.get("21k")).toBeCloseTo(168.4, 6);
			expect(grams.get("22k")).toBeUndefined();
			expect(sumZakatGoldGrams(grams)).toBeCloseTo(168.4, 6);
		}

		const later = await gramsFor(1446);
		expect(later.get("21k")).toBeCloseTo(158.4, 6);
		expect(later.get("22k")).toBeCloseTo(14, 6);
		expect(sumZakatGoldGrams(later)).toBeCloseTo(172.4, 6);

		// The sold piece is still in the record for the years it was held.
		expect(
			(await listZakatGoldYearItemsForYear(USER_ID, CURRENCY, 1440)).map((item) => item.title)
		).toContain("Chain");
	});

	it("values a year with no gold recorded at zero rather than borrowing another's", async () => {
		await recordWeddingHolding(1443);
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1444,
			pricesByPurity: { "21k": 18_846.3 },
		});

		// 1444 holds nothing of its own, and 1443's gold is 1443's.
		expect([...(await gramsFor(1444))]).toEqual([]);
		expect(await goldValueFor(1444)).toBe(0);
		// Not even the shared holding leaks in once years hold their own gold.
		expect([...(await gramsFor(1444, { inventory: [{ weight: 500, purity: "21k" }] }))]).toEqual(
			[]
		);
	});

	it("keeps one currency's holding out of another's", async () => {
		await addPiece(1444, { title: "Wedding Set", weight: 100, purity: "21k" });
		await saveZakatGoldYearItem({
			userId: USER_ID,
			currency: "AED",
			islamicYear: 1444,
			title: "Dubai Chain",
			weight: 25,
			purity: "22k",
		});

		expect([...(await gramsFor(1444))]).toEqual([["21k", 100]]);
		expect([...(await gramsFor(1444, { currency: "aed " }))]).toEqual([["22k", 25]]);
	});
});

describe("copy-forward", () => {
	it("inherits the previous year's list when a fresh year is opened", async () => {
		await recordWeddingHolding(1443);

		const opened = await ensureZakatGoldYearItems({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1446,
		});

		expect(opened.origin).toBe("inherited");
		expect(opened.inheritedFromIslamicYear).toBe(1443);
		expect(opened.items.map((item) => item.title)).toEqual(["Wedding Set", "Bangles", "Chain"]);
		expect(sumZakatGoldYearItemWeight(opened.items)).toBeCloseTo(168.4, 6);
	});

	it("never inherits from a LATER year", async () => {
		await recordWeddingHolding(1446);

		const opened = await ensureZakatGoldYearItems({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1443,
		});

		expect(opened.origin).toBe("empty");
		expect(opened.items).toEqual([]);
	});

	it("leaves the year it came from alone once the inherited year is edited", async () => {
		await recordWeddingHolding(1443);
		await ensureZakatGoldYearItems({ userId: USER_ID, currency: CURRENCY, islamicYear: 1446 });

		const chain = (await listZakatGoldYearItemsForYear(USER_ID, CURRENCY, 1446)).find(
			(item) => item.title === "Chain"
		)!;
		await deleteZakatGoldYearItem(USER_ID, CURRENCY, 1446, chain.lineageId);
		const set = (await listZakatGoldYearItemsForYear(USER_ID, CURRENCY, 1446)).find(
			(item) => item.title === "Wedding Set"
		)!;
		await addPiece(1446, { title: "Wedding Set", weight: 90, purity: "22k" }, set.lineageId);

		const source = await listZakatGoldYearItemsForYear(USER_ID, CURRENCY, 1443);
		expect(source.map((item) => [item.title, item.weight, item.purity])).toEqual([
			["Wedding Set", 100, "21k"],
			["Bangles", 58.4, "21k"],
			["Chain", 10, "21k"],
		]);
		expect(sumZakatGoldYearItemWeight(source)).toBeCloseTo(168.4, 6);
		expect(
			sumZakatGoldYearItemWeight(await listZakatGoldYearItemsForYear(USER_ID, CURRENCY, 1446))
		).toBeCloseTo(148.4, 6);
	});

	it("carries a piece's identity across every year it is held in", async () => {
		const [weddingSet] = await recordWeddingHolding(1440);
		await ensureZakatGoldYearItems({ userId: USER_ID, currency: CURRENCY, islamicYear: 1441 });
		await ensureZakatGoldYearItems({ userId: USER_ID, currency: CURRENCY, islamicYear: 1446 });

		const lineageId = weddingSet!.lineageId;
		for (const islamicYear of [1440, 1441, 1446]) {
			const held = (await listZakatGoldYearItemsForYear(USER_ID, CURRENCY, islamicYear)).find(
				(item) => item.lineageId === lineageId
			);
			expect(held?.title).toBe("Wedding Set");
			// The row key is derived from the lineage, so two devices inheriting the same
			// year converge on one row instead of duplicating the gold.
			expect(held?.id).toBe(buildZakatGoldYearItemId(USER_ID, CURRENCY, islamicYear, lineageId));
			expect(held?.createdAt).toBe(weddingSet!.createdAt);
		}
	});

	it("re-opening a year it has already filled changes nothing", async () => {
		await recordWeddingHolding(1443);
		await ensureZakatGoldYearItems({ userId: USER_ID, currency: CURRENCY, islamicYear: 1446 });
		const first = await listZakatGoldYearItemsForYear(USER_ID, CURRENCY, 1446);

		const again = await ensureZakatGoldYearItems({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1446,
		});

		expect(again.origin).toBe("existing");
		expect(again.items.map((item) => item.id)).toEqual(first.map((item) => item.id));
	});

	it("seeds from the shared holding when there is no earlier year to inherit", async () => {
		await db.goldItems.bulkPut([
			{
				id: "gold-wedding",
				userId: USER_ID,
				currency: CURRENCY,
				title: "Wedding Set",
				weight: 100,
				purity: "21k",
				updatedAt: 1_000,
			},
			{
				id: "gold-sold",
				userId: USER_ID,
				currency: CURRENCY,
				title: "Sold Ring",
				weight: 5,
				purity: "22k",
				updatedAt: 1_000,
				deletedAt: 2_000,
			},
		]);

		const opened = await ensureZakatGoldYearItems({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1446,
		});

		expect(opened.origin).toBe("inventory");
		expect(opened.items.map((item) => item.title)).toEqual(["Wedding Set"]);
		// The inventory row's own id becomes the lineage, so the piece keeps one identity.
		expect(opened.items[0]?.lineageId).toBe("gold-wedding");
		expect(opened.items[0]?.sourceGoldItemId).toBe("gold-wedding");
	});

	it("materialises a legacy pinned weight rather than inheriting over the top of it", async () => {
		await recordWeddingHolding(1443);
		await saveZakatGoldYearGrams({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1444,
			gramsByPurity: { "21k": 170.52 },
		});

		const opened = await ensureZakatGoldYearItems({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1444,
		});

		expect(opened.origin).toBe("pinned");
		expect(sumZakatGoldYearItemWeight(opened.items)).toBeCloseTo(170.52, 6);
		expect((await gramsFor(1444)).get("21k")).toBeCloseTo(170.52, 6);
	});
});

describe("stating one holding across a stretch of years", () => {
	it("sets every year in the range, and only those years", async () => {
		await recordWeddingHolding(1441);
		await addPiece(1446, { title: "New Bangle", weight: 14, purity: "22k" });

		const applied = await applyZakatGoldYearItemsToRange({
			userId: USER_ID,
			currency: CURRENCY,
			sourceIslamicYear: 1441,
			fromIslamicYear: 1441,
			throughIslamicYear: 1444,
		});

		expect(applied).toEqual([1441, 1442, 1443, 1444]);
		for (const islamicYear of applied) {
			expect(sumZakatGoldGrams(await gramsFor(islamicYear))).toBeCloseTo(168.4, 6);
		}
		// The years outside the range kept what they had.
		expect([...(await gramsFor(1440))]).toEqual([]);
		expect([...(await gramsFor(1446))]).toEqual([["22k", 14]]);
	});

	it("replaces a year's holding rather than piling onto it", async () => {
		await recordWeddingHolding(1441);
		await addPiece(1443, { title: "Stale Ring", weight: 40, purity: "24k" });

		await applyZakatGoldYearItemsToRange({
			userId: USER_ID,
			currency: CURRENCY,
			sourceIslamicYear: 1441,
			fromIslamicYear: 1443,
			throughIslamicYear: 1443,
		});

		const held = await listZakatGoldYearItemsForYear(USER_ID, CURRENCY, 1443);
		expect(held.map((item) => item.title)).toEqual(["Wedding Set", "Bangles", "Chain"]);
		expect(sumZakatGoldGrams(await gramsFor(1443))).toBeCloseTo(168.4, 6);
	});
});

describe("an assessed year stops drifting", () => {
	it("pins the holding a saved calculation was assessed on", async () => {
		await recordWeddingHolding(1443);

		// Saving a calculation for the NEXT year pins what that year was assessed on.
		const pinned = await pinZakatGoldYearItems({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1444,
		});
		expect(sumZakatGoldYearItemWeight(pinned)).toBeCloseTo(168.4, 6);

		// A later sale touches the year it happened in, never the pinned one.
		const chain = (await listZakatGoldYearItemsForYear(USER_ID, CURRENCY, 1446)).length;
		expect(chain).toBe(0);
		const pinnedChain = (await listZakatGoldYearItemsForYear(USER_ID, CURRENCY, 1444)).find(
			(item) => item.title === "Chain"
		)!;
		await deleteZakatGoldYearItem(USER_ID, CURRENCY, 1443, pinnedChain.lineageId);

		expect(sumZakatGoldGrams(await gramsFor(1444))).toBeCloseTo(168.4, 6);
		expect(sumZakatGoldGrams(await gramsFor(1443))).toBeCloseTo(158.4, 6);
	});
});

describe("per-year holdings through Dexie", () => {
	it("round-trips a piece, queued for the next sync", async () => {
		const saved = await addPiece(1444, { title: "Wedding Set", weight: 100, purity: "21k" });
		const stored = await db.zakatGoldYearItems.get(saved.id);

		expect(stored).toMatchObject({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1444,
			title: "Wedding Set",
			weight: 100,
			purity: "21k",
			// Written through the dirty hooks, so it is queued for the next sync.
			pendingSync: true,
		});
		expect(stored?.deletedAt).toBeUndefined();
	});

	it("tombstones a sold piece so the sale reaches the other devices", async () => {
		const saved = await addPiece(1446, { title: "Chain", weight: 10, purity: "21k" });
		await deleteZakatGoldYearItem(USER_ID, CURRENCY, 1446, saved.lineageId);

		expect((await db.zakatGoldYearItems.get(saved.id))?.deletedAt).toBeGreaterThan(0);
		expect(await listZakatGoldYearItemsForYear(USER_ID, CURRENCY, 1446)).toEqual([]);
	});

	it("tombstones every piece when a year's holding is cleared", async () => {
		await recordWeddingHolding(1443);
		await clearZakatGoldYearItems(USER_ID, CURRENCY, 1443);

		expect(await listZakatGoldYearItemsForYear(USER_ID, CURRENCY, 1443)).toEqual([]);
		expect(
			(await db.zakatGoldYearItems.where("userId").equals(USER_ID).toArray()).every(
				(item) => item.deletedAt
			)
		).toBe(true);
	});

	it("reaches the calculator through the same assembly every screen uses", async () => {
		await recordWeddingHolding(1444);
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1444,
			pricesByPurity: { "21k": 18_846.3 },
		});

		const context = prepareZakatYearAssessmentContext({
			userId: USER_ID,
			referenceCurrency: CURRENCY,
			accounts: [],
			transactions: [],
			goldItems: [],
			goldYears: await listZakatGoldYears(USER_ID),
			goldYearItems: await listZakatGoldYearItems(USER_ID),
			yearOverrides: [],
			payments: [],
		});

		const assessed = buildZakatYearAssessment(context, 1444);
		expect(assessed.totalGoldWeightGrams).toBeCloseTo(168.4, 6);
		expect(assessed.goldItems.map((item) => item.title)).toEqual([
			"Wedding Set",
			"Bangles",
			"Chain",
		]);
		expect(assessed.assessment.goldValue).toBeCloseTo(168.4 * 18_846.3, 4);
		// A year with nothing recorded borrows nothing.
		expect(buildZakatYearAssessment(context, 1446).assessment.goldValue).toBe(0);
	});
});

// ─── Migration ───────────────────────────────────────────────────────────────

describe("moving an existing holding into the per-year model", () => {
	it("gives each settled year the holding it was assessed on", () => {
		const now = 5_000;
		const rows = buildZakatGoldYearItemBackfill({
			goldItems: [
				{
					id: "gold-1",
					userId: USER_ID,
					currency: CURRENCY,
					title: "Wedding Set",
					weight: 100,
					purity: "21k",
					updatedAt: 1_000,
				},
				{
					id: "gold-2",
					userId: USER_ID,
					currency: CURRENCY,
					title: "Bangles",
					weight: 70.52,
					purity: "21k",
					updatedAt: 1_100,
				},
			],
			goldYears: [
				{
					id: `${USER_ID}:PKR:1443`,
					userId: USER_ID,
					currency: CURRENCY,
					islamicYear: 1443,
					pricesByPurity: { "21k": 16_778.12 },
					updatedAt: 1_000,
				},
				{
					id: `${USER_ID}:PKR:1444`,
					userId: USER_ID,
					currency: CURRENCY,
					islamicYear: 1444,
					pricesByPurity: { "21k": 18_846.3 },
					gramsByPurity: { "21k": 170.52 },
					updatedAt: 1_000,
				},
			],
			calculations: [
				{ userId: USER_ID, currency: CURRENCY, islamicYear: "1446-1447" },
				// Already covered above; the year must not be seeded twice.
				{ userId: USER_ID, currency: CURRENCY, islamicYear: "1443-1444" },
			],
			now,
		});

		const byYear = toZakatGoldYearItemMap(rows, CURRENCY);
		// The unpinned year keeps the holding it showed: the inventory, itemised.
		expect(byYear.get(1443)?.map((item) => item.title)).toEqual(["Wedding Set", "Bangles"]);
		// The pinned year keeps its pinned weight to the gram.
		expect(sumZakatGoldYearItemWeight(byYear.get(1444) ?? [])).toBeCloseTo(170.52, 6);
		expect(byYear.get(1444)?.map((item) => item.lineageId)).toEqual(["karat-21k"]);
		// A year that only ever had a saved calculation is settled too.
		expect(sumZakatGoldYearItemWeight(byYear.get(1446) ?? [])).toBeCloseTo(170.52, 6);
		expect(byYear.get(1443)).toHaveLength(2);
	});

	it("reads the Islamic year out of a saved calculation's label", () => {
		expect(parseZakatCalculationIslamicYear("1446-1447")).toBe(1446);
		expect(parseZakatCalculationIslamicYear("1447")).toBe(1447);
		expect(parseZakatCalculationIslamicYear("")).toBeUndefined();
	});

	it("upgrades a version 13 database without losing the gold it already held", async () => {
		const databaseName = "mizantrack-v13-gold-year-items-upgrade-test";
		const migrationUserId = "user-gold-v13";
		await Dexie.delete(databaseName);

		const legacyDb = new Dexie(databaseName);
		legacyDb.version(13).stores({
			accounts: "id, userId, isArchived, accountType, sourceId, updatedAt, deletedAt, pendingSync",
			categories: "id, userId, type, currency, sourceId, updatedAt, deletedAt, pendingSync",
			transactions:
				"id, userId, [userId+date], type, date, accountId, categoryId, toAccountId, sourceId, updatedAt, deletedAt, pendingSync",
			budgets:
				"id, userId, categoryId, period, [userId+period], [categoryId+period], sourceId, updatedAt, deletedAt, pendingSync",
			dbConfig: "id",
			syncMeta: "id",
			dashboardStats: "id, updatedAt",
			goldItems:
				"id, userId, currency, [userId+currency], purity, updatedAt, deletedAt, pendingSync",
			zakatCalculations:
				"id, userId, currency, [userId+currency], islamicYear, assessmentDate, updatedAt, deletedAt, pendingSync",
			zakatPayments:
				"id, userId, currency, [userId+currency], islamicYear, date, calculationId, updatedAt, deletedAt, pendingSync",
			reportAccountTags:
				"id, userId, accountId, [userId+accountId], updatedAt, deletedAt, pendingSync",
			reportProjects: "id, userId, updatedAt, deletedAt, pendingSync",
			reportTransactionTags:
				"id, userId, transactionId, projectId, [userId+transactionId], role, updatedAt, deletedAt, pendingSync",
			reportManualEntries:
				"id, userId, fiscalYearKey, section, [userId+fiscalYearKey], updatedAt, deletedAt, pendingSync",
			reportMonthlySalaryRows:
				"id, userId, fiscalYearKey, monthKey, [userId+fiscalYearKey], updatedAt, deletedAt, pendingSync",
			zakatYears:
				"id, userId, islamicYear, [userId+islamicYear], updatedAt, deletedAt, pendingSync",
			zakatGoldYears:
				"id, userId, currency, islamicYear, [userId+currency], [userId+islamicYear], updatedAt, deletedAt, pendingSync",
		});

		await legacyDb.open();
		await legacyDb.table("goldItems").bulkPut([
			{
				id: "gold-wedding",
				userId: migrationUserId,
				currency: "PKR",
				title: "Wedding Set",
				weight: 100,
				purity: "21k",
				updatedAt: 9_000,
			},
			{
				id: "gold-bangles",
				userId: migrationUserId,
				currency: "PKR",
				title: "Bangles",
				weight: 68.4,
				purity: "21k",
				updatedAt: 9_100,
			},
		]);
		await legacyDb.table("zakatGoldYears").put({
			id: `${migrationUserId}:PKR:1444`,
			userId: migrationUserId,
			currency: "PKR",
			islamicYear: 1444,
			pricesByPurity: { "21k": 18_846.3 },
			updatedAt: 9_000,
		});
		legacyDb.close();

		const upgradedDb = new MizanTrackDB(databaseName);
		try {
			await upgradedDb.open();

			expect(upgradedDb.verno).toBe(MIZAN_TRACK_DEXIE_VERSION);

			// The yearless holding is untouched — it is still the current holding, and
			// still what the sheet exports read.
			expect(await upgradedDb.goldItems.get("gold-wedding")).toMatchObject({
				title: "Wedding Set",
				weight: 100,
				currency: "PKR",
			});
			expect(await upgradedDb.goldItems.where("userId").equals(migrationUserId).count()).toBe(2);

			// And the year the owner had already priced keeps exactly what it showed.
			const migrated = await upgradedDb.zakatGoldYearItems
				.where("userId")
				.equals(migrationUserId)
				.toArray();
			expect(migrated.map((item) => item.title).sort()).toEqual(["Bangles", "Wedding Set"]);
			expect(migrated.every((item) => item.islamicYear === 1444)).toBe(true);
			expect(migrated.every((item) => item.pendingSync)).toBe(true);
			expect(sumZakatGoldYearItemWeight(migrated)).toBeCloseTo(168.4, 6);
		} finally {
			upgradedDb.close();
			await Dexie.delete(databaseName);
		}
	});

	it("still values a legacy holding that was never migrated", async () => {
		const inventory: Pick<GoldItem, "weight" | "purity">[] = [
			{ weight: 100, purity: "21k" },
			{ weight: 70.52, purity: "21k" },
		];

		// No year holds anything of its own, so every year reads the shared holding —
		// which is exactly what it did before gold belonged to a year.
		expect((await gramsFor(1444, { inventory })).get("21k")).toBeCloseTo(170.52, 6);
		expect((await gramsFor(1443, { inventory })).get("21k")).toBeCloseTo(170.52, 6);
	});
});

// ─── Export ──────────────────────────────────────────────────────────────────

function cell(sheet: XLSX.WorkSheet, ref: string): XLSX.CellObject {
	const found = sheet[ref] as XLSX.CellObject | undefined;
	expect(found, `Expected a cell at ${ref}`).toBeDefined();
	return found!;
}

describe("the exported sheet shows the gold that year actually held", () => {
	it("writes each year's own karats, with grams and price still editable inputs", async () => {
		await recordWeddingHolding(1443);
		await copyZakatGoldYearItems({
			userId: USER_ID,
			currency: CURRENCY,
			fromIslamicYear: 1443,
			toIslamicYear: 1444,
		});
		const chain = (await listZakatGoldYearItemsForYear(USER_ID, CURRENCY, 1444)).find(
			(item) => item.title === "Chain"
		)!;
		await deleteZakatGoldYearItem(USER_ID, CURRENCY, 1444, chain.lineageId);
		await addPiece(1444, { title: "New Bangle", weight: 14, purity: "22k" });

		for (const [islamicYear, prices] of [
			[1443, { "21k": 16_778.12 }],
			[1444, { "21k": 18_846.3, "22k": 19_600 }],
		] as const) {
			await saveZakatGoldYearPrices({
				userId: USER_ID,
				currency: CURRENCY,
				islamicYear,
				pricesByPurity: prices,
			});
		}

		const byYearRecord = toZakatGoldYearMap(await listZakatGoldYears(USER_ID), CURRENCY);
		const years = await Promise.all(
			[1443, 1444].map(async (islamicYear) => {
				const prices = byYearRecord.get(islamicYear)?.pricesByPurity ?? {};
				const definition = getZakatYearDefinitionByIslamicYear(islamicYear);
				return {
					grid: {
						year: { ...definition, sheetYear: islamicYear === 1443 ? 2022 : 2023 },
						accounts: [
							{
								accountId: "meezan",
								accountTitle: "Meezan (Default)",
								currency: CURRENCY,
								accountType: "asset" as const,
								isArchived: false,
								balances: Array.from({ length: 12 }, () => 1_000),
							},
						],
						monthlyTotals: Array.from({ length: 12 }, () => 1_000),
						minimum: 1_000,
						maximum: 1_000,
					},
					currency: CURRENCY,
					basis: "minimum" as const,
					ratePercent: 2.5,
					goldRows: [...(await gramsFor(islamicYear)).entries()].map(([purity, grams]) => ({
						purity,
						grams,
						pricePerGram: prices[purity] ?? 0,
					})),
					goldPriceDate: definition.months[0]!.startDate,
					pastRemaining: 0,
					payments: [],
				};
			})
		);

		const workbook = buildZakatWorkbook({ years });
		const [first, second] = workbook.SheetNames;
		const sheet1443 = workbook.Sheets[first!]!;
		const sheet1444 = workbook.Sheets[second!]!;

		// One account row, so the gold block always lands on the same rows.
		expect(cell(sheet1443, "C9").v).toBeCloseTo(168.4, 6);
		expect(cell(sheet1443, "D9").v).toBe(16_778.12);
		expect(cell(sheet1443, "E9").f).toBe("PRODUCT(C9,D9)");
		expect(cell(sheet1443, "E9").v).toBeCloseTo(168.4 * 16_778.12, 4);

		// The later year carries its own mix: 158.4 g of 21k and 14 g of 22k.
		expect(cell(sheet1444, "C9").v).toBeCloseTo(158.4, 6);
		expect(cell(sheet1444, "D9").v).toBe(18_846.3);
		expect(cell(sheet1444, "C10").v).toBeCloseTo(14, 6);
		expect(cell(sheet1444, "D10").v).toBe(19_600);
		expect(cell(sheet1444, "E10").f).toBe("PRODUCT(C10,D10)");
	});
});
