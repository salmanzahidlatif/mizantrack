import { format } from "date-fns";

import { getLocalTimeZoneOffsetMinutes } from "@/lib/dateRange";

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;
/** Furthest timestamp a JavaScript `Date` can represent. */
const MAX_TIMESTAMP = 8.64e15;
/** Head-room so a zone offset can never push a timestamp past `MAX_TIMESTAMP`. */
const TIMESTAMP_SAFETY_MARGIN = 2 * MS_PER_DAY;
/** Longest window a custom comparison may span, so the preceding window stays representable. */
const MAX_CUSTOM_WINDOW_DAYS = 50 * 365;
const FALLBACK_RANGE_LABEL = "Unknown range";
const DEFAULT_ROLLING_MONTHS = 6;

export type ComparisonPresetId =
	| "month-vs-last-month"
	| "quarter-vs-prev-quarter"
	| "half-vs-prev-half"
	| "year-rolling-vs-prev"
	| "year-vs-last-year"
	| "custom";

export interface ComparisonRange {
	fromMs: number;
	toMs: number;
	label: string;
}

export interface ComparisonRangeBounds {
	fromMs: number;
	toMs: number;
}

export interface ComparisonRangePair {
	presetId: ComparisonPresetId;
	current: ComparisonRange;
	previous: ComparisonRange;
}

export interface ComparisonRangeBoundsPair {
	presetId: ComparisonPresetId;
	current: ComparisonRangeBounds;
	previous: ComparisonRangeBounds;
}

export interface ComparisonPresetOption {
	value: ComparisonPresetId;
	label: string;
}

export const COMPARISON_PRESET_OPTIONS: readonly ComparisonPresetOption[] = [
	{ value: "month-vs-last-month", label: "This month vs last month" },
	{ value: "quarter-vs-prev-quarter", label: "Last 3 months vs previous 3 months" },
	{ value: "half-vs-prev-half", label: "Last 6 months vs previous 6 months" },
	{ value: "year-rolling-vs-prev", label: "Last 12 months vs previous 12 months" },
	{ value: "year-vs-last-year", label: "This year vs last year" },
	{ value: "custom", label: "Custom range vs preceding range" },
] as const;

export interface ResolveComparisonRangesOptions {
	presetId: ComparisonPresetId;
	now?: Date;
	customRange?: { from: Date; to: Date };
	fiscalYearStartMonth?: number;
	timeZoneOffsetMinutes?: number;
}

/** Rolling month spans for the "last N months vs previous N months" presets. */
const ROLLING_MONTH_SPANS: Partial<Record<ComparisonPresetId, number>> = {
	"quarter-vs-prev-quarter": 3,
	"half-vs-prev-half": 6,
	"year-rolling-vs-prev": 12,
};

export function getComparisonPresetLabel(presetId: ComparisonPresetId): string {
	return (
		COMPARISON_PRESET_OPTIONS.find((option) => option.value === presetId)?.label ??
		"Custom range vs preceding range"
	);
}

interface LocalParts {
	year: number;
	monthIndex: number;
	day: number;
}

interface BoundsPair {
	current: ComparisonRangeBounds;
	previous: ComparisonRangeBounds;
}

function getLocalParts(ms: number, timeZoneOffsetMinutes: number): LocalParts {
	const shifted = new Date(ms + timeZoneOffsetMinutes * MS_PER_MINUTE);
	return {
		year: shifted.getUTCFullYear(),
		monthIndex: shifted.getUTCMonth(),
		day: shifted.getUTCDate(),
	};
}

/**
 * Local calendar days are counted as whole days since the epoch in the target zone. Working in
 * day numbers rather than raw milliseconds keeps window alignment stable across DST shifts.
 */
function toLocalDayNumber(ms: number, timeZoneOffsetMinutes: number): number {
	return Math.floor((ms + timeZoneOffsetMinutes * MS_PER_MINUTE) / MS_PER_DAY);
}

