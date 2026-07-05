/**
 * Islamic Calendar (Hijri) utilities for Zakat calculations
 *
 * Note: This is a simplified implementation using approximate conversions.
 * For production, consider using a library like `hijri-converter` or `moment-hijri`
 * for more accurate astronomical calculations.
 */

import { ISLAMIC_MONTHS, type IslamicMonth } from "@/types";

// Average Islamic year is ~354.36 days (purely lunar)
const HIJRI_EPOCH = new Date("622-07-16").getTime(); // Approximate Hijri epoch
const ISLAMIC_YEAR_MS = 354.36 * 24 * 60 * 60 * 1000;
const ISLAMIC_MONTH_MS = 29.53 * 24 * 60 * 60 * 1000; // Average lunar month

/**
 * Convert Gregorian date to approximate Islamic year
 */
export function getIslamicYear(date: Date): number {
	const elapsed = date.getTime() - HIJRI_EPOCH;
	return Math.floor(elapsed / ISLAMIC_YEAR_MS) + 1;
}

/**
 * Get the Islamic month name for a given date
 * Returns the month within the ZAKAT YEAR cycle (Ramadan → Sha'ban)
 */
export function getIslamicMonthName(date: Date): IslamicMonth {
	const year = getIslamicYear(date);
	const yearStart = getIslamicYearStart(year);
	const elapsed = date.getTime() - yearStart.getTime();
	const monthIndex = Math.floor(elapsed / ISLAMIC_MONTH_MS) % 12;
	return ISLAMIC_MONTHS[monthIndex]!;
}

/**
 * Get the zakat year string (e.g., "1446-1447")
 * Zakat year runs from Ramadan of year N to Sha'ban of year N+1
 */
export function getZakatYear(date: Date): string {
	const islamicYear = getIslamicYear(date);
	const monthName = getIslamicMonthName(date);

	// If we're in Ramadan through Zul-Hijjah, it's the first part of the zakat year
	const firstHalfMonths: IslamicMonth[] = ["Ramaḍān", "Shawwāl", "Zū al-Qaʿdah", "Zū al-Ḥijjah"];

	if (firstHalfMonths.includes(monthName)) {
		return `${islamicYear}-${islamicYear + 1}`;
	} else {
		// Muharram through Sha'ban, it's the second part
		return `${islamicYear - 1}-${islamicYear}`;
	}
}

/**
 * Get the start date (Ramadan 1st) for a given Islamic year
 */
function getIslamicYearStart(year: number): Date {
	const elapsed = (year - 1) * ISLAMIC_YEAR_MS;
	return new Date(HIJRI_EPOCH + elapsed);
}

/**
 * Get the date range for a zakat year (Ramadan start → Sha'ban end)
 */
export function getZakatYearRange(zakatYear: string): { start: Date; end: Date } {
	const parts = zakatYear.split("-").map(Number);
	const startYear = parts[0]!;
	const endYear = parts[1]!;

	const ramadanStart = getIslamicYearStart(startYear);
	const shabanEnd = new Date(getIslamicYearStart(endYear).getTime() - 1); // Day before next Ramadan

	return { start: ramadanStart, end: shabanEnd };
}

/**
 * Get the end date for a specific Islamic month in a year
 * @param month - Islamic month name
 * @param year - Islamic year number
 */
export function getIslamicMonthEndDate(month: IslamicMonth, year: number): Date {
	const monthIndex = ISLAMIC_MONTHS.indexOf(month);
	if (monthIndex === -1) throw new Error(`Invalid Islamic month: ${month}`);

	const yearStart = getIslamicYearStart(year);
	const monthEnd = new Date(yearStart.getTime() + (monthIndex + 1) * ISLAMIC_MONTH_MS - 1);

	return monthEnd;
}

/**
 * Get all 12 Islamic months for a zakat year with their end dates
 */
export function getZakatYearMonths(zakatYear: string): {
	month: IslamicMonth;
	year: number;
	endDate: Date;
}[] {
	const parts = zakatYear.split("-").map(Number);
	const startYear = parts[0]!;
	const endYear = parts[1]!;

	return ISLAMIC_MONTHS.map((month, index) => {
		// First 4 months are from startYear, last 8 are from endYear
		const year = index < 4 ? startYear : endYear;
		return {
			month,
			year,
			endDate: getIslamicMonthEndDate(month, year),
		};
	});
}

/**
 * Format Islamic date as "Month Year" (e.g., "Ramadan 1446")
 */
export function formatIslamicDate(month: IslamicMonth, year: number): string {
	return `${month} ${year}`;
}

/**
 * Get current Islamic month and year
 */
export function getCurrentIslamicDate(): { month: IslamicMonth; year: number } {
	const now = new Date();
	return {
		month: getIslamicMonthName(now),
		year: getIslamicYear(now),
	};
}

/**
 * IMPORTANT DATES FOR REFERENCE (based on analysis):
 * These are the actual dates from the corrected zakat sheets
 *
 * 2024 Sheet (1444-1445 AH):
 * - Ramadan 1444: 24 Mar - 21 Apr 2024
 * - Sha'ban 1445: 12 Feb - 11 Mar 2024
 *
 * 2025 Sheet (1445-1446 AH):
 * - Ramadan 1445: 12 Mar - 10 Apr 2024
 * - Sha'ban 1446: 31 Jan - 28 Feb 2025
 *
 * 2026 Sheet (1446-1447 AH):
 * - Ramadan 1446: 1 Mar - 30 Mar 2025
 * - Sha'ban 1447: 20 Jan - 17 Feb 2026
 */

// For more accurate dates, you can hardcode known Ramadan start dates
// and calculate from there, or integrate with an external API
export const KNOWN_RAMADAN_DATES: Record<number, string> = {
	1444: "2024-03-24",
	1445: "2024-03-12", // Corrected based on analysis
	1446: "2025-03-01",
	1447: "2026-02-17",
	1448: "2027-02-06",
};

/**
 * Get accurate Ramadan start date for a known year
 */
export function getRamadanStartDate(islamicYear: number): Date | null {
	const dateStr = KNOWN_RAMADAN_DATES[islamicYear];
	return dateStr ? new Date(dateStr) : null;
}
