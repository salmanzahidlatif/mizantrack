/**
 * Zakat carry-forward ("Past Remaining").
 *
 * Ground truth is `docs/zakat-requirements-2026-10.md` — section 4.5 for the formula and
 * section 7 for the owner's 2020 - 2024 history. The workbook carries each year's
 * leftover into the next sheet by hand; these tests prove the app derives the same chain
 * and that an overpayment carries as a credit instead of being dropped.
 *
 * Nothing here computes tax. Zakat is a religious obligation the owner already calculates
 * by hand; this file only proves the carried figures reproduce.
 */
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { db } from "@/lib/db/local";
import { ZAKAT_EARLIEST_ISLAMIC_YEAR } from "@/lib/zakatCalendar";
import {
	buildZakatCarryForwardChain,
	resolveZakatCarryForward,
	ZAKAT_CARRY_FORWARD_MAX_LOOKBACK_YEARS,
} from "@/lib/zakatCarryForward";
import { calculateZakatAssessment } from "@/lib/zakatEngine";
import { buildZakatWorkbook } from "@/lib/zakatExport";
import {
	buildZakatYearOverrideId,
	clearZakatPastRemainingOverride,
	clearZakatYearOverride,
	listZakatYearOverrides,
	saveZakatPastRemainingOverride,
	saveZakatYearOverride,
	toPastRemainingOverrideMap,
	toRamadanStartMap,
} from "@/lib/zakatYearRepository";

import type { ZakatYearSettlement } from "@/lib/zakatCarryForward";
import type { ZakatAccountMonthBalance, ZakatYearGrid } from "@/lib/zakatEngine";
import type { IslamicMonth } from "@/types";

// ─── The owner's real history ────────────────────────────────────────────────

/**
 * Sheet `2020` opens on 1 Ramaḍān AH1440 and each sheet is the next lunar year, so the
 * Gregorian sheet names map straight onto Islamic years.
 */
const SHEET_YEAR_BY_ISLAMIC_YEAR: Record<number, number> = {
	1440: 2020,
	1441: 2021,
	1442: 2022,
	1443: 2023,
	1444: 2024,
};

/**
 * Zakat and payments per year, verbatim from the spec's history table. The `carried`
 * column is what the owner actually typed into the next sheet: his remainder cells wrap
 * the subtraction in `ROUNDUP(...,0)` (spec section 6, the `2022`–`2024` formulas), and
 * `2021` carried 1.25 in — the `2020` remainder of 1.2455 rounded up to the paisa.
 */
const OWNER_HISTORY = [
	{ islamicYear: 1440, zakatObligation: 69_001.2455, paid: 69_000, carried: undefined },
	{ islamicYear: 1441, zakatObligation: 92_474.8255, paid: 87_965, carried: 1.25 },
	{ islamicYear: 1442, zakatObligation: 108_654.408, paid: 108_656, carried: 4_512 },
	{ islamicYear: 1443, zakatObligation: 149_546.5221, paid: 66_000, carried: 4_511 },
	{ islamicYear: 1444, zakatObligation: 146_046.3939, paid: 285_500, carried: 88_058 },
] as const;

const CARRIED_DECIMALS: Record<number, number> = { 1441: 2, 1442: 0, 1443: 0, 1444: 0 };

/** The chain as the owner ran it: each year opens on the figure he carried in. */
function ownerSettlements(): ZakatYearSettlement[] {
	return OWNER_HISTORY.map((year) => ({
		islamicYear: year.islamicYear,
		zakatObligation: year.zakatObligation,
		paid: year.paid,
		pastRemainingOverride: year.carried,
	}));
}

/** The same history with nothing typed, so every year carries what the app derives. */
function derivedSettlements(): ZakatYearSettlement[] {
	return OWNER_HISTORY.map((year) => ({
		islamicYear: year.islamicYear,
		zakatObligation: year.zakatObligation,
		paid: year.paid,
	}));
}

