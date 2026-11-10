/**
 * Pay-period attribution for salary payments.
 *
 * Salaries are often credited a few days off their pay period: last month's salary lands
 * on the 1st, or this month's lands on the 29th of the previous month. Bucketing by credit
 * date then produces one month with two salaries next to a month with none, which reads as
 * a 100% raise followed by a pay cut.
 *
 * This module decides which calendar month each payment was *for*:
 *  1. A description that names exactly one nearby month ("November 2023", "may salary")
 *     is authoritative.
 *  2. For categories paid regularly, a payment is moved to an adjacent month only to fill
 *     a month that would otherwise have no salary, and only when it was credited within a
 *     few days of that month boundary. Everything else stays where it was credited.
 *
 * Genuine double months are left alone: a second job paid alongside the main salary
 * (neighbouring months are not empty), and a bonus paid as one large transaction
 * (there is only one payment).
 */

import type { Transaction } from "@/types";

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTHS_PER_YEAR = 12;

/** A payment credited this close to a month boundary may belong to the neighbouring month. */
export const PAY_PERIOD_BOUNDARY_DAYS = 7;
/** Payments smaller than this share of the category's typical payment are side income. */
const REGULAR_PAYMENT_SHARE = 0.5;
/** A category needs at least this many regular-sized payments before it is reconciled. */
const MIN_REGULAR_PAYMENTS = 6;
/** ...and must have a payment in at least this share of the months it spans. */
const MIN_REGULAR_MONTH_COVERAGE = 0.6;
/** How far a described month may sit from the credit month (inclusive). */
const DESCRIBED_MONTH_MIN_OFFSET = -3;
const DESCRIBED_MONTH_MAX_OFFSET = 1;

const MONTH_TOKENS: Record<string, number> = {
	january: 0,
	jan: 0,
	february: 1,
	feb: 1,
	march: 2,
	mar: 2,
	april: 3,
	apr: 3,
	may: 4,
	june: 5,
	jun: 5,
	july: 6,
	jul: 6,
	august: 7,
	aug: 7,
	september: 8,
	sept: 8,
	sep: 8,
	october: 9,
	oct: 9,
	november: 10,
	nov: 10,
	december: 11,
	dec: 11,
};

export type SalaryAttributionReason = "credited" | "description" | "pay-period";

export interface SalaryAttribution {
	transactionId: string;
	/** Absolute local month index (year * 12 + month) the payment was credited in. */
	creditMonthIndex: number;
	/** Absolute local month index the payment is attributed to. */
	monthIndex: number;
	/** Timestamp inside the attributed month, used for bucketing. */
	effectiveMs: number;
	reason: SalaryAttributionReason;
}

export interface SalaryAttributionOptions {
	nowMs: number;
	timeZoneOffsetMinutes: number;
}

interface LocalDateParts {
	year: number;
	month: number;
	day: number;
	daysInMonth: number;
	monthIndex: number;
}

function getLocalDateParts(ms: number, timeZoneOffsetMinutes: number): LocalDateParts {
	const shifted = new Date(ms + timeZoneOffsetMinutes * MS_PER_MINUTE);
	const year = shifted.getUTCFullYear();
	const month = shifted.getUTCMonth();
	return {
		year,
		month,
		day: shifted.getUTCDate(),
		daysInMonth: new Date(Date.UTC(year, month + 1, 0)).getUTCDate(),
		monthIndex: year * MONTHS_PER_YEAR + month,
	};
}

export function getMonthIndex(ms: number, timeZoneOffsetMinutes: number): number {
	return getLocalDateParts(ms, timeZoneOffsetMinutes).monthIndex;
}

/** First instant of a local month, as epoch ms. */
export function getMonthStartMs(monthIndex: number, timeZoneOffsetMinutes: number): number {
	const year = Math.floor(monthIndex / MONTHS_PER_YEAR);
	const month = monthIndex - year * MONTHS_PER_YEAR;
	return Date.UTC(year, month, 1) - timeZoneOffsetMinutes * MS_PER_MINUTE;
}

/**
 * The month a description refers to, when it names exactly one month close to the credit
 * month. "April and June salary" names two months and is ignored rather than guessed.
 */
