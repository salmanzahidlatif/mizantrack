import { getLocalTimeZoneOffsetMinutes, resolveAnalyticsPeriod } from "@/lib/dateRange";

const MS_PER_MINUTE = 60 * 1000;
const MAX_FISCAL_YEARS = 15;

export interface FiscalYearOption {
	key: string;
	label: string;
	fromMs: number;
	toMs: number;
}

export interface ListFiscalYearOptionsParams {
	fiscalYearStartMonth: number;
	earliestTransactionMs?: number;
	now?: Date;
	timeZoneOffsetMinutes?: number;
}

function getLocalYear(date: Date, timeZoneOffsetMinutes: number): number {
	return new Date(date.getTime() + timeZoneOffsetMinutes * MS_PER_MINUTE).getUTCFullYear();
}

/** Matches the user's own folder naming, e.g. "2023 - 2024". */
function formatFiscalYearLabel(from: Date, to: Date, timeZoneOffsetMinutes: number): string {
	const fromYear = getLocalYear(from, timeZoneOffsetMinutes);
	const toYear = getLocalYear(to, timeZoneOffsetMinutes);
	return fromYear === toYear ? String(fromYear) : `${fromYear} - ${toYear}`;
}

/**
 * Lists selectable fiscal years, newest first, walking back from the current fiscal year
 * to the one containing `earliestTransactionMs` (capped at 15 years).
 */
export function listFiscalYearOptions(params: ListFiscalYearOptionsParams): FiscalYearOption[] {
	const now = params.now ?? new Date();
	const timeZoneOffsetMinutes = params.timeZoneOffsetMinutes ?? getLocalTimeZoneOffsetMinutes(now);
	const { fiscalYearStartMonth, earliestTransactionMs } = params;

	const options: FiscalYearOption[] = [];
	let anchorDate = now;

	while (options.length < MAX_FISCAL_YEARS) {
		const period = resolveAnalyticsPeriod({
			interval: "yearly",
			anchorDate,
			fiscalYearStartMonth,
			timeZoneOffsetMinutes,
		});

		options.push({
			key: period.key,
			label: formatFiscalYearLabel(period.from, period.to, timeZoneOffsetMinutes),
			fromMs: period.fromMs,
			toMs: period.toMs,
		});

		if (earliestTransactionMs === undefined || earliestTransactionMs >= period.fromMs) break;

		// The last millisecond before this fiscal year always falls inside the previous one.
		anchorDate = new Date(period.fromMs - 1);
	}

	return options;
}