function roundedUp(value: number, decimals: number): number {
	const factor = 10 ** decimals;
	return Math.ceil(value * factor) / factor;
}

describe("the owner's 2020 - 2024 carry-forward chain", () => {
	const chain = buildZakatCarryForwardChain(ownerSettlements());

	it("carries nothing into the earliest year on record", () => {
		const first = chain.get(1440)!;
		expect(first.pastRemaining).toBe(0);
		expect(first.source).toBe("auto");
		expect(first.carriedFromIslamicYear).toBeUndefined();
		expect(first.balanceOrExcess).toBeCloseTo(1.2455, 4);
	});

	it("reproduces 2021 → 4,512 → 2022 → 4,511 → 2023 → 88,058 → 2024", () => {
		// Each year's remainder under the workbook's own ROUNDUP(...,0) on the carry cell.
		expect(roundedUp(chain.get(1441)!.balanceOrExcess, CARRIED_DECIMALS[1442]!)).toBe(4_512);
		expect(roundedUp(chain.get(1442)!.balanceOrExcess, CARRIED_DECIMALS[1443]!)).toBe(4_511);
		expect(roundedUp(chain.get(1443)!.balanceOrExcess, CARRIED_DECIMALS[1444]!)).toBe(88_058);

		// Unrounded, the engine lands a fraction under each figure the owner wrote down.
		expect(chain.get(1441)!.balanceOrExcess).toBeCloseTo(4_511.0755, 4);
		expect(chain.get(1442)!.balanceOrExcess).toBeCloseTo(4_510.408, 4);
		expect(chain.get(1443)!.balanceOrExcess).toBeCloseTo(88_057.5221, 4);
	});

	it("lands on the 2024 workbook's -51,395.6061 excess", () => {
		const year2024 = chain.get(1444)!;
		expect(year2024.pastRemaining).toBe(88_058);
		expect(year2024.source).toBe("manual");
		expect(year2024.totalToPay).toBeCloseTo(234_104.3939, 4);
		expect(year2024.paid).toBe(285_500);
		expect(year2024.balanceOrExcess).toBeCloseTo(-51_395.6061, 4);
	});

	it("names the year each carried figure came from", () => {
		expect(chain.get(1441)!.carriedFromIslamicYear).toBe(1440);
		expect(chain.get(1444)!.carriedFromIslamicYear).toBe(1443);
	});

	it("tracks the same chain within two rupees when nothing is typed by hand", () => {
		const derived = buildZakatCarryForwardChain(derivedSettlements());

		expect(derived.get(1441)!.pastRemaining).toBeCloseTo(1.2455, 4);
		expect(derived.get(1441)!.source).toBe("auto");
		expect(derived.get(1444)!.balanceOrExcess).toBeCloseTo(-51_397.605, 4);
		// The gap is only the rounding up the owner did on paper, never a maths difference.
		expect(
			Math.abs(derived.get(1444)!.balanceOrExcess - chain.get(1444)!.balanceOrExcess)
		).toBeLessThan(3);
	});

	it("maps every year in the chain onto the sheet the owner knows it by", () => {
		for (const islamicYear of Object.keys(SHEET_YEAR_BY_ISLAMIC_YEAR).map(Number)) {
			expect(chain.has(islamicYear)).toBe(true);
		}
	});
});

// ─── Resolution rules ────────────────────────────────────────────────────────

