import { addDays, addMonths, addWeeks, addYears, isValid, startOfDay } from "date-fns";

import type { RecurrenceFrequency, RecurrenceRule } from "@/types";

/**
 * Occurrences are materialised as real transactions the moment the owner saves, so a
 * runaway rule would write thousands of rows into Dexie. This caps any single series;
 * the form refuses a count above it and an open-ended "until" stops here.
 */
export const MAX_RECURRENCE_OCCURRENCES = 240;

export const RECURRENCE_FREQUENCIES: RecurrenceFrequency[] = [
	"daily",
	"weekly",
	"monthly",
	"yearly",
];

const FREQUENCY_UNIT: Record<RecurrenceFrequency, { one: string; many: string }> = {
	daily: { one: "day", many: "days" },
	weekly: { one: "week", many: "weeks" },
	monthly: { one: "month", many: "months" },
	yearly: { one: "year", many: "years" },
};

/**
 * Steps from the anchor rather than from the previous occurrence. Chaining would drift:
 * 31 Jan + 1 month clamps to 28 Feb, and a second chained step would then yield 28 Mar.
 * Measuring every occurrence from the anchor keeps 31 Jan → 28 Feb → 31 Mar.
 */
function addInterval(anchor: Date, frequency: RecurrenceFrequency, steps: number): Date {
	switch (frequency) {
		case "daily":
			return addDays(anchor, steps);
		case "weekly":
			return addWeeks(anchor, steps);
		case "monthly":
			return addMonths(anchor, steps);
		case "yearly":
			return addYears(anchor, steps);
	}
}

export function describeRecurrenceFrequency(
	frequency: RecurrenceFrequency,
	interval: number
): string {
	const unit = FREQUENCY_UNIT[frequency];
	if (interval <= 1) return `Every ${unit.one}`;
	return `Every ${interval} ${unit.many}`;
}

export function describeRecurrenceRule(rule: RecurrenceRule, occurrenceCount: number): string {
	const cadence = describeRecurrenceFrequency(rule.frequency, rule.interval);
	const plural = occurrenceCount === 1 ? "transaction" : "transactions";
	return `${cadence} · ${occurrenceCount} ${plural}`;
}

/**
 * Expands a rule into the dates the series should occupy, the anchor included as the
 * first occurrence. Returns an empty list when the rule cannot produce anything, so a
 * caller never has to distinguish "no occurrences" from "invalid".
 */
export function generateRecurrenceDates(startDate: Date, rule: RecurrenceRule): Date[] {
	if (!isValid(startDate)) return [];

	const interval = Math.floor(rule.interval);
	if (!Number.isFinite(interval) || interval < 1) return [];

	const anchor = startOfDay(startDate);
	const dates: Date[] = [];

	if (rule.endMode === "count") {
		const count = Math.floor(rule.count);
		if (!Number.isFinite(count) || count < 1) return [];
		const total = Math.min(count, MAX_RECURRENCE_OCCURRENCES);

		for (let index = 0; index < total; index += 1) {
			dates.push(addInterval(anchor, rule.frequency, index * interval));
		}
		return dates;
	}

	const until = startOfDay(rule.until);
	if (!isValid(until) || until.getTime() < anchor.getTime()) return [];

	for (let index = 0; index < MAX_RECURRENCE_OCCURRENCES; index += 1) {
		const next = addInterval(anchor, rule.frequency, index * interval);
		if (next.getTime() > until.getTime()) break;
		dates.push(next);
	}
	return dates;
}

/**
 * Preserves the clock time the owner picked (transactions carry a timestamp, not a day)
 * while the step maths runs on whole days so a DST shift cannot move an occurrence.
 */
export function generateRecurrenceTimestamps(startDate: Date, rule: RecurrenceRule): number[] {
	if (!isValid(startDate)) return [];

	const anchor = startOfDay(startDate);
	const timeOfDayMs = startDate.getTime() - anchor.getTime();

	return generateRecurrenceDates(startDate, rule).map((date) => date.getTime() + timeOfDayMs);
}
