/**
 * The data a zakat year is assessed from, loaded once.
 *
 * Every screen that quotes a year's figure — the calculator, the carry-forward chain, the
 * History audit — needs the same six tables. Loading them here, and handing them to
 * `prepareZakatYearAssessmentContext`, is what keeps those screens from drifting apart:
 * there is one loader and one assembly, so a year cannot mean one thing on one tab and
 * something else on another.
 *
 * The tables are read whole and the per-year lookups are built once. History may list a
 * decade of saved calculations, and a query per row would be a query per year on every
 * keystroke that touches the database.
 */

import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";

import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { db } from "@/lib/db/local";
import { prepareZakatYearAssessmentContext } from "@/lib/zakatYearAssessment";

import type { ZakatYearAssessmentContext } from "@/lib/zakatYearAssessment";

/**
 * Returns the prepared context, or `undefined` while the tables are still loading.
 *
 * Undefined means "not known yet", never "nothing there": a caller must not report a
 * year as assessed at zero, or a saved calculation as matching, on data it has not read.
 */
export function useZakatYearAssessmentContext(
	userId: string,
	referenceCurrency: string
): ZakatYearAssessmentContext | undefined {
	const currency = normalizeCurrencyCode(referenceCurrency);

	// Archived accounts are loaded too: a closed account still held wealth during the
	// years it was open, and each year decides for itself whether it counts.
	const accounts = useLiveQuery(
		() =>
			db.accounts
				.where("userId")
				.equals(userId)
				.filter((a) => !a.deletedAt)
				.toArray(),
		[userId]
	);

	const transactions = useLiveQuery(
		() =>
			db.transactions
				.where("userId")
				.equals(userId)
				.filter((t) => !t.deletedAt)
				.toArray(),
		[userId]
	);

	const goldItems = useLiveQuery(
		() =>
			db.goldItems
				.where("userId")
				.equals(userId)
				.filter((g) => !g.deletedAt)
				.toArray(),
		[userId]
	);

	const goldYears = useLiveQuery(
		() => db.zakatGoldYears.where("userId").equals(userId).toArray(),
		[userId]
	);

	const yearOverrides = useLiveQuery(
		() => db.zakatYears.where("userId").equals(userId).toArray(),
		[userId]
	);

	const payments = useLiveQuery(
		() => db.zakatPayments.where("userId").equals(userId).sortBy("date"),
		[userId]
	);

	return useMemo(() => {
		if (!accounts || !transactions || !goldItems || !goldYears || !yearOverrides || !payments) {
			return undefined;
		}

		return prepareZakatYearAssessmentContext({
			userId,
			referenceCurrency: currency,
			accounts,
			transactions,
			goldItems,
			goldYears,
			yearOverrides,
			payments,
		});
	}, [accounts, currency, goldItems, goldYears, payments, transactions, userId, yearOverrides]);
}
