import { endOfDay, format } from "date-fns";

import { computeAccountBalances, normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import {
	buildZakatYearDefinition,
	getZakatIslamicYearForDate,
	getZakatIslamicYearRange,
} from "@/lib/zakatCalendar";

import type { ZakatMonthDefinition, ZakatYearDefinition } from "@/lib/zakatCalendar";
import type { Account, GoldItem, GoldPurity, Transaction } from "@/types";

export type { ZakatMonthDefinition, ZakatYearDefinition } from "@/lib/zakatCalendar";

export type ZakatBasis = "minimum" | "maximum";

export interface ZakatAccountMonthBalance {
	accountId: string;
	accountTitle: string;
	currency: string;
	accountType: "asset" | "liability";
	isArchived: boolean;
	balances: number[];
}

export interface ZakatYearGrid {
	year: ZakatYearDefinition;
	accounts: ZakatAccountMonthBalance[];
	monthlyTotals: number[];
	minimum: number;
	maximum: number;
}

export interface GoldPriceInput {
	priceDate: string;
	pricesByPurity: Partial<Record<GoldPurity, number>>;
}

export interface ZakatAssessmentInput {
	monthlyTotals: number[];
	basis: ZakatBasis;
	goldItems: Pick<GoldItem, "weight" | "purity">[];
	goldPrices: GoldPriceInput;
	ratePercent: number;
	pastRemaining: number;
	payments: Array<{ amount: number }>;
}

export interface ZakatAssessment {
	minimum: number;
	maximum: number;
	basisAmount: number;
	goldValue: number;
	totalZakatable: number;
	ratePercent: number;
	zakatObligation: number;
	perMonth: number;
	pastRemaining: number;
	totalToPay: number;
	paid: number;
	balanceOrExcess: number;
}

export interface ZakatYearQueryOptions {
	/** Persisted 1 Ramaḍān anchors by Islamic year, from the user's `zakatYears` overrides. */
	ramadanStarts?: Map<number, Date>;
	/** Reference date used to centre the generated window. */
	date?: Date;
}

/**
 * Generates every zakat year the app currently exposes: ten back through five forward of
 * the Islamic year we are in. Pass `ramadanStarts` to apply the user's saved anchors.
 */
export function getZakatYearDefinitions(
	options: ZakatYearQueryOptions = {}
): ZakatYearDefinition[] {
	const { ramadanStarts, date = new Date() } = options;
	return getZakatIslamicYearRange(date, ramadanStarts).map((islamicYear) =>
		buildZakatYearDefinition(islamicYear, ramadanStarts?.get(islamicYear))
	);
}

/**
 * Snapshot of the generated window taken when the module loads.
 *
 * Kept for callers that only need the default (override-free) calendar. Anything that
 * must reflect saved overrides, or that runs long enough to cross a Ramaḍān, should call
 * `getZakatYearDefinitions()` instead.
 */
export const ZAKAT_YEAR_DEFINITIONS: ZakatYearDefinition[] = getZakatYearDefinitions();

export function getZakatYearDefinitionByIslamicYear(
	islamicYear: number,
	options: ZakatYearQueryOptions = {}
): ZakatYearDefinition {
	return buildZakatYearDefinition(islamicYear, options.ramadanStarts?.get(islamicYear));
}

/**
 * Looks a year up by its sheet year — the Gregorian year the zakat year ends in.
 *
 * Lunar years drift about eleven days a year against the Gregorian calendar, so roughly
 * once every three decades two zakat years end in the same Gregorian year (AH1450 and
 * AH1451 both end in 2030). The earliest match wins, which keeps this deterministic;
 * `getZakatYearDefinitionByIslamicYear` is the unambiguous lookup.
 */
export function getZakatYearDefinition(
	sheetYear: number,
	options: ZakatYearQueryOptions = {}
): ZakatYearDefinition {
	const definition = getZakatYearDefinitions(options).find((year) => year.sheetYear === sheetYear);
	if (!definition) {
		throw new Error(`Unsupported zakat sheet year: ${sheetYear}`);
	}
	return definition;
}

export function getDefaultZakatIslamicYear(
	date = new Date(),
	options: Pick<ZakatYearQueryOptions, "ramadanStarts"> = {}
): number {
	return getZakatIslamicYearForDate(date, options.ramadanStarts);
}

export function getDefaultZakatSheetYear(
	date = new Date(),
	options: Pick<ZakatYearQueryOptions, "ramadanStarts"> = {}
): number {
	return getZakatYearDefinitionByIslamicYear(getDefaultZakatIslamicYear(date, options), {
		...options,
		date,
	}).sheetYear;
}

export function formatZakatMonthRange(month: ZakatMonthDefinition): string {
	return `${format(month.startDate, "d MMM")} - ${format(month.endDate, "d MMM")}`;
}

export function normalizeZakatAccountBalance(account: Account, balance: number): number {
	if (account.accountType === "liability") return -Math.abs(balance);
	return balance;
}

export function computeZakatYearGrid({
	userId,
	accounts,
	transactions,
	selectedAccountIds,
	sheetYear,
	yearDefinition,
}: {
	userId: string;
	accounts: Account[];
	transactions: Transaction[];
	selectedAccountIds: Set<string>;
	sheetYear: number;
	/** Pass an already-resolved definition when the user's overrides have been loaded. */
	yearDefinition?: ZakatYearDefinition;
}): ZakatYearGrid {
	const year = yearDefinition ?? getZakatYearDefinition(sheetYear);
	const selectedAccounts = accounts.filter(
		(account) => !account.deletedAt && selectedAccountIds.has(account.id)
	);
	const accountRows = new Map<string, ZakatAccountMonthBalance>(
		selectedAccounts.map((account) => [
			account.id,
			{
				accountId: account.id,
				accountTitle: account.title,
				currency: normalizeCurrencyCode(account.currency),
				accountType: account.accountType ?? "asset",
				isArchived: account.isArchived,
				balances: [],
			},
		])
	);

	// When each account was first used, so months before it are reported as empty rather
	// than as the account's present-day opening balance.
	const firstActivityMs = new Map<string, number>();
	for (const transaction of transactions) {
		if (transaction.userId !== userId || transaction.deletedAt) continue;
		for (const accountId of [transaction.accountId, transaction.toAccountId]) {
			if (!accountId) continue;
			const existing = firstActivityMs.get(accountId);
			if (existing === undefined || transaction.date < existing) {
				firstActivityMs.set(accountId, transaction.date);
			}
		}
	}

	function hasActivityBy(accountId: string, cutoffMs: number): boolean {
		const firstMs = firstActivityMs.get(accountId);
		return firstMs !== undefined && firstMs <= cutoffMs;
	}

	const monthlyTotals = year.months.map((month) => {
		const cutoffMs = endOfDay(month.endDate).getTime();
		const computed = computeAccountBalances(userId, accounts, transactions, {
			asOfMs: cutoffMs,
		}).balances;

		let total = 0;
		for (const account of selectedAccounts) {
			// An account only counts once it has actually been used. Opening balances apply
			// from the beginning of time, so without this an account opened years later still
			// shows its present balance in every earlier month — a bridge account opened in
			// 2024 appeared to hold millions throughout 2019.
			const balance = hasActivityBy(account.id, cutoffMs)
				? normalizeZakatAccountBalance(account, computed.get(account.id) ?? 0)
				: 0;
			accountRows.get(account.id)?.balances.push(balance);
			total += balance;
		}
		return total;
	});

	return {
		year,
		accounts: Array.from(accountRows.values()),
		monthlyTotals,
		minimum: minimumMonthlyTotal(monthlyTotals),
		maximum: monthlyTotals.length > 0 ? Math.max(...monthlyTotals) : 0,
	};
}

/**
 * The year's MINIMUM, counting only the months something was actually held.
 *
 * A zakat year can begin before the book has any history behind it: the AED year opens
 * two months before its earliest transaction, and `computeZakatYearGrid` reports those
 * months as zero because no account existed yet — not because the wealth had been spent.
 * A plain `MIN` over all twelve then returned 0 and declared no zakat due on a year that
 * plainly held money every month after.
 *
 * So a month is only a candidate once it holds something. A year that genuinely held
 * nothing all year still has no minimum, and still owes nothing.
 *
 * The owner's own sheet writes `MIN(B14:M14)` across the row, and this agrees with it
 * everywhere the sheet applies: his books never contain a zero month, so every month is
 * a candidate and the answer is identical. This only changes years the sheet never had.
 */
export function minimumMonthlyTotal(monthlyTotals: readonly number[]): number {
	const held = monthlyTotals.filter((total) => total > 0);
	return held.length > 0 ? Math.min(...held) : 0;
}

export function calculateGoldValue(
	goldItems: Pick<GoldItem, "weight" | "purity">[],
	pricesByPurity: Partial<Record<GoldPurity, number>>
): number {
	return goldItems.reduce((sum, item) => sum + item.weight * (pricesByPurity[item.purity] ?? 0), 0);
}

export function calculateZakatAssessment({
	monthlyTotals,
	basis,
	goldItems,
	goldPrices,
	ratePercent,
	pastRemaining,
	payments,
}: ZakatAssessmentInput): ZakatAssessment {
	const minimum = minimumMonthlyTotal(monthlyTotals);
	const maximum = monthlyTotals.length > 0 ? Math.max(...monthlyTotals) : 0;
	const basisAmount = basis === "minimum" ? minimum : maximum;
	const goldValue = calculateGoldValue(goldItems, goldPrices.pricesByPurity);
	const totalZakatable = basisAmount + goldValue;
	const zakatObligation = totalZakatable * (ratePercent / 100);
	const paid = payments.reduce((sum, payment) => sum + payment.amount, 0);
	const totalToPay = zakatObligation + pastRemaining;

	return {
		minimum,
		maximum,
		basisAmount,
		goldValue,
		totalZakatable,
		ratePercent,
		zakatObligation,
		perMonth: zakatObligation / 12,
		pastRemaining,
		totalToPay,
		paid,
		balanceOrExcess: totalToPay - paid,
	};
}