describe("resolveZakatCarryForward", () => {
	it("carries the previous year's Balance/Excess by default", () => {
		const resolved = resolveZakatCarryForward(1444, ownerSettlements());

		expect(resolved.pastRemaining).toBe(88_058);
		expect(resolved.source).toBe("manual");
		expect(resolved.automatic).toBeCloseTo(88_057.5221, 4);
		expect(resolved.carriedFromIslamicYear).toBe(1443);
	});

	it("lets a typed override win, and restores the carried value when it is dropped", () => {
		const settlements = derivedSettlements();
		const automatic = resolveZakatCarryForward(1443, settlements);
		expect(automatic.source).toBe("auto");
		expect(automatic.pastRemaining).toBeCloseTo(4_509.479, 4);

		const overridden = resolveZakatCarryForward(
			1443,
			settlements.map((settlement) =>
				settlement.islamicYear === 1443
					? { ...settlement, pastRemainingOverride: 4_511 }
					: settlement
			)
		);
		expect(overridden.source).toBe("manual");
		expect(overridden.pastRemaining).toBe(4_511);
		// The automatic figure is still reported, so "reset" has something to restore.
		expect(overridden.automatic).toBeCloseTo(automatic.pastRemaining, 6);

		// Dropping the override puts the year back on the carried value.
		expect(resolveZakatCarryForward(1443, settlements).pastRemaining).toBeCloseTo(
			automatic.pastRemaining,
			6
		);
	});

	it("carries nothing into the earliest year the app exposes", () => {
		const resolved = resolveZakatCarryForward(ZAKAT_EARLIEST_ISLAMIC_YEAR, ownerSettlements());

		expect(resolved.pastRemaining).toBe(0);
		expect(resolved.pastRemaining).not.toBeNaN();
		expect(resolved.automatic).toBe(0);
		expect(resolved.carriedFromIslamicYear).toBeUndefined();
	});

	it("carries an overpayment as a credit instead of dropping it", () => {
		const settlements: ZakatYearSettlement[] = [
			{ islamicYear: 1444, zakatObligation: 146_046.3939, paid: 285_500 },
			{ islamicYear: 1445, zakatObligation: 100_000, paid: 0 },
		];
		const chain = buildZakatCarryForwardChain(settlements);
		const next = chain.get(1445)!;

		expect(next.pastRemaining).toBeLessThan(0);
		expect(next.pastRemaining).toBeCloseTo(-139_453.6061, 4);
		expect(next.totalToPay).toBeCloseTo(100_000 - 139_453.6061, 4);
		expect(next.totalToPay).toBeLessThan(100_000);
	});

	it("carries the exact excess rather than rounding it away from zero", () => {
		// The workbook's ROUNDUP(...,0) on a negative remainder would carry -51,396, a
		// credit of almost a rupee the owner never paid. The exact figure carries instead.
		const next = resolveZakatCarryForward(1445, ownerSettlements());

		expect(next.pastRemaining).toBeCloseTo(-51_395.6061, 4);
		expect(next.pastRemaining).toBeGreaterThan(-51_396);
	});

	it("yields zero, never NaN, when the previous year is missing or incomplete", () => {
		const gap = resolveZakatCarryForward(1444, [
			{ islamicYear: 1442, zakatObligation: 108_654.408, paid: 108_656 },
			{ islamicYear: 1444, zakatObligation: 146_046.3939, paid: 285_500 },
		]);
		expect(gap.pastRemaining).toBe(0);
		expect(gap.carriedFromIslamicYear).toBeUndefined();

		const broken = resolveZakatCarryForward(1444, [
			{ islamicYear: 1443, zakatObligation: Number.NaN, paid: 66_000 },
			{ islamicYear: 1444, zakatObligation: 146_046.3939, paid: 285_500 },
		]);
		expect(broken.pastRemaining).toBe(0);
		expect(broken.pastRemaining).not.toBeNaN();

		const unassessed = resolveZakatCarryForward(1445, ownerSettlements());
		expect(unassessed.pastRemaining).toBeCloseTo(-51_395.6061, 4);
		expect(unassessed.source).toBe("auto");

		expect(resolveZakatCarryForward(Number.NaN, ownerSettlements()).pastRemaining).toBe(0);
		expect(resolveZakatCarryForward(1444, []).pastRemaining).toBe(0);
	});

	it("ignores an unusable override rather than poisoning Total To Pay", () => {
		const resolved = resolveZakatCarryForward(1444, [
			{ islamicYear: 1443, zakatObligation: 149_546.5221, paid: 66_000 },
			{
				islamicYear: 1444,
				zakatObligation: 146_046.3939,
				paid: 285_500,
				pastRemainingOverride: Number.NaN,
			},
		]);

		expect(resolved.source).toBe("auto");
		expect(resolved.pastRemaining).not.toBeNaN();
		expect(resolved.pastRemaining).toBeCloseTo(83_546.5221, 4);
	});

	it("stays bounded instead of walking back through every prior year", () => {
		// 600 contiguous years, each leaving 1 behind. Nothing may walk the whole run.
		const settlements: ZakatYearSettlement[] = Array.from({ length: 600 }, (_unused, index) => ({
			islamicYear: 1000 + index,
			zakatObligation: 1,
			paid: 0,
		}));

		const started = Date.now();
		const resolved = resolveZakatCarryForward(1599, settlements);
		expect(Date.now() - started).toBeLessThan(1_000);

		// Only the capped window contributes: one rupee per year walked.
		expect(resolved.pastRemaining).toBe(ZAKAT_CARRY_FORWARD_MAX_LOOKBACK_YEARS);
		expect(resolveZakatCarryForward(1599, settlements, { maxLookBackYears: 2 }).pastRemaining).toBe(
			2
		);
		expect(resolveZakatCarryForward(1599, settlements, { maxLookBackYears: 0 }).pastRemaining).toBe(
			0
		);
	});

	it("feeds the engine, so Total To Pay and Balance/Excess match the workbook", () => {
		const resolved = resolveZakatCarryForward(1444, ownerSettlements());
		const assessment = calculateZakatAssessment({
			monthlyTotals: [2_628_184.68],
			basis: "minimum",
			goldItems: [{ weight: 170.52, purity: "21k" }],
			goldPrices: { priceDate: "2023-03-24", pricesByPurity: { "21k": 18_846.3 } },
			ratePercent: 2.5,
			pastRemaining: resolved.pastRemaining,
			payments: [{ amount: 285_500 }],
		});

		expect(assessment.zakatObligation).toBeCloseTo(146_046.3939, 4);
		expect(assessment.pastRemaining).toBe(88_058);
		expect(assessment.totalToPay).toBeCloseTo(234_104.3939, 4);
		expect(assessment.balanceOrExcess).toBeCloseTo(-51_395.6061, 4);
	});
});

