import type { FilterPeriod, DateRange } from "@/types";

const MS_PER_MINUTE = 60 * 1000;
const MONTH_LABELS = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;

export type AnalyticsInterval =
	| "monthly"
	| "quarterly"
	| "half-yearly"
	| "yearly"
	| "all-time"
	| "custom";

export interface DateRangeOptions {
	now?: Date;
	timeZoneOffsetMinutes?: number;
}

export interface AnalyticsPeriodOptions extends DateRangeOptions {
	interval: AnalyticsInterval;
	anchorDate?: Date;
	fiscalYearStartMonth?: number;
	customRange?: DateRange;
}

export interface ResolvedAnalyticsPeriod {
	interval: AnalyticsInterval;
	key: string;
	label: string;
	from: Date;
	to: Date;
	fromMs: number;
	toMs: number;
}

export interface MonthRange {
	date: Date;
	key: string;
	label: string;
	shortLabel: string;
	from: Date;
	to: Date;
	fromMs: number;
	toMs: number;
}

export interface MonthStripOptions {
	months?: number;
	timeZoneOffsetMinutes?: number;
}

export interface PeriodRange extends MonthRange {
	interval: AnalyticsInterval;
}

export interface PeriodRangeOptions extends DateRangeOptions {
	interval: AnalyticsInterval;
	fiscalYearStartMonth?: number;
}

export type PeriodStripMode = "around" | "ending";

export interface PeriodStripOptions extends PeriodRangeOptions {
	periods?: number;
	mode?: PeriodStripMode;
}

const PERIOD_MONTH_SPANS: Record<AnalyticsInterval, number> = {
	monthly: 1,
	quarterly: 3,
	"half-yearly": 6,
	yearly: 12,
	"all-time": 12,
	custom: 1,
};

const PERIOD_UNIT_LABELS: Record<AnalyticsInterval, { one: string; many: string }> = {
	monthly: { one: "month", many: "months" },
	quarterly: { one: "quarter", many: "quarters" },
	"half-yearly": { one: "half-year", many: "half-years" },
	yearly: { one: "year", many: "years" },
	"all-time": { one: "year", many: "years" },
	custom: { one: "period", many: "periods" },
};

function clampFiscalYearStartMonth(month: number): number {
	return Math.min(12, Math.max(1, Math.floor(month)));
}

export function getLocalTimeZoneOffsetMinutes(now = new Date()): number {
	return -now.getTimezoneOffset();
}

function getTimeZoneOffsetMinutes(options?: DateRangeOptions, fallbackDate = new Date()): number {
	return (
		options?.timeZoneOffsetMinutes ?? getLocalTimeZoneOffsetMinutes(options?.now ?? fallbackDate)
	);
}

function shiftedUtcDate(date: Date, timeZoneOffsetMinutes: number): Date {
	return new Date(date.getTime() + timeZoneOffsetMinutes * MS_PER_MINUTE);
}

function localDateFromParts(
	year: number,
	monthIndex: number,
	day: number,
	timeZoneOffsetMinutes: number,
	hours = 0,
	minutes = 0,
	seconds = 0,
	milliseconds = 0
): Date {
	return new Date(
		Date.UTC(year, monthIndex, day, hours, minutes, seconds, milliseconds) -
			timeZoneOffsetMinutes * MS_PER_MINUTE
	);
}

