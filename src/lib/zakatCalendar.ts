/**
 * Zakat calendar generation.
 *
 * Every zakat year is derived, never hardcoded. Two independent pieces of information
 * are combined:
 *
 *  1. The *shape* of the year — how long each of the twelve lunar months is. This comes
 *     from the built-in Umm al-Qura calendar (`Intl.DateTimeFormat` with
 *     `en-u-ca-islamic-umalqura`), which is a published tabular calendar and therefore
 *     deterministic. No dependency is needed.
 *  2. The *anchor* — the first day of Ramaḍān. Pakistan does not follow the Umm al-Qura
 *     table: the Ruet-e-Hilal committee announces a sighting, which has historically
 *     landed zero, one or two days after the umalqura date.
 *
 * The anchor positions the year, the umalqura lengths lay out the months behind it, and
 * the months are contiguous by construction, so a year is always 354 or 355 days.
 */

import { addDays } from "date-fns";

import { ISLAMIC_MONTHS, type IslamicMonth, type ZakatYearSource } from "@/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Ramaḍān is the 9th Islamic month; the zakat year runs Ramaḍān → Shaʿbān (the 8th). */
const RAMADAN_MONTH = 9;

/**
 * The owner's records begin with the 2020 sheet, whose zakat year opens on
 * 1 Ramaḍān 1440 (7 May 2019). There is nothing to report before that, so the
 * window is anchored rather than rolling backwards into empty years.
 */
export const ZAKAT_EARLIEST_ISLAMIC_YEAR = 1440;
export const ZAKAT_YEARS_FORWARD = 5;

export interface ZakatMonthDefinition {
	month: IslamicMonth;
	islamicYear: number;
	startDate: Date;
	endDate: Date;
}

export interface ZakatYearDefinition {
	/** The Gregorian year the zakat year ENDS in, kept for continuity with the sheets. */
	sheetYear: number;
	/** The Islamic year Ramaḍān falls in. This is the stable identity of a zakat year. */
	islamicYear: number;
	zakatYear: string;
	label: string;
	ramadanSource: ZakatYearSource;
	months: ZakatMonthDefinition[];
}

/**
 * First day of Ramaḍān as announced in Pakistan by the Ruet-e-Hilal committee.
 *
 * These are OBSERVED SIGHTINGS, not calculations, which is exactly why they are listed
 * by hand: no formula reproduces them. Pakistan usually sights one day after the Umm
 * al-Qura date, but not always — AH1443 ran two days later and AH1444 fell on the same
 * day. Years past the last entry fall back to the `umalqura + 1 day` estimate until the
 * committee announces, at which point the real date belongs here.
 */
export const PAKISTAN_RAMADAN_STARTS: Readonly<Record<number, string>> = {
	1440: "2019-05-07",
	1441: "2020-04-25",
	1442: "2021-04-14",
	1443: "2022-04-04",
	1444: "2023-03-23",
	1445: "2024-03-12",
	1446: "2025-03-02",
};

const umalquraFormatter = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
	year: "numeric",
	month: "numeric",
	day: "numeric",
	timeZone: "UTC",
});

/**
 * Month starts are looked up a lot (twelve per year, plus the following month to measure
 * each length). `formatToParts` is comparatively slow, so results are memoised.
 */
const umalquraMonthStartCache = new Map<string, number>();

interface UmalquraParts {
	year: number;
	month: number;
	day: number;
}

/**
 * Reads the Umm al-Qura date for a civil day, identified by its day index since the Unix
 * epoch. Day indices keep the lookup free of time zones; conversion to a local-midnight
 * `Date` happens only at the boundary.
 */
function readUmalquraParts(dayIndex: number): UmalquraParts {
	const parts = umalquraFormatter.formatToParts(new Date(dayIndex * MS_PER_DAY));
	let year = 0;
	let month = 0;
	let day = 0;

	for (const part of parts) {
		if (part.type === "year") year = Number.parseInt(part.value, 10);
		else if (part.type === "month") month = Number.parseInt(part.value, 10);
		else if (part.type === "day") day = Number.parseInt(part.value, 10);
	}

	return { year, month, day };
}

