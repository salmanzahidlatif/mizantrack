/**
 * Islamic (Hijri) calendar helpers for Zakat.
 *
 * There is exactly ONE source of truth for Islamic dates: `@/lib/zakatCalendar`, which
 * derives month boundaries from the built-in Umm al-Qura calendar and anchors each zakat
 * year on the announced Pakistan 1 Ramaḍān. This module is a thin convenience layer over
 * it — it holds no dates of its own, so it cannot drift out of step with the zakat sheets.
 */

import {
	buildZakatYearDefinition,
	getZakatIslamicYearForDate,
	PAKISTAN_RAMADAN_STARTS,
	resolveRamadanStart,
} from "@/lib/zakatCalendar";
import { ISLAMIC_MONTHS, type IslamicMonth } from "@/types";

import type { ZakatYearDefinition } from "@/lib/zakatCalendar";

export {
	buildZakatYearDefinition,
	getUmalquraMonthLengths,
	getUmalquraRamadanStart,
	PAKISTAN_RAMADAN_STARTS,
	resolveRamadanStart,
} from "@/lib/zakatCalendar";

/** Parses a zakat year label such as "1446-1447" into its opening Islamic year. */
function parseZakatYearLabel(zakatYear: string): number {
	const startYear = Number.parseInt(zakatYear.split("-")[0] ?? "", 10);
	if (!Number.isFinite(startYear)) {
		throw new Error(`Invalid zakat year: ${zakatYear}`);
	}
	return startYear;
}

function getDefinitionForLabel(zakatYear: string): ZakatYearDefinition {
	return buildZakatYearDefinition(parseZakatYearLabel(zakatYear));
}

/**
 * The Islamic year a Gregorian date falls in. Note this is the calendar year, which rolls
 * over at al-Muḥarram — not the zakat year, which opens at Ramaḍān.
 */
export function getIslamicYear(date: Date): number {
	const definition = buildZakatYearDefinition(getZakatIslamicYearForDate(date));
	const at = date.getTime();
	const month = definition.months.find(
		(candidate) => at >= candidate.startDate.getTime() && at <= candidate.endDate.getTime()
	);
	return month?.islamicYear ?? definition.islamicYear;
}

/** The Islamic month a Gregorian date falls in. */
export function getIslamicMonthName(date: Date): IslamicMonth {
	const definition = buildZakatYearDefinition(getZakatIslamicYearForDate(date));
	const at = date.getTime();
	const month = definition.months.find(
		(candidate) => at >= candidate.startDate.getTime() && at <= candidate.endDate.getTime()
	);
	return month?.month ?? ISLAMIC_MONTHS[0];
}

/**
 * The zakat year label for a date, e.g. "1446-1447".
 * The zakat year runs from Ramaḍān of year N to Shaʿbān of year N+1.
 */
export function getZakatYear(date: Date): string {
	return buildZakatYearDefinition(getZakatIslamicYearForDate(date)).zakatYear;
}

/** Full Gregorian span of a zakat year: 1 Ramaḍān through the last day of Shaʿbān. */
export function getZakatYearRange(zakatYear: string): { start: Date; end: Date } {
	const definition = getDefinitionForLabel(zakatYear);
	return {
		start: definition.months[0]!.startDate,
		end: definition.months[11]!.endDate,
	};
}

/** Last Gregorian day of an Islamic month within its zakat year. */
export function getIslamicMonthEndDate(month: IslamicMonth, year: number): Date {
	const monthIndex = ISLAMIC_MONTHS.indexOf(month);
	if (monthIndex === -1) throw new Error(`Invalid Islamic month: ${month}`);

	// Months before al-Muḥarram belong to the zakat year that opened in `year`;
	// the rest belong to the one that opened an Islamic year earlier.
	const definition = buildZakatYearDefinition(monthIndex < 4 ? year : year - 1);
	return definition.months[monthIndex]!.endDate;
}

/** All twelve months of a zakat year with their end dates, in Ramaḍān → Shaʿbān order. */
export function getZakatYearMonths(zakatYear: string): {
	month: IslamicMonth;
	year: number;
	endDate: Date;
}[] {
	return getDefinitionForLabel(zakatYear).months.map((month) => ({
		month: month.month,
		year: month.islamicYear,
		endDate: month.endDate,
	}));
}

/** Format an Islamic date as "Month Year" (e.g., "Ramaḍān 1446"). */
export function formatIslamicDate(month: IslamicMonth, year: number): string {
	return `${month} ${year}`;
}

/** Current Islamic month and year. */
export function getCurrentIslamicDate(): { month: IslamicMonth; year: number } {
	const now = new Date();
	return {
		month: getIslamicMonthName(now),
		year: getIslamicYear(now),
	};
}

/**
 * Announced first days of Ramaḍān in Pakistan.
 *
 * Alias of `PAKISTAN_RAMADAN_STARTS` — the same table, not a copy — kept so the older
 * name stays valid. Prefer importing `PAKISTAN_RAMADAN_STARTS` from `@/lib/zakatCalendar`.
 */
export const KNOWN_RAMADAN_DATES = PAKISTAN_RAMADAN_STARTS;

/**
 * The 1 Ramaḍān anchor actually used for a year: the announced Pakistan sighting when one
 * exists, otherwise the umalqura date plus one day.
 */
export function getRamadanStartDate(islamicYear: number): Date {
	return resolveRamadanStart(islamicYear).date;
}
