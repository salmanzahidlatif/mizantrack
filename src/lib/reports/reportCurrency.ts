/**
 * Currency scoping for the fiscal report.
 *
 * A `Transaction` carries no currency of its own: its currency is simply the currency of
 * the account it is recorded against. The whole fiscal report is scoped to ONE selected
 * currency, so detection, aggregation and the export all share the rules below.
 */
import { currencyCodesMatch, normalizeCurrencyCode } from "@/lib/analytics/balanceMath";

import type { Account, Transaction } from "@/types";

/** Index of the accounts a transaction may reference. Deleted accounts are left out. */
export function buildAccountCurrencyIndex(accounts: Account[]): Map<string, Account> {
	return new Map(
		accounts.filter((account) => !account.deletedAt).map((account) => [account.id, account])
	);
}

/** The currency a transaction's amount is denominated in: its account's currency. */
export function resolveTransactionCurrency(
	transaction: Transaction,
	accountById: Map<string, Account>
): string {
	return normalizeCurrencyCode(accountById.get(transaction.accountId)?.currency);
}

/**
 * Scope rule: a transaction belongs to the selected currency when its account does.
 * A transaction whose account is missing or deleted belongs to no currency and is
 * excluded rather than silently treated as a match.
 */
export function transactionMatchesCurrency(
	transaction: Transaction,
	accountById: Map<string, Account>,
	currency: string
): boolean {
	const target = normalizeCurrencyCode(currency);
	if (!target) return true;

	const account = accountById.get(transaction.accountId);
	if (!account) return false;

	return currencyCodesMatch(account.currency, target);
}
