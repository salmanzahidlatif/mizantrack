/**
 * Zakat carry-forward ("Past Remaining").
 *
 * A zakat year never settles in isolation: whatever was left unpaid at the end of one
 * year is owed at the start of the next, and whatever was overpaid is a credit against
 * it. The owner's workbook carries that figure by hand from sheet to sheet; this module
 * derives it instead.
 *
 * ```text
 * Past Remaining = typed override, else the previous year's Balance/Excess, else 0
 * Total To Pay   = this year's ZAKAT + Past Remaining
 * Balance/Excess = Total To Pay - Paid      (positive still owed, negative overpaid)
 * ```
 *
 * A negative Balance/Excess carries as a negative Past Remaining, exactly as a positive
 * one carries as a debt, so an overpayment reduces the next year's obligation instead of
 * being dropped. Nothing here is a tax calculation and nothing derived here is persisted:
 * only a figure the owner typed is ever stored.
 *
 * The carried figure is NOT rounded. The owner's workbook wraps its remainder cell in
 * `ROUNDUP(...,0)` (spec section 6), but that is a hand habit applied inconsistently —
 * `2021` carried 1.25 in, rounded to the paisa, while later sheets round to whole rupees.
 * Rounding up also runs the wrong way on an overpayment: Excel rounds away from zero, so
 * an automatic `ROUNDUP` would credit the owner more than he actually overpaid. The exact
 * figure is carried instead, and the override exists for when he wants his own.
 */

import { ZAKAT_EARLIEST_ISLAMIC_YEAR } from "@/lib/zakatCalendar";

import type { ZakatCarryForwardSource } from "@/types";

/**
 * How many years the chain is walked back before a resolution gives up and starts from
 * zero. The app only exposes AH1440 onwards, so this is a backstop against a corrupt or
 * absurd year number turning one lookup into an unbounded walk.
 */
export const ZAKAT_CARRY_FORWARD_MAX_LOOKBACK_YEARS = 25;

/**
 * What one zakat year settled at, before anything is carried into it.
 *
 * `zakatObligation` is the year's own zakat (basis + gold, at the chosen rate) and `paid`
 * is the sum of its payments — both already produced by `calculateZakatAssessment`.
 */
export interface ZakatYearSettlement {
	islamicYear: number;
	zakatObligation: number;
	paid: number;
	/** Past Remaining the owner typed for this year, in place of the carried figure. */
	pastRemainingOverride?: number;
}

export interface ZakatCarryForward {
	islamicYear: number;
	/** The figure that feeds Total To Pay. */
	pastRemaining: number;
	source: ZakatCarryForwardSource;
	/** What the chain carries on its own — what "reset" restores. */
	automatic: number;
	/** The year `automatic` came from, when a usable previous year exists. */
	carriedFromIslamicYear?: number;
}

export interface ZakatCarryForwardOptions {
	/** The first year the chain can start from. Nothing is carried into it. */
	earliestIslamicYear?: number;
	maxLookBackYears?: number;
}

/** Zakat is never derived from a NaN: an unusable figure contributes nothing. */
function finiteAmount(value: number | undefined): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isUsableSettlement(settlement: ZakatYearSettlement | undefined): boolean {
	return (
		settlement !== undefined &&
		Number.isFinite(settlement.zakatObligation) &&
		Number.isFinite(settlement.paid)
	);
}

function toSettlementMap(
	settlements: Iterable<ZakatYearSettlement> | Map<number, ZakatYearSettlement>
): Map<number, ZakatYearSettlement> {
	if (settlements instanceof Map) return settlements;

	const byYear = new Map<number, ZakatYearSettlement>();
	for (const settlement of settlements) byYear.set(settlement.islamicYear, settlement);
	return byYear;
}

export interface ZakatYearChainEntry extends ZakatCarryForward {
	/** `zakatObligation + pastRemaining`. */
	totalToPay: number;
	paid: number;
	/** `totalToPay - paid`; this is what the next year carries. */
	balanceOrExcess: number;
}

/**
 * Walks the chain forward, oldest year first, so each year's Past Remaining is settled
 * before the next asks for it. Iterating forward is what keeps a lookup bounded — a
 * recursive "resolve the year before me" would re-walk the whole history per year.
 *
 * A year with no settlement, or one whose figures are unusable, breaks the chain: the
 * year after it starts from zero rather than silently carrying a stale balance.
 */