// ─── Persistence ─────────────────────────────────────────────────────────────

describe("Past Remaining overrides in Dexie", () => {
	const USER_ID = "user-zakat-carry-forward";

	beforeEach(async () => {
		await db.zakatYears.clear();
	});

	it("round-trips a typed figure and marks it for sync", async () => {
		const saved = await saveZakatPastRemainingOverride({
			userId: USER_ID,
			islamicYear: 1444,
			pastRemaining: 88_058,
		});

		expect(saved.id).toBe(buildZakatYearOverrideId(USER_ID, 1444));
		expect(saved.pastRemainingOverride).toBe(88_058);
		expect(saved.pastRemainingSource).toBe("manual");

		const stored = await db.zakatYears.get(saved.id);
		expect(stored?.pastRemainingOverride).toBe(88_058);
		expect(stored?.pendingSync).toBe(true);

		const overrides = toPastRemainingOverrideMap(await listZakatYearOverrides(USER_ID));
		expect(overrides.get(1444)).toBe(88_058);
	});

	it("keeps an overpayment negative instead of storing its magnitude", async () => {
		await saveZakatPastRemainingOverride({
			userId: USER_ID,
			islamicYear: 1445,
			pastRemaining: -51_395.6061,
		});

		const overrides = toPastRemainingOverrideMap(await listZakatYearOverrides(USER_ID));
		expect(overrides.get(1445)).toBeCloseTo(-51_395.6061, 4);
	});

	it("refuses a figure that is not a number", async () => {
		await expect(
			saveZakatPastRemainingOverride({
				userId: USER_ID,
				islamicYear: 1444,
				pastRemaining: Number.NaN,
			})
		).rejects.toThrow(/finite/);
	});

	it("drops the override on reset so the carried value returns", async () => {
		await saveZakatPastRemainingOverride({
			userId: USER_ID,
			islamicYear: 1444,
			pastRemaining: 88_058,
		});
		await clearZakatPastRemainingOverride(USER_ID, 1444);

		const overrides = toPastRemainingOverrideMap(await listZakatYearOverrides(USER_ID));
		expect(overrides.has(1444)).toBe(false);

		// Tombstoned rather than removed, so the reset reaches the owner's other devices.
		const stored = await db.zakatYears.get(buildZakatYearOverrideId(USER_ID, 1444));
		expect(stored?.deletedAt).toBeTypeOf("number");
		expect(stored?.pendingSync).toBe(true);
	});

	it("keeps a hand-set anchor alive when only the carried figure is reset", async () => {
		await saveZakatYearOverride({
			userId: USER_ID,
			islamicYear: 1447,
			ramadanStart: new Date(2026, 1, 21),
		});
		await saveZakatPastRemainingOverride({
			userId: USER_ID,
			islamicYear: 1447,
			pastRemaining: 4_511,
		});
		await clearZakatPastRemainingOverride(USER_ID, 1447);

		const stored = await db.zakatYears.get(buildZakatYearOverrideId(USER_ID, 1447));
		expect(stored?.deletedAt).toBeUndefined();
		expect(stored?.pastRemainingOverride).toBeUndefined();
		expect(stored?.pastRemainingSource).toBeUndefined();
		expect(stored?.pendingSync).toBe(true);
		expect(toRamadanStartMap(await listZakatYearOverrides(USER_ID)).has(1447)).toBe(true);
	});

	it("does not store the figure the chain derives, only the one the owner typed", async () => {
		const overrides = toPastRemainingOverrideMap(await listZakatYearOverrides(USER_ID));
		expect(overrides.size).toBe(0);
		expect(resolveZakatCarryForward(1444, ownerSettlements()).pastRemaining).toBe(88_058);
		expect(await db.zakatYears.count()).toBe(0);
	});

	it("keeps the Ramaḍān anchor and the carried figure independent", async () => {
		await saveZakatYearOverride({
			userId: USER_ID,
			islamicYear: 1444,
			ramadanStart: new Date(2023, 2, 23),
		});
		await saveZakatPastRemainingOverride({
			userId: USER_ID,
			islamicYear: 1444,
			pastRemaining: 88_058,
		});

		const live = await listZakatYearOverrides(USER_ID);
		expect(toRamadanStartMap(live).has(1444)).toBe(true);
		expect(toPastRemainingOverrideMap(live).get(1444)).toBe(88_058);

		// Resetting the anchor leaves the carried figure alone.
		await clearZakatYearOverride(USER_ID, 1444);
		const afterAnchorReset = await listZakatYearOverrides(USER_ID);
		expect(toRamadanStartMap(afterAnchorReset).has(1444)).toBe(false);
		expect(toPastRemainingOverrideMap(afterAnchorReset).get(1444)).toBe(88_058);

		// And resetting the carried figure leaves no stale anchor behind either.
		await clearZakatPastRemainingOverride(USER_ID, 1444);
		const afterCarryReset = await listZakatYearOverrides(USER_ID);
		expect(toPastRemainingOverrideMap(afterCarryReset).has(1444)).toBe(false);
		expect(toRamadanStartMap(afterCarryReset).has(1444)).toBe(false);
	});

	it("keeps a typed figure when the Ramaḍān anchor is saved afterwards", async () => {
		await saveZakatPastRemainingOverride({
			userId: USER_ID,
			islamicYear: 1446,
			pastRemaining: 1_234.5,
		});
		await saveZakatYearOverride({
			userId: USER_ID,
			islamicYear: 1446,
			ramadanStart: new Date(2025, 2, 2),
		});

		const live = await listZakatYearOverrides(USER_ID);
		expect(toPastRemainingOverrideMap(live).get(1446)).toBe(1_234.5);
		expect(toRamadanStartMap(live).has(1446)).toBe(true);
	});
});