/** Rough day count from the Unix epoch to 1 Muḥarram of an Islamic year, for seeding the search. */
function estimateMonthStartDayIndex(islamicYear: number, islamicMonth: number): number {
	const daysFromHijriEpoch = (islamicYear - 1) * 354.367 + (islamicMonth - 1) * 29.53;
	// -492151 is the day index of the Hijri epoch (16 July 622 CE) relative to 1970-01-01.
	return Math.round(-492151 + daysFromHijriEpoch);
}

/**
 * Day index of the first day of an Umm al-Qura month.
 *
 * The estimate lands within a month or so; each iteration measures how far off the
 * formatter says we are and jumps that many days, so convergence takes a handful of steps.
 */
function getUmalquraMonthStartDayIndex(islamicYear: number, islamicMonth: number): number {
	const cacheKey = `${islamicYear}-${islamicMonth}`;
	const cached = umalquraMonthStartCache.get(cacheKey);
	if (cached !== undefined) return cached;

	let dayIndex = estimateMonthStartDayIndex(islamicYear, islamicMonth);

	for (let attempt = 0; attempt < 64; attempt += 1) {
		const parts = readUmalquraParts(dayIndex);
		if (parts.year === islamicYear && parts.month === islamicMonth && parts.day === 1) {
			umalquraMonthStartCache.set(cacheKey, dayIndex);
			return dayIndex;
		}

		const drift =
			(parts.year - islamicYear) * 354.367 + (parts.month - islamicMonth) * 29.53 + (parts.day - 1);
		dayIndex -= Math.abs(drift) >= 1 ? Math.round(drift) : Math.sign(drift);
	}

	throw new Error(`Unable to resolve umalqura month ${islamicMonth} of AH${islamicYear}`);
}

/** Converts a day index to a `Date` at LOCAL midnight, matching how zakat dates are stored. */
function toLocalMidnight(dayIndex: number): Date {
	const utc = new Date(dayIndex * MS_PER_DAY);
	return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

/** Parses a `YYYY-MM-DD` string into a LOCAL-midnight `Date`. */
export function parseLocalDate(isoDate: string): Date {
	const [year, month, day] = isoDate.split("-").map(Number);
	return new Date(year!, month! - 1, day!);
}

/** Formats a `Date` as `YYYY-MM-DD` using local getters — `toISOString` would shift the day. */
export function toLocalDateKey(date: Date): string {
	return [
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, "0"),
		String(date.getDate()).padStart(2, "0"),
	].join("-");
}

/** Strips the time of day so an anchor is always comparable at local midnight. */
export function startOfLocalDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** The Umm al-Qura 1 Ramaḍān for an Islamic year, before any Pakistan sighting is applied. */
export function getUmalquraRamadanStart(islamicYear: number): Date {
	return toLocalMidnight(getUmalquraMonthStartDayIndex(islamicYear, RAMADAN_MONTH));
}

/**
 * Lengths in days of the twelve months of a zakat year, Ramaḍān of `islamicYear` through
 * Shaʿbān of `islamicYear + 1`. Each is 29 or 30 and the total is 354 or 355.
 */
export function getUmalquraMonthLengths(islamicYear: number): number[] {
	const lengths: number[] = [];

	for (let offset = 0; offset < 12; offset += 1) {
		const absoluteMonth = RAMADAN_MONTH - 1 + offset;
		const year = islamicYear + Math.floor(absoluteMonth / 12);
		const month = (absoluteMonth % 12) + 1;
		const nextYear = month === 12 ? year + 1 : year;
		const nextMonth = month === 12 ? 1 : month + 1;

		lengths.push(
			getUmalquraMonthStartDayIndex(nextYear, nextMonth) -
				getUmalquraMonthStartDayIndex(year, month)
		);
	}

	return lengths;
}