export function buildZakatCarryForwardChain(
	settlements: Iterable<ZakatYearSettlement> | Map<number, ZakatYearSettlement>,
	options: ZakatCarryForwardOptions & { throughIslamicYear?: number } = {}
): Map<number, ZakatYearChainEntry> {
	const {
		earliestIslamicYear = ZAKAT_EARLIEST_ISLAMIC_YEAR,
		maxLookBackYears = ZAKAT_CARRY_FORWARD_MAX_LOOKBACK_YEARS,
	} = options;
	const byYear = toSettlementMap(settlements);
	const chain = new Map<number, ZakatYearChainEntry>();
	if (byYear.size === 0) return chain;

	const years = [...byYear.keys()].filter((year) => Number.isFinite(year));
	if (years.length === 0) return chain;

	const lastYear = options.throughIslamicYear ?? Math.max(...years);
	const firstYear = Math.max(
		earliestIslamicYear,
		Math.min(...years),
		lastYear - Math.max(0, maxLookBackYears)
	);

	let previous: ZakatYearChainEntry | undefined;
	for (let year = firstYear; year <= lastYear; year += 1) {
		const settlement = byYear.get(year);
		if (!isUsableSettlement(settlement)) {
			previous = undefined;
			continue;
		}

		const entry = settleZakatYear(settlement!, previous, year === earliestIslamicYear);
		chain.set(year, entry);
		previous = entry;
	}

	return chain;
}

function settleZakatYear(
	settlement: ZakatYearSettlement,
	previous: ZakatYearChainEntry | undefined,
	isEarliestYear: boolean
): ZakatYearChainEntry {
	// The earliest year the app exposes has no predecessor, so it carries nothing.
	const carried = isEarliestYear ? undefined : previous;
	const automatic = finiteAmount(carried?.balanceOrExcess);
	const override = settlement.pastRemainingOverride;
	const hasOverride = override !== undefined && Number.isFinite(override);

	const pastRemaining = hasOverride ? override : automatic;
	const zakatObligation = finiteAmount(settlement.zakatObligation);
	const paid = finiteAmount(settlement.paid);
	const totalToPay = zakatObligation + pastRemaining;

	return {
		islamicYear: settlement.islamicYear,
		pastRemaining,
		source: hasOverride ? "manual" : "auto",
		automatic,
		carriedFromIslamicYear: carried?.islamicYear,
		totalToPay,
		paid,
		balanceOrExcess: totalToPay - paid,
	};
}

/**
 * Resolves one year's Past Remaining: the override the owner typed, else the previous
 * year's Balance/Excess, else zero.
 *
 * The lookup is bounded twice over — the chain starts no earlier than
 * `earliestIslamicYear` and never reaches back further than `maxLookBackYears` — so a
 * resolution costs a fixed number of steps no matter how deep the history goes.
 */
export function resolveZakatCarryForward(
	islamicYear: number,
	settlements: Iterable<ZakatYearSettlement> | Map<number, ZakatYearSettlement>,
	options: ZakatCarryForwardOptions = {}
): ZakatCarryForward {
	const { earliestIslamicYear = ZAKAT_EARLIEST_ISLAMIC_YEAR } = options;
	const byYear = toSettlementMap(settlements);
	const settlement = byYear.get(islamicYear);
	const override = settlement?.pastRemainingOverride;

	const empty: ZakatCarryForward = {
		islamicYear,
		pastRemaining: 0,
		source: "auto",
		automatic: 0,
	};

	if (!Number.isFinite(islamicYear) || islamicYear <= earliestIslamicYear) {
		return override !== undefined && Number.isFinite(override)
			? { ...empty, pastRemaining: override, source: "manual" }
			: empty;
	}

	const chain = buildZakatCarryForwardChain(byYear, {
		...options,
		throughIslamicYear: islamicYear,
	});
	const entry = chain.get(islamicYear);
	if (entry) {
		return {
			islamicYear,
			pastRemaining: entry.pastRemaining,
			source: entry.source,
			automatic: entry.automatic,
			carriedFromIslamicYear: entry.carriedFromIslamicYear,
		};
	}

	// The year itself has no settlement yet — it may not have been assessed. Its Past
	// Remaining is still whatever the year before it left behind.
	const previous = chain.get(islamicYear - 1);
	const automatic = finiteAmount(previous?.balanceOrExcess);
	const resolved: ZakatCarryForward = {
		islamicYear,
		pastRemaining: automatic,
		source: "auto",
		automatic,
		carriedFromIslamicYear: previous?.islamicYear,
	};

	return override !== undefined && Number.isFinite(override)
		? { ...resolved, pastRemaining: override, source: "manual" }
		: resolved;
}