// ─── Export ──────────────────────────────────────────────────────────────────

const ISLAMIC_MONTH_NAMES: IslamicMonth[] = [
	"Ramaḍān",
	"Shawwāl",
	"Zū al-Qaʿdah",
	"Zū al-Ḥijjah",
	"al-Muḥarram",
	"Ṣafar",
	"Rabīʿ al-ʾAwwal",
	"Rabīʿ ath-Thānī",
	"Jumādā al-ʾAwwal",
	"Jumādā ath-Thāniyah",
	"Rajab",
	"Shaʿbān",
];

function makeGrid(monthlyTotals: number[]): ZakatYearGrid {
	const account: ZakatAccountMonthBalance = {
		accountId: "meezan",
		accountTitle: "Meezan (Default)",
		currency: "PKR",
		accountType: "asset",
		isArchived: false,
		balances: monthlyTotals,
	};

	return {
		year: {
			sheetYear: 2024,
			islamicYear: 1444,
			zakatYear: "1444-1445",
			label: "2024 (1444–1445)",
			ramadanSource: "announced",
			months: ISLAMIC_MONTH_NAMES.map((month, index) => ({
				month,
				islamicYear: index < 4 ? 1444 : 1445,
				startDate: new Date(Date.UTC(2023, 2, 24 + index * 29, 12)),
				endDate: new Date(Date.UTC(2023, 2, 24 + index * 29 + 28, 12)),
			})),
		},
		accounts: [account],
		monthlyTotals,
		minimum: Math.min(...monthlyTotals),
		maximum: Math.max(...monthlyTotals),
	};
}