function formatYearMonth(year: number, monthIndex: number): string {
	return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function getLocalParts(date: Date, timeZoneOffsetMinutes: number) {
	const shifted = shiftedUtcDate(date, timeZoneOffsetMinutes);
	return {
		year: shifted.getUTCFullYear(),
		monthIndex: shifted.getUTCMonth(),
		day: shifted.getUTCDate(),
		dayOfWeek: shifted.getUTCDay(),
	};
}

function startOfLocalDay(date: Date, timeZoneOffsetMinutes: number): Date {
	const { year, monthIndex, day } = getLocalParts(date, timeZoneOffsetMinutes);
	return localDateFromParts(year, monthIndex, day, timeZoneOffsetMinutes);
}

function endFromNextStart(nextStart: Date): Date {
	return new Date(nextStart.getTime() - 1);
}

function startOfLocalWeek(date: Date, timeZoneOffsetMinutes: number): Date {
	const { year, monthIndex, day, dayOfWeek } = getLocalParts(date, timeZoneOffsetMinutes);
	return localDateFromParts(year, monthIndex, day - dayOfWeek, timeZoneOffsetMinutes);
}

function startOfLocalMonth(date: Date, timeZoneOffsetMinutes: number, monthOffset = 0): Date {
	const { year, monthIndex } = getLocalParts(date, timeZoneOffsetMinutes);
	return localDateFromParts(year, monthIndex + monthOffset, 1, timeZoneOffsetMinutes);
}

function startOfLocalQuarter(date: Date, timeZoneOffsetMinutes: number): Date {
	const { year, monthIndex } = getLocalParts(date, timeZoneOffsetMinutes);
	const quarterStartMonth = Math.floor(monthIndex / 3) * 3;
	return localDateFromParts(year, quarterStartMonth, 1, timeZoneOffsetMinutes);
}

function startOfLocalHalfYear(date: Date, timeZoneOffsetMinutes: number): Date {
	const { year, monthIndex } = getLocalParts(date, timeZoneOffsetMinutes);
	return localDateFromParts(year, monthIndex < 6 ? 0 : 6, 1, timeZoneOffsetMinutes);
}

function startOfLocalYear(date: Date, timeZoneOffsetMinutes: number): Date {
	const { year } = getLocalParts(date, timeZoneOffsetMinutes);
	return localDateFromParts(year, 0, 1, timeZoneOffsetMinutes);
}

function startOfLocalFiscalYear(
	date: Date,
	fiscalYearStartMonth: number,
	timeZoneOffsetMinutes: number
): Date {
	const { year, monthIndex } = getLocalParts(date, timeZoneOffsetMinutes);
	const fiscalStartIndex = clampFiscalYearStartMonth(fiscalYearStartMonth) - 1;
	const startYear = monthIndex >= fiscalStartIndex ? year : year - 1;
	return localDateFromParts(startYear, fiscalStartIndex, 1, timeZoneOffsetMinutes);
}

export function getMonthKey(date: Date, options: DateRangeOptions = {}): string {
	const timeZoneOffsetMinutes = getTimeZoneOffsetMinutes(options, date);
	const { year, monthIndex } = getLocalParts(date, timeZoneOffsetMinutes);
	return formatYearMonth(year, monthIndex);
}

export function formatMonthLabel(date: Date, options: DateRangeOptions = {}): string {
	const timeZoneOffsetMinutes = getTimeZoneOffsetMinutes(options, date);
	const { year, monthIndex } = getLocalParts(date, timeZoneOffsetMinutes);
	return `${MONTH_LABELS[monthIndex]} ${String(year).slice(-2)}`;
}

export function getMonthRange(date: Date, options: DateRangeOptions = {}): MonthRange {
	const timeZoneOffsetMinutes = getTimeZoneOffsetMinutes(options, date);
	const from = startOfLocalMonth(date, timeZoneOffsetMinutes);
	const to = endFromNextStart(startOfLocalMonth(date, timeZoneOffsetMinutes, 1));
	const { year, monthIndex } = getLocalParts(from, timeZoneOffsetMinutes);
	const shortLabel = `${MONTH_LABELS[monthIndex]} ${String(year).slice(-2)}`;
	const label = `${MONTH_LABELS[monthIndex]} ${year}`;

	return {
		date: from,
		key: formatYearMonth(year, monthIndex),
		label,
		shortLabel,
		from,
		to,
		fromMs: from.getTime(),
		toMs: to.getTime(),
	};
}

export function getMonthRangeOffset(
	date: Date,
	monthOffset: number,
	options: DateRangeOptions = {}
): MonthRange {
	const timeZoneOffsetMinutes = getTimeZoneOffsetMinutes(options, date);
	return getMonthRange(startOfLocalMonth(date, timeZoneOffsetMinutes, monthOffset), {
		timeZoneOffsetMinutes,
	});
}

export function getMonthStripRanges(
	anchorDate = new Date(),
	options: MonthStripOptions = {}
): MonthRange[] {
	const months = Math.max(1, Math.floor(options.months ?? 5));
	const timeZoneOffsetMinutes =
		options.timeZoneOffsetMinutes ?? getLocalTimeZoneOffsetMinutes(anchorDate);
	const before = Math.floor((months - 1) / 2);
	const anchorStart = startOfLocalMonth(anchorDate, timeZoneOffsetMinutes);

	return Array.from({ length: months }, (_, index) =>
		getMonthRangeOffset(anchorStart, index - before, {
			timeZoneOffsetMinutes,
		})
	);
}

export function resolveAnalyticsPeriod(options: AnalyticsPeriodOptions): ResolvedAnalyticsPeriod {
	const anchorDate = options.anchorDate ?? options.now ?? new Date();
	const timeZoneOffsetMinutes = getTimeZoneOffsetMinutes(options, anchorDate);
	const fiscalYearStartMonth = clampFiscalYearStartMonth(options.fiscalYearStartMonth ?? 1);

	if (options.interval === "custom") {
		const range = options.customRange;
		if (!range) {
			const fallback = getMonthRange(anchorDate, { timeZoneOffsetMinutes });
			return {
				interval: "custom",
				key: fallback.key,
				label: fallback.label,
				from: fallback.from,
				to: fallback.to,
				fromMs: fallback.fromMs,
				toMs: fallback.toMs,
			};
		}
		return {
			interval: "custom",
			key: "custom",
			label: "Custom",
			from: range.from,
			to: range.to,
			fromMs: range.from.getTime(),
			toMs: range.to.getTime(),
		};
	}

	if (options.interval === "all-time") {
		return {
			interval: "all-time",
			key: "all-time",
			label: "All Time",
			from: new Date(0),
			to: new Date(8640000000000000),
			fromMs: 0,
			toMs: 8640000000000000,
		};
	}

	if (options.interval === "monthly") {
		const month = getMonthRange(anchorDate, { timeZoneOffsetMinutes });
		return {
			interval: "monthly",
			key: month.key,
			label: month.label,
			from: month.from,
			to: month.to,
			fromMs: month.fromMs,
			toMs: month.toMs,
		};
	}

	const shifted = shiftedUtcDate(anchorDate, timeZoneOffsetMinutes);
	let from: Date;
	let to: Date;
	let key: string;
	let label: string;

	if (options.interval === "quarterly") {
		from = startOfLocalQuarter(anchorDate, timeZoneOffsetMinutes);
		to = endFromNextStart(startOfLocalMonth(from, timeZoneOffsetMinutes, 3));
		const parts = getLocalParts(from, timeZoneOffsetMinutes);
		const quarter = Math.floor(parts.monthIndex / 3) + 1;
		key = `${parts.year}-Q${quarter}`;
		label = `Q${quarter} ${parts.year}`;
	} else if (options.interval === "half-yearly") {
		from = startOfLocalHalfYear(anchorDate, timeZoneOffsetMinutes);
		to = endFromNextStart(startOfLocalMonth(from, timeZoneOffsetMinutes, 6));
		const parts = getLocalParts(from, timeZoneOffsetMinutes);
		const half = parts.monthIndex === 0 ? 1 : 2;
		key = `${parts.year}-H${half}`;
		label = `H${half} ${parts.year}`;
	} else {
		from = startOfLocalFiscalYear(anchorDate, fiscalYearStartMonth, timeZoneOffsetMinutes);
		to = endFromNextStart(startOfLocalMonth(from, timeZoneOffsetMinutes, 12));
		const parts = getLocalParts(from, timeZoneOffsetMinutes);
		const endParts = getLocalParts(to, timeZoneOffsetMinutes);
		key =
			fiscalYearStartMonth === 1
				? String(shifted.getUTCFullYear())
				: `FY-${parts.year}-${endParts.year}`;
		label =
			fiscalYearStartMonth === 1
				? String(shifted.getUTCFullYear())
				: `FY ${parts.year}/${String(endParts.year).slice(-2)}`;
	}

	return {
		interval: options.interval,
		key,
		label,
		from,
		to,
		fromMs: from.getTime(),
		toMs: to.getTime(),
	};
}

export function getPeriodMonthSpan(interval: AnalyticsInterval): number {
	return PERIOD_MONTH_SPANS[interval] ?? 1;
}

export function getPeriodUnitLabel(interval: AnalyticsInterval, count = 1): string {
	const unit = PERIOD_UNIT_LABELS[interval] ?? PERIOD_UNIT_LABELS.monthly;
	return count === 1 ? unit.one : unit.many;
}

function getPeriodShortLabel(
	period: ResolvedAnalyticsPeriod,
	timeZoneOffsetMinutes: number
): string {
	const { year, monthIndex } = getLocalParts(period.from, timeZoneOffsetMinutes);
	const shortYear = String(year).slice(-2);

	if (period.interval === "quarterly") {
		return `Q${Math.floor(monthIndex / 3) + 1} ${shortYear}`;
	}
	if (period.interval === "half-yearly") {
		return `H${monthIndex < 6 ? 1 : 2} ${shortYear}`;
	}
	if (period.interval === "yearly") {
		if (monthIndex === 0) return String(year);
		const endParts = getLocalParts(period.to, timeZoneOffsetMinutes);
		return `FY ${shortYear}/${String(endParts.year).slice(-2)}`;
	}

	return `${MONTH_LABELS[monthIndex]} ${shortYear}`;
}

export function getPeriodRange(date: Date, options: PeriodRangeOptions): PeriodRange {
	const timeZoneOffsetMinutes = getTimeZoneOffsetMinutes(options, date);
	const interval = options.interval;

	if (interval === "monthly" || interval === "custom") {
		return { ...getMonthRange(date, { timeZoneOffsetMinutes }), interval };
	}

	const period = resolveAnalyticsPeriod({
		interval: interval === "all-time" ? "yearly" : interval,
		anchorDate: date,
		fiscalYearStartMonth: interval === "all-time" ? 1 : options.fiscalYearStartMonth,
		timeZoneOffsetMinutes,
	});

	return {
		interval,
		date: period.from,
		key: period.key,
		label: period.label,
		shortLabel: getPeriodShortLabel(period, timeZoneOffsetMinutes),
		from: period.from,
		to: period.to,
		fromMs: period.fromMs,
		toMs: period.toMs,
	};
}

export function getPeriodRangeOffset(
	date: Date,
	periodOffset: number,
	options: PeriodRangeOptions
): PeriodRange {
	const timeZoneOffsetMinutes = getTimeZoneOffsetMinutes(options, date);
	const current = getPeriodRange(date, { ...options, timeZoneOffsetMinutes });
	if (periodOffset === 0) return current;

	const shifted = startOfLocalMonth(
		current.from,
		timeZoneOffsetMinutes,
		periodOffset * getPeriodMonthSpan(options.interval)
	);

	return getPeriodRange(shifted, { ...options, timeZoneOffsetMinutes });
}

export function getPeriodStripRanges(
	anchorDate = new Date(),
	options: PeriodStripOptions = { interval: "monthly" }
): PeriodRange[] {
	const periods = Math.max(1, Math.floor(options.periods ?? 5));
	const timeZoneOffsetMinutes = getTimeZoneOffsetMinutes(options, anchorDate);
	const before = options.mode === "ending" ? periods - 1 : Math.floor((periods - 1) / 2);

	return Array.from({ length: periods }, (_, index) =>
		getPeriodRangeOffset(anchorDate, index - before, { ...options, timeZoneOffsetMinutes })
	);
}

export function getDateRange(
	period: FilterPeriod,
	fiscalYearStartMonth = 7, // July
	customRange?: DateRange,
	options: DateRangeOptions = {}
): DateRange {
	const now = options.now ?? new Date();
	const timeZoneOffsetMinutes = getTimeZoneOffsetMinutes(options, now);

	switch (period) {
		case "today": {
			const from = startOfLocalDay(now, timeZoneOffsetMinutes);
			return {
				from,
				to: endFromNextStart(
					startOfLocalDay(new Date(from.getTime() + 86400000), timeZoneOffsetMinutes)
				),
			};
		}

		case "week": {
			const from = startOfLocalWeek(now, timeZoneOffsetMinutes);
			return {
				from,
				to: endFromNextStart(
					localDateFromParts(
						getLocalParts(from, timeZoneOffsetMinutes).year,
						getLocalParts(from, timeZoneOffsetMinutes).monthIndex,
						getLocalParts(from, timeZoneOffsetMinutes).day + 7,
						timeZoneOffsetMinutes
					)
				),
			};
		}

		case "month": {
			const month = getMonthRange(now, { timeZoneOffsetMinutes });
			return { from: month.from, to: month.to };
		}

		case "quarter": {
			const periodRange = resolveAnalyticsPeriod({
				interval: "quarterly",
				anchorDate: now,
				timeZoneOffsetMinutes,
			});
			return { from: periodRange.from, to: periodRange.to };
		}

		case "half-year": {
			const periodRange = resolveAnalyticsPeriod({
				interval: "half-yearly",
				anchorDate: now,
				timeZoneOffsetMinutes,
			});
			return { from: periodRange.from, to: periodRange.to };
		}

		case "year": {
			const from = startOfLocalYear(now, timeZoneOffsetMinutes);
			const to = endFromNextStart(startOfLocalMonth(from, timeZoneOffsetMinutes, 12));
			return { from, to };
		}

		case "fiscal-year": {
			const periodRange = resolveAnalyticsPeriod({
				interval: "yearly",
				anchorDate: now,
				fiscalYearStartMonth,
				timeZoneOffsetMinutes,
			});
			return { from: periodRange.from, to: periodRange.to };
		}

		case "custom":
			return customRange ?? getDateRange("month", fiscalYearStartMonth, undefined, options);

		case "all":
			// Return epoch-start (0) as `from` so useTransactions skips the from-filter (0 is falsy)
			return { from: new Date(0), to: new Date(8640000000000000) };

		default:
			return getDateRange("month", fiscalYearStartMonth, undefined, options);
	}
}