export function parseDescribedMonthIndex(
	description: string | undefined,
	creditMonthIndex: number
): number | undefined {
	if (!description) return undefined;

	const tokens = description
		.normalize("NFKD")
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter(Boolean);
	const months = new Set<number>();
	const years = new Set<number>();
	for (const token of tokens) {
		const month = MONTH_TOKENS[token];
		if (month !== undefined) months.add(month);
		else if (/^(19|20)\d{2}$/.test(token)) years.add(Number(token));
	}
	if (months.size !== 1 || years.size > 1) return undefined;

	const [month] = [...months] as [number];
	const isInRange = (index: number) => {
		const offset = index - creditMonthIndex;
		return offset >= DESCRIBED_MONTH_MIN_OFFSET && offset <= DESCRIBED_MONTH_MAX_OFFSET;
	};

	if (years.size === 1) {
		const [year] = [...years] as [number];
		const index = year * MONTHS_PER_YEAR + month;
		return isInRange(index) ? index : undefined;
	}

	const creditYear = Math.floor(creditMonthIndex / MONTHS_PER_YEAR);
	// Candidates are 12 months apart, so at most one falls inside the narrow window.
	return [creditYear - 1, creditYear, creditYear + 1]
		.map((year) => year * MONTHS_PER_YEAR + month)
		.find(isInRange);
}