function summaryCell(sheet: XLSX.WorkSheet, label: string): XLSX.CellObject {
	const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: true });
	const summaryStart = rows.findIndex((row) => row[0] === "SUMMARY");
	const offset = rows.slice(summaryStart).findIndex((row) => row[0] === label);
	expect(offset, `Expected a summary row labelled "${label}"`).toBeGreaterThan(-1);
	return sheet[`B${summaryStart + offset + 1}`] as XLSX.CellObject;
}

describe("exported workbook", () => {
	it("carries the resolved Past Remaining into Total To Pay and Balance/Excess", () => {
		const resolved = resolveZakatCarryForward(1444, ownerSettlements());
		const workbook = buildZakatWorkbook({
			years: [
				{
					grid: makeGrid(Array.from({ length: 12 }, () => 2_628_184.68)),
					currency: "PKR",
					basis: "minimum",
					ratePercent: 2.5,
					goldRows: [{ purity: "21k", grams: 170.52, pricePerGram: 18_846.3 }],
					pastRemaining: resolved.pastRemaining,
					payments: [{ amount: 285_500 }],
				},
			],
		});

		const sheet = workbook.Sheets["2024 (1444–1445)"]!;
		const pastRemaining = summaryCell(sheet, "Past Remaining");

		expect(pastRemaining.v).toBe(88_058);
		// Still a plain input cell the owner can retype inside Excel.
		expect(pastRemaining.f).toBeUndefined();
		expect(summaryCell(sheet, "Total To Pay").v as number).toBeCloseTo(234_104.3939, 4);
		expect(summaryCell(sheet, "Balance/Excess").v as number).toBeCloseTo(-51_395.6061, 4);
		expect(summaryCell(sheet, "Balance/Excess").v as number).toBeLessThan(0);
	});
});