export interface ResolvedRamadanStart {
	date: Date;
	source: ZakatYearSource;
}

/**
 * Picks the 1 Ramaḍān anchor for a year, in priority order:
 * an explicit override → an announced Pakistan sighting → umalqura + 1 day.
 */
export function resolveRamadanStart(
	islamicYear: number,
	ramadanStart?: Date
): ResolvedRamadanStart {
	if (ramadanStart) {
		return { date: startOfLocalDay(ramadanStart), source: "manual" };
	}

	const announced = PAKISTAN_RAMADAN_STARTS[islamicYear];
	if (announced) {
		return { date: parseLocalDate(announced), source: "announced" };
	}

	return { date: addDays(getUmalquraRamadanStart(islamicYear), 1), source: "computed" };
}

/**
 * Builds a complete zakat year: Ramaḍān of `islamicYear` through Shaʿbān of the next
 * Islamic year, twelve contiguous months laid out behind the resolved anchor.
 */
export function buildZakatYearDefinition(
	islamicYear: number,
	ramadanStart?: Date
): ZakatYearDefinition {
	const { date, source } = resolveRamadanStart(islamicYear, ramadanStart);
	const lengths = getUmalquraMonthLengths(islamicYear);
	const endIslamicYear = islamicYear + 1;

	let cursor = date;
	const months = ISLAMIC_MONTHS.map((month, index) => {
		const startDate = cursor;
		const endDate = addDays(startDate, lengths[index]! - 1);
		cursor = addDays(endDate, 1);

		return {
			month,
			// The Islamic year rolls over at al-Muḥarram, the fifth month of the zakat year.
			islamicYear: index < 4 ? islamicYear : endIslamicYear,
			startDate,
			endDate,
		};
	});

	const sheetYear = months[11]!.endDate.getFullYear();

	return {
		sheetYear,
		islamicYear,
		zakatYear: `${islamicYear}-${endIslamicYear}`,
		label: `${sheetYear} (${islamicYear}–${endIslamicYear})`,
		ramadanSource: source,
		months,
	};
}

/**
 * The Islamic year whose Ramaḍān opens the zakat year containing `date`.
 *
 * The umalqura month gives the first guess; because the Pakistan anchor can sit up to two
 * days later, the guess is then checked against the real boundaries and nudged if `date`
 * falls in the overlap.
 */
export function getZakatIslamicYearForDate(date: Date, ramadanStarts?: Map<number, Date>): number {
	const dayIndex = Math.floor(
		Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_PER_DAY
	);
	const parts = readUmalquraParts(dayIndex);
	let candidate = parts.month >= RAMADAN_MONTH ? parts.year : parts.year - 1;

	for (let attempt = 0; attempt < 3; attempt += 1) {
		const definition = buildZakatYearDefinition(candidate, ramadanStarts?.get(candidate));
		const at = startOfLocalDay(date).getTime();
		if (at < definition.months[0]!.startDate.getTime()) {
			candidate -= 1;
			continue;
		}
		if (at > definition.months[11]!.endDate.getTime()) {
			candidate += 1;
			continue;
		}
		return candidate;
	}

	return candidate;
}

/**
 * The Islamic years the app exposes: ten back through five forward of the current one.
 * Generated on demand so the window follows the calendar instead of expiring.
 */
export function getZakatIslamicYearRange(
	date = new Date(),
	ramadanStarts?: Map<number, Date>
): number[] {
	const current = getZakatIslamicYearForDate(date, ramadanStarts);
	const years: number[] = [];
	const last = Math.max(current + ZAKAT_YEARS_FORWARD, ZAKAT_EARLIEST_ISLAMIC_YEAR);
	for (let year = ZAKAT_EARLIEST_ISLAMIC_YEAR; year <= last; year += 1) {
		years.push(year);
	}
	return years;
}