function median(values: number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

interface PaymentState {
	transaction: Transaction;
	parts: LocalDateParts;
	describedMonthIndex: number | undefined;
	isRegularSize: boolean;
}

/** Regular salary streams are reconciled; irregular ones (bonus, commission) never are. */
function isRegularStream(payments: PaymentState[]): boolean {
	const regular = payments.filter((payment) => payment.isRegularSize);
	if (regular.length < MIN_REGULAR_PAYMENTS) return false;

	const months = new Set(regular.map((payment) => payment.parts.monthIndex));
	const indices = [...months];
	const span = Math.max(...indices) - Math.min(...indices) + 1;
	return span > 0 && months.size / span >= MIN_REGULAR_MONTH_COVERAGE;
}

const FIXED_OWNER = -1;

/**
 * Resolves collisions only. Every regular payment first sits in its own month (or the
 * month its description names). A month left holding a second payment then gives it up
 * to the nearest empty month reachable by boundary moves, using the shortest chain of
 * moves so a late payment is fixed locally and never ripples through the whole year.
 * Moves stay inside the stream's own span, so nothing lands before employment started
 * or in a month that has not been paid yet.
 */
function reconcileRegularStream(
	payments: PaymentState[],
	options: SalaryAttributionOptions
): Map<number, number> {
	const nowMonthIndex = getMonthIndex(options.nowMs, options.timeZoneOffsetMinutes);
	const regular = payments
		.map((payment, index) => ({ payment, index }))
		.filter(({ payment }) => payment.isRegularSize);
	const baseMonth = (payment: PaymentState) =>
		payment.describedMonthIndex ?? payment.parts.monthIndex;
	const baseMonths = regular.map(({ payment }) => baseMonth(payment));
	const spanStart = Math.min(...baseMonths);
	const spanEnd = Math.min(Math.max(...baseMonths), nowMonthIndex);

	const occupant = new Map<number, number>();
	const extras: number[] = [];
	// Described payments claim their month first; a payment's own words beat its timing.
	for (const { payment } of regular) {
		if (payment.describedMonthIndex === undefined) continue;
		if (!occupant.has(payment.describedMonthIndex)) {
			occupant.set(payment.describedMonthIndex, FIXED_OWNER);
		}
	}
	for (const { payment, index } of regular) {
		if (payment.describedMonthIndex !== undefined) continue;
		const month = payment.parts.monthIndex;
		if (occupant.has(month)) extras.push(index);
		else occupant.set(month, index);
	}

	const neighbours = (payment: PaymentState): number[] => {
		const { monthIndex, day, daysInMonth } = payment.parts;
		const months: number[] = [];
		if (day <= PAY_PERIOD_BOUNDARY_DAYS) months.push(monthIndex - 1);
		if (day > daysInMonth - PAY_PERIOD_BOUNDARY_DAYS) months.push(monthIndex + 1);
		return months.filter((month) => month >= spanStart && month <= spanEnd);
	};

	const assigned = new Map<number, number>();
	for (const extra of extras) {
		const extraPayment = payments[extra]!;
		const previous = new Map<number, { fromMonth: number | undefined; payment: number }>();
		const queue: number[] = [];
		// The extra may also push its credit month's occupant onward to make room.
		for (const month of [...neighbours(extraPayment), extraPayment.parts.monthIndex]) {
			if (previous.has(month)) continue;
			previous.set(month, { fromMonth: undefined, payment: extra });
			queue.push(month);
		}

		let freeMonth: number | undefined;
		for (let cursor = 0; cursor < queue.length; cursor++) {
			const month = queue[cursor]!;
			const owner = occupant.get(month);
			if (owner === undefined) {
				freeMonth = month;
				break;
			}
			if (owner === FIXED_OWNER) continue;

			const ownerPayment = payments[owner]!;
			// A previously moved owner may also step back into its own credit month.
			for (const next of [...neighbours(ownerPayment), ownerPayment.parts.monthIndex]) {
				if (previous.has(next)) continue;
				previous.set(next, { fromMonth: month, payment: owner });
				queue.push(next);
			}
		}
		if (freeMonth === undefined) continue;

		let month: number | undefined = freeMonth;
		while (month !== undefined) {
			const step: { fromMonth: number | undefined; payment: number } = previous.get(month)!;
			occupant.set(month, step.payment);
			assigned.set(step.payment, month);
			month = step.fromMonth;
		}
	}

	return assigned;
}

/**
 * Attribute each salary payment to the month it was for. Input order does not matter;
 * the result is keyed by transaction id.
 */
export function attributeSalaryPayments(
	transactions: Transaction[],
	options: SalaryAttributionOptions
): Map<string, SalaryAttribution> {
	const { timeZoneOffsetMinutes } = options;
	const nowMonthIndex = getMonthIndex(options.nowMs, timeZoneOffsetMinutes);
	const byCategory = new Map<string, PaymentState[]>();

	const sorted = [...transactions].sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
	for (const transaction of sorted) {
		const parts = getLocalDateParts(transaction.date, timeZoneOffsetMinutes);
		const key = transaction.categoryId ?? "";
		const described = parseDescribedMonthIndex(transaction.description, parts.monthIndex);
		const state: PaymentState = {
			transaction,
			parts,
			// A month that has not started yet would fall outside every chart bucket.
			describedMonthIndex:
				described !== undefined && described <= nowMonthIndex ? described : undefined,
			isRegularSize: false,
		};
		const group = byCategory.get(key);
		if (group) group.push(state);
		else byCategory.set(key, [state]);
	}

	const result = new Map<string, SalaryAttribution>();
	for (const payments of byCategory.values()) {
		const typical = median(payments.map((payment) => payment.transaction.amount));
		for (const payment of payments) {
			payment.isRegularSize =
				typical > 0 && payment.transaction.amount >= typical * REGULAR_PAYMENT_SHARE;
		}

		const reconciled = isRegularStream(payments)
			? reconcileRegularStream(payments, options)
			: new Map<number, number>();

		payments.forEach((payment, index) => {
			const { transaction, parts, describedMonthIndex } = payment;
			const reconciledMonth = reconciled.get(index);
			let monthIndex = parts.monthIndex;
			let reason: SalaryAttributionReason = "credited";

			if (describedMonthIndex !== undefined && describedMonthIndex !== parts.monthIndex) {
				monthIndex = describedMonthIndex;
				reason = "description";
			} else if (reconciledMonth !== undefined && reconciledMonth !== parts.monthIndex) {
				monthIndex = reconciledMonth;
				reason = "pay-period";
			}

			result.set(transaction.id, {
				transactionId: transaction.id,
				creditMonthIndex: parts.monthIndex,
				monthIndex,
				// Mid-month keeps the timestamp safely inside the month in any time zone.
				effectiveMs:
					monthIndex === parts.monthIndex
						? transaction.date
						: getMonthStartMs(monthIndex, timeZoneOffsetMinutes) + 14 * MS_PER_DAY,
				reason,
			});
		});
	}

	return result;
}
