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
