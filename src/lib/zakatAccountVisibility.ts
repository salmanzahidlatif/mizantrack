/**
 * Which account rows are worth putting in front of the owner for a zakat year.
 *
 * An account that was selected but held nothing for all twelve months is noise: it
 * contributes exactly zero to every monthly TOTAL, so hiding it changes no number
 * anywhere in the chain. A single non-zero month — positive or negative — brings the
 * row back in full, because an overdrawn account or a liability genuinely reduces
 * zakatable wealth and must stay visible.
 *
 * The screen and the exported workbook both read this one predicate so they can never
 * disagree about which accounts appear. Nothing here is a calculation: it is a
 * presentation filter and it never touches the engine's figures.
 */
import type { ZakatAccountMonthBalance } from "@/lib/zakatEngine";

/** Zakat sheets are kept to the currency's minor unit, as the owner's workbook is. */
const CURRENCY_MINOR_UNITS = 100;

/**
 * Month-end balances are floating point sums, so a closed-out account can land on a
 * residue like `0.0000000004`. Rounding to the minor unit first makes that a true zero.
 */
function toCurrencyPrecision(amount: number): number {
	return Math.round((amount + Number.EPSILON) * CURRENCY_MINOR_UNITS) / CURRENCY_MINOR_UNITS;
}

/** True when at least one month rounds to a non-zero amount, of either sign. */
export function hasAnyMonthlyBalance(balances: readonly number[]): boolean {
	return balances.some((balance) => Number.isFinite(balance) && toCurrencyPrecision(balance) !== 0);
}

/** The account rows to render or export, in the engine's original order. */
export function visibleZakatAccounts<Account extends Pick<ZakatAccountMonthBalance, "balances">>(
	accounts: readonly Account[]
): Account[] {
	return accounts.filter((account) => hasAnyMonthlyBalance(account.balances));
}

/** The shape a saved calculation stores each account in. */
export interface ZakatSnapshotAccountBalance {
	balance: number;
	zakatable: boolean;
}

/**
 * True when a saved snapshot carries accounts that were NOT part of the assessment.
 *
 * Calculations saved before the snapshot was narrowed listed every account in the
 * currency, counted or not. The record is never rewritten — a determination made on a
 * date is exactly what the History trail exists to preserve — so the wide shape is
 * detected on read instead, and the screen says so rather than presenting 51 accounts as
 * contributors to a figure a handful of them produced.
 */
export function hasUncountedZakatSnapshotAccounts(
	accountBalances: readonly ZakatSnapshotAccountBalance[]
): boolean {
	return accountBalances.some((account) => !account.zakatable);
}

/**
 * The accounts a saved snapshot can evidence as contributors.
 *
 * Two filters, in order: the snapshot's own counted flag, and then the same zero-balance
 * rule the monthly view and the exported workbook apply — an account that held nothing
 * contributed nothing, whichever way it was flagged. Nothing is deleted; the stored row
 * keeps every account it was saved with.
 */
export function getContributingZakatSnapshotAccounts<Account extends ZakatSnapshotAccountBalance>(
	accountBalances: readonly Account[]
): Account[] {
	return accountBalances.filter(
		(account) => account.zakatable && hasAnyMonthlyBalance([account.balance])
	);
}
