/**
 * Gold belongs to a zakat year.
 *
 * Ground truth is `docs/zakat-requirements-2026-10.md` — section 4.3 for the formula and
 * section 7 for the owner's history, where the SAME 170.52 g of 21k gold is valued at
 * 10,725 per gram in `2022`, 16,778.12 in `2023` and 18,846.3 in `2024`. The weight is
 * what persists; the price is what belongs to the year, and the owner types it in.
 *
 * So the inventory is never duplicated per year: `goldItems` stays one list and only the
 * per-year price — plus an optional grams snapshot — is stored per zakat year.
 *
 * Nothing here computes tax. Zakat is a religious obligation; this file only proves the
 * owner's own per-year figures reproduce.
 */
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/local";
import { calculateZakatAssessment, getZakatYearDefinitionByIslamicYear } from "@/lib/zakatEngine";
import { buildZakatWorkbook } from "@/lib/zakatExport";
import {
	buildZakatGoldYearId,
	clearZakatGoldYear,
	clearZakatGoldYearGrams,
	getZakatGoldGramsByPurity,
	getZakatGoldYearPrices,
	hasZakatGoldYearGramsSnapshot,
	listZakatGoldYears,
	resolveZakatGoldGramsByPurity,
	saveZakatGoldYearGrams,
	saveZakatGoldYearPrices,
	sumZakatGoldGrams,
	toZakatGoldItems,
	toZakatGoldYearMap,
} from "@/lib/zakatGoldYearRepository";

import type { ZakatAccountMonthBalance, ZakatYearGrid } from "@/lib/zakatEngine";
import type { GoldItem, GoldPurity, ZakatGoldYear } from "@/types";
import type * as XLSX from "xlsx";

const USER_ID = "zakat-gold-year-user";
const CURRENCY = "PKR";

/** The owner's holding, carried unchanged from `2021` through `2024`. */
const INVENTORY: Pick<GoldItem, "weight" | "purity">[] = [
	{ weight: 100, purity: "21k" },
	{ weight: 70.52, purity: "21k" },
];

/** Price per gram for 21k, verbatim from the history table in spec section 7. */
const PRICE_BY_ISLAMIC_YEAR: Record<number, number> = {
	1442: 10_725,
	1443: 16_778.12,
	1444: 18_846.3,
};

function goldValueFor(record: ZakatGoldYear | undefined): number {
	const gramsByPurity = resolveZakatGoldGramsByPurity(record, INVENTORY);
	return calculateZakatAssessment({
		monthlyTotals: [0],
		basis: "minimum",
		goldItems: toZakatGoldItems(gramsByPurity),
		goldPrices: {
			priceDate: "2023-03-24",
			pricesByPurity: getZakatGoldYearPrices(record),
		},
		ratePercent: 2.5,
		pastRemaining: 0,
		payments: [],
	}).goldValue;
}

async function priceEveryYear(): Promise<void> {
	for (const [islamicYear, pricePerGram] of Object.entries(PRICE_BY_ISLAMIC_YEAR)) {
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: Number(islamicYear),
			pricesByPurity: { "21k": pricePerGram },
		});
	}
}

async function goldYearsForCurrency(currency = CURRENCY): Promise<Map<number, ZakatGoldYear>> {
	return toZakatGoldYearMap(await listZakatGoldYears(USER_ID), currency);
}

beforeEach(async () => {
	await db.zakatGoldYears.where("userId").equals(USER_ID).delete();
});