function startOfLocalDayMs(dayNumber: number, timeZoneOffsetMinutes: number): number {
	return dayNumber * MS_PER_DAY - timeZoneOffsetMinutes * MS_PER_MINUTE;
}

function endOfLocalDayMs(dayNumber: number, timeZoneOffsetMinutes: number): number {
	return startOfLocalDayMs(dayNumber + 1, timeZoneOffsetMinutes) - 1;
}

function dayNumberFromParts(parts: LocalParts): number {
	return Math.floor(Date.UTC(parts.year, parts.monthIndex, parts.day) / MS_PER_DAY);
}

function daysInMonth(year: number, monthIndex: number): number {
	return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Shifts a calendar anchor by whole months, clamping the day to the last valid day of the
 * target month so 29 Feb (or the 31st) never rolls forward into the next month.
 */
function shiftCalendarParts(parts: LocalParts, monthDelta: number): LocalParts {
	const absoluteMonth = parts.year * 12 + parts.monthIndex + monthDelta;
	const year = Math.floor(absoluteMonth / 12);
	const monthIndex = absoluteMonth - year * 12;
	return { year, monthIndex, day: Math.min(parts.day, daysInMonth(year, monthIndex)) };
}

function clampFiscalYearStartMonth(month: number | undefined): number {
	if (!Number.isFinite(month ?? NaN)) return 1;
	return Math.min(12, Math.max(1, Math.floor(month as number)));
}

function buildBoundsFromDays(
	fromDay: number,
	toDay: number,
	timeZoneOffsetMinutes: number
): ComparisonRangeBounds {
	return {
		fromMs: startOfLocalDayMs(fromDay, timeZoneOffsetMinutes),
		toMs: endOfLocalDayMs(toDay, timeZoneOffsetMinutes),
	};
}

/**
 * Builds a Date whose *system-local* parts equal the target zone's parts so `date-fns`
 * formatting stays deterministic regardless of the machine running the code.
 */
function toDisplayDate(ms: number, timeZoneOffsetMinutes: number): Date {
	const shifted = new Date(ms + timeZoneOffsetMinutes * MS_PER_MINUTE);
	return new Date(
		shifted.getUTCFullYear(),
		shifted.getUTCMonth(),
		shifted.getUTCDate(),
		12,
		0,
		0,
		0
	);
}

/** Never throws: an unformattable timestamp degrades to a safe placeholder. */
function formatRangeLabel(fromMs: number, toMs: number, timeZoneOffsetMinutes: number): string {
	try {
		const from = getLocalParts(fromMs, timeZoneOffsetMinutes);
		const to = getLocalParts(toMs, timeZoneOffsetMinutes);
		const fromDisplay = toDisplayDate(fromMs, timeZoneOffsetMinutes);
		const toDisplay = toDisplayDate(toMs, timeZoneOffsetMinutes);

		if (from.year === to.year && from.monthIndex === to.monthIndex && from.day === to.day) {
			return format(toDisplay, "d MMM yyyy");
		}
		if (from.year === to.year) {
			return `${format(fromDisplay, "d MMM")} – ${format(toDisplay, "d MMM yyyy")}`;
		}
		return `${format(fromDisplay, "d MMM yyyy")} – ${format(toDisplay, "d MMM yyyy")}`;
	} catch {
		return FALLBACK_RANGE_LABEL;
	}
}

function withLabel(bounds: ComparisonRangeBounds, timeZoneOffsetMinutes: number): ComparisonRange {
	return {
		fromMs: bounds.fromMs,
		toMs: bounds.toMs,
		label: formatRangeLabel(bounds.fromMs, bounds.toMs, timeZoneOffsetMinutes),
	};
}

/** Inclusive number of local calendar days a window covers. */
export function getComparisonRangeDayCount(
	range: ComparisonRangeBounds,
	timeZoneOffsetMinutes: number
): number {
	return (
		toLocalDayNumber(range.toMs, timeZoneOffsetMinutes) -
		toLocalDayNumber(range.fromMs, timeZoneOffsetMinutes) +
		1
	);
}

/**
 * Places the preceding window so it can never overlap the current one. The calendar-aligned
 * anchor is preferred, but when a shorter earlier month would push the window past the current
 * start (e.g. 1–31 Mar against February) the window slides back to end the day before the
 * current window begins, preserving the equal day count.
 */
function placePreviousWindow(
	anchorStartDay: number,
	currentStartDay: number,
	days: number
): { fromDay: number; toDay: number } {
	const toDay = Math.min(anchorStartDay + days - 1, currentStartDay - 1);
	return { fromDay: toDay - days + 1, toDay };
}

/**
 * Calendar-aligned, period-to-date comparison: the current window runs from the start of the
 * calendar (or fiscal) period to the end of today, and the previous window starts at the
 * equivalent calendar anchor one period earlier and spans the same number of days.
 */
function resolveCalendarAlignedBounds(
	now: Date,
	timeZoneOffsetMinutes: number,
	monthSpan: number,
	startParts: LocalParts
): BoundsPair {
	const todayDay = toLocalDayNumber(now.getTime(), timeZoneOffsetMinutes);
	const currentStartDay = dayNumberFromParts(startParts);
	const naturalEndDay = dayNumberFromParts(shiftCalendarParts(startParts, monthSpan)) - 1;
	const currentEndDay = Math.max(currentStartDay, Math.min(naturalEndDay, todayDay));
	const days = currentEndDay - currentStartDay + 1;
	const previous = placePreviousWindow(
		dayNumberFromParts(shiftCalendarParts(startParts, -monthSpan)),
		currentStartDay,
		days
	);

	return {
		current: buildBoundsFromDays(currentStartDay, currentEndDay, timeZoneOffsetMinutes),
		previous: buildBoundsFromDays(previous.fromDay, previous.toDay, timeZoneOffsetMinutes),
	};
}

function resolveMonthBounds(now: Date, timeZoneOffsetMinutes: number): BoundsPair {
	const nowParts = getLocalParts(now.getTime(), timeZoneOffsetMinutes);
	return resolveCalendarAlignedBounds(now, timeZoneOffsetMinutes, 1, {
		year: nowParts.year,
		monthIndex: nowParts.monthIndex,
		day: 1,
	});
}

function resolveYearBounds(
	now: Date,
	fiscalYearStartMonth: number | undefined,
	timeZoneOffsetMinutes: number
): BoundsPair {
	const nowParts = getLocalParts(now.getTime(), timeZoneOffsetMinutes);
	const fiscalStartIndex = clampFiscalYearStartMonth(fiscalYearStartMonth) - 1;
	const startYear = nowParts.monthIndex >= fiscalStartIndex ? nowParts.year : nowParts.year - 1;

	return resolveCalendarAlignedBounds(now, timeZoneOffsetMinutes, 12, {
		year: startYear,
		monthIndex: fiscalStartIndex,
		day: 1,
	});
}

/**
 * Rolling, period-to-date comparison: the current window starts on the first day of the month
 * `months - 1` back and ends today; the previous window has an identical day count and ends the
 * day before the current window starts.
 */
function resolveRollingBounds(
	months: number,
	now: Date,
	timeZoneOffsetMinutes: number
): BoundsPair {
	const nowParts = getLocalParts(now.getTime(), timeZoneOffsetMinutes);
	const todayDay = toLocalDayNumber(now.getTime(), timeZoneOffsetMinutes);
	const currentStartDay = dayNumberFromParts(
		shiftCalendarParts(
			{ year: nowParts.year, monthIndex: nowParts.monthIndex, day: 1 },
			-(months - 1)
		)
	);
	const currentEndDay = Math.max(currentStartDay, todayDay);
	const days = currentEndDay - currentStartDay + 1;

	return {
		current: buildBoundsFromDays(currentStartDay, currentEndDay, timeZoneOffsetMinutes),
		previous: buildBoundsFromDays(
			currentStartDay - days,
			currentStartDay - 1,
			timeZoneOffsetMinutes
		),
	};
}

function clampTimestamp(ms: number): number {
	const limit = MAX_TIMESTAMP - TIMESTAMP_SAFETY_MARGIN;
	return Math.min(limit, Math.max(-limit, ms));
}

/**
 * Custom ranges come straight from a date picker, so they may be inverted, unbounded ("All"
 * spans the entire `Date` domain) or otherwise degenerate. The window is normalised to whole
 * local days, never ends after today, and is capped so the preceding window of equal length
 * stays inside the representable `Date` domain.
 */
function resolveCustomBounds(
	customRange: { from: Date; to: Date },
	now: Date,
	timeZoneOffsetMinutes: number
): BoundsPair | null {
	const rawFrom = customRange.from?.getTime?.();
	const rawTo = customRange.to?.getTime?.();
	if (!Number.isFinite(rawFrom) || !Number.isFinite(rawTo)) return null;

	const lower = clampTimestamp(Math.min(rawFrom as number, rawTo as number));
	const upper = clampTimestamp(Math.max(rawFrom as number, rawTo as number));
	const todayDay = toLocalDayNumber(now.getTime(), timeZoneOffsetMinutes);

	const toDay = Math.min(toLocalDayNumber(upper, timeZoneOffsetMinutes), todayDay);
	let fromDay = Math.min(toLocalDayNumber(lower, timeZoneOffsetMinutes), toDay);
	if (toDay - fromDay + 1 > MAX_CUSTOM_WINDOW_DAYS) fromDay = toDay - MAX_CUSTOM_WINDOW_DAYS + 1;
	const days = toDay - fromDay + 1;

	return {
		current: buildBoundsFromDays(fromDay, toDay, timeZoneOffsetMinutes),
		previous: buildBoundsFromDays(fromDay - days, fromDay - 1, timeZoneOffsetMinutes),
	};
}

function resolveNow(now: Date | undefined): Date {
	return Number.isFinite(now?.getTime() ?? NaN) ? (now as Date) : new Date();
}

function resolveOffsetMinutes(timeZoneOffsetMinutes: number | undefined, now: Date): number {
	return Number.isFinite(timeZoneOffsetMinutes ?? NaN)
		? (timeZoneOffsetMinutes as number)
		: getLocalTimeZoneOffsetMinutes(now);
}

/** Numeric-only resolution; safe on the cache-key path because it never formats a date. */
export function resolveComparisonRangeBounds(
	options: ResolveComparisonRangesOptions
): ComparisonRangeBoundsPair {
	const now = resolveNow(options.now);
	const timeZoneOffsetMinutes = resolveOffsetMinutes(options.timeZoneOffsetMinutes, now);
	const presetId = options.presetId;

	if (presetId === "custom") {
		const custom = options.customRange
			? resolveCustomBounds(options.customRange, now, timeZoneOffsetMinutes)
			: null;
		return {
			presetId,
			...(custom ?? resolveRollingBounds(DEFAULT_ROLLING_MONTHS, now, timeZoneOffsetMinutes)),
		};
	}

	if (presetId === "year-vs-last-year") {
		return {
			presetId,
			...resolveYearBounds(now, options.fiscalYearStartMonth, timeZoneOffsetMinutes),
		};
	}

	if (presetId === "month-vs-last-month") {
		return { presetId, ...resolveMonthBounds(now, timeZoneOffsetMinutes) };
	}

	return {
		presetId,
		...resolveRollingBounds(
			ROLLING_MONTH_SPANS[presetId] ?? DEFAULT_ROLLING_MONTHS,
			now,
			timeZoneOffsetMinutes
		),
	};
}

export function resolveComparisonRanges(
	options: ResolveComparisonRangesOptions
): ComparisonRangePair {
	const bounds = resolveComparisonRangeBounds(options);
	const timeZoneOffsetMinutes = resolveOffsetMinutes(
		options.timeZoneOffsetMinutes,
		resolveNow(options.now)
	);

	return {
		presetId: bounds.presetId,
		current: withLabel(bounds.current, timeZoneOffsetMinutes),
		previous: withLabel(bounds.previous, timeZoneOffsetMinutes),
	};
}