describe("per-year gold pricing", () => {
	it("values the same weight differently in every year, as the owner's sheets do", async () => {
		await priceEveryYear();
		const byYear = await goldYearsForCurrency();

		// Weight is identical in all three years; only the price moved.
		for (const islamicYear of [1442, 1443, 1444]) {
			expect(
				sumZakatGoldGrams(resolveZakatGoldGramsByPurity(byYear.get(islamicYear), INVENTORY))
			).toBeCloseTo(170.52, 6);
		}

		expect(goldValueFor(byYear.get(1442))).toBeCloseTo(1_828_827, 4);
		expect(goldValueFor(byYear.get(1443))).toBeCloseTo(2_861_005.0224, 4);
		expect(goldValueFor(byYear.get(1444))).toBeCloseTo(3_213_671.076, 4);
	});

	it("never shares a price between years", async () => {
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1444,
			pricesByPurity: { "21k": 18_846.3 },
		});

		const byYear = await goldYearsForCurrency();

		expect(getZakatGoldYearPrices(byYear.get(1444))).toEqual({ "21k": 18_846.3 });
		// An unpriced year contributes no gold value rather than borrowing another's price.
		expect(getZakatGoldYearPrices(byYear.get(1443))).toEqual({});
		expect(goldValueFor(byYear.get(1443))).toBe(0);
	});

	it("rolls itemised pieces up per karat and prices 21k and 22k separately", async () => {
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1446,
			pricesByPurity: { "21k": 20_000, "22k": 21_000 },
		});

		const mixed: Pick<GoldItem, "weight" | "purity">[] = [
			{ weight: 100, purity: "21k" },
			{ weight: 70.52, purity: "21k" },
			{ weight: 30, purity: "22k" },
		];
		const grams = getZakatGoldGramsByPurity(mixed);
		expect(grams.get("21k")).toBeCloseTo(170.52, 6);
		expect(grams.get("22k")).toBe(30);

		const record = (await goldYearsForCurrency()).get(1446);
		const value = calculateZakatAssessment({
			monthlyTotals: [0],
			basis: "minimum",
			goldItems: toZakatGoldItems(resolveZakatGoldGramsByPurity(record, mixed)),
			goldPrices: { priceDate: "2025-03-02", pricesByPurity: getZakatGoldYearPrices(record) },
			ratePercent: 2.5,
			pastRemaining: 0,
			payments: [],
		}).goldValue;

		expect(value).toBeCloseTo(170.52 * 20_000 + 30 * 21_000, 4);
	});

	it("keeps each currency's prices to itself", async () => {
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: "PKR",
			islamicYear: 1444,
			pricesByPurity: { "21k": 18_846.3 },
		});
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: "AED",
			islamicYear: 1444,
			pricesByPurity: { "21k": 245 },
		});

		expect(getZakatGoldYearPrices((await goldYearsForCurrency("PKR")).get(1444))).toEqual({
			"21k": 18_846.3,
		});
		expect(getZakatGoldYearPrices((await goldYearsForCurrency("aed ")).get(1444))).toEqual({
			"21k": 245,
		});
	});
});

describe("per-year gold persistence", () => {
	it("round-trips the price and its effective date through Dexie", async () => {
		const priceDate = getZakatYearDefinitionByIslamicYear(1444).months[0]!.startDate.getTime();
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: "pkr ",
			islamicYear: 1444,
			pricesByPurity: { "21k": 18_846.3 },
			priceDate,
		});

		const stored = await db.zakatGoldYears.get(buildZakatGoldYearId(USER_ID, "PKR", 1444));

		expect(stored).toMatchObject({
			userId: USER_ID,
			currency: "PKR",
			islamicYear: 1444,
			pricesByPurity: { "21k": 18_846.3 },
			priceDate,
			// Written through the dirty hooks, so the record is queued for the next sync.
			pendingSync: true,
		});
		expect(stored?.deletedAt).toBeUndefined();
	});

	it("pins a year's weight so a later inventory edit cannot rewrite it", async () => {
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1443,
			pricesByPurity: { "21k": 16_778.12 },
		});
		await saveZakatGoldYearGrams({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1443,
			gramsByPurity: getZakatGoldGramsByPurity(INVENTORY),
		});

		const pinned = (await goldYearsForCurrency()).get(1443);
		expect(hasZakatGoldYearGramsSnapshot(pinned)).toBe(true);
		// The price survives the snapshot: the two are independent inputs on one row.
		expect(getZakatGoldYearPrices(pinned)).toEqual({ "21k": 16_778.12 });

		const soldSomeGold: Pick<GoldItem, "weight" | "purity">[] = [{ weight: 20, purity: "21k" }];
		expect(sumZakatGoldGrams(resolveZakatGoldGramsByPurity(pinned, soldSomeGold))).toBeCloseTo(
			170.52,
			6
		);
		expect(goldValueFor(pinned)).toBeCloseTo(2_861_005.0224, 4);
	});

	it("follows the inventory again once the snapshot is cleared", async () => {
		await saveZakatGoldYearGrams({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1443,
			gramsByPurity: { "21k": 170.52 },
		});
		await clearZakatGoldYearGrams(USER_ID, CURRENCY, 1443);

		const record = (await goldYearsForCurrency()).get(1443);
		expect(hasZakatGoldYearGramsSnapshot(record)).toBe(false);
		expect(
			sumZakatGoldGrams(resolveZakatGoldGramsByPurity(record, [{ weight: 20, purity: "21k" }]))
		).toBe(20);
	});

	it("tombstones a cleared year so the reset reaches the other devices", async () => {
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1444,
			pricesByPurity: { "21k": 18_846.3 },
		});
		await clearZakatGoldYear(USER_ID, CURRENCY, 1444);

		const stored = await db.zakatGoldYears.get(buildZakatGoldYearId(USER_ID, CURRENCY, 1444));
		expect(stored?.deletedAt).toBeGreaterThan(0);
		expect((await goldYearsForCurrency()).get(1444)).toBeUndefined();
	});

	it("refuses an unusable price rather than storing a NaN", async () => {
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: CURRENCY,
			islamicYear: 1444,
			pricesByPurity: { "21k": Number.NaN, "22k": -5, "24k": 0 },
		});

		expect(getZakatGoldYearPrices((await goldYearsForCurrency()).get(1444))).toEqual({});
	});
});

// ─── Export ──────────────────────────────────────────────────────────────────

function makeGrid(islamicYear: number, sheetYear: number): ZakatYearGrid {
	const account: ZakatAccountMonthBalance = {
		accountId: "meezan",
		accountTitle: "Meezan (Default)",
		currency: CURRENCY,
		accountType: "asset",
		isArchived: false,
		balances: Array.from({ length: 12 }, () => 1_000),
	};
	const monthlyTotals = Array.from({ length: 12 }, () => 1_000);

	return {
		year: { ...getZakatYearDefinitionByIslamicYear(islamicYear), sheetYear },
		accounts: [account],
		monthlyTotals,
		minimum: 1_000,
		maximum: 1_000,
	};
}

function cell(sheet: XLSX.WorkSheet, ref: string): XLSX.CellObject {
	const found = sheet[ref] as XLSX.CellObject | undefined;
	expect(found, `Expected a cell at ${ref}`).toBeDefined();
	return found!;
}

describe("export reflects the selected year's gold price and payments", () => {
	it("writes each year's own grams, price and payments, with the formulas still live", async () => {
		await priceEveryYear();
		const byYear = await goldYearsForCurrency();

		const years = [1443, 1444].map((islamicYear) => {
			const record = byYear.get(islamicYear);
			const gramsByPurity = resolveZakatGoldGramsByPurity(record, INVENTORY);
			const prices = getZakatGoldYearPrices(record);

			return {
				grid: makeGrid(islamicYear, islamicYear === 1443 ? 2023 : 2024),
				currency: CURRENCY,
				basis: "minimum" as const,
				ratePercent: 2.5,
				goldRows: [...gramsByPurity.entries()].map(([purity, grams]) => ({
					purity,
					grams,
					pricePerGram: prices[purity as GoldPurity] ?? 0,
				})),
				goldPriceDate: getZakatYearDefinitionByIslamicYear(islamicYear).months[0]!.startDate,
				pastRemaining: 0,
				payments: [{ amount: islamicYear === 1443 ? 66_000 : 285_500, person: "Masjid" }],
			};
		});

		const workbook = buildZakatWorkbook({ years });
		const [first, second] = workbook.SheetNames;
		const sheet2023 = workbook.Sheets[first!]!;
		const sheet2024 = workbook.Sheets[second!]!;

		// One account row, so the gold block always lands on the same rows.
		expect(cell(sheet2023, "C9").v).toBeCloseTo(170.52, 6);
		expect(cell(sheet2023, "D9").v).toBe(16_778.12);
		expect(cell(sheet2024, "C9").v).toBeCloseTo(170.52, 6);
		expect(cell(sheet2024, "D9").v).toBe(18_846.3);

		// Grams and price stay separate editable inputs feeding a live PRODUCT.
		expect(cell(sheet2023, "E9").f).toBe("PRODUCT(C9,D9)");
		expect(cell(sheet2023, "E9").v).toBeCloseTo(2_861_005.0224, 4);
		expect(cell(sheet2024, "E9").v).toBeCloseTo(3_213_671.076, 4);

		// Each sheet carries only its own year's payments, below the silver block.
		expect(cell(sheet2023, "D17").v).toBe(66_000);
		expect(cell(sheet2024, "D17").v).toBe(285_500);
	});
});
