/**
 * How one zakat year is assembled, in ONE place.
 *
 * A year's assessment is not just a call to `calculateZakatAssessment`: it is the
 * accounts chosen for that year, the closed-accounts rule that year was settled under,
 * that year's month-end grid, that year's grams at that year's price per gram, and that
 * year's payments. Every one of those is a decision, and every screen that quotes a
 * year's figure has to make the same ones — the calculator, the carry-forward chain and
 * the History audit alike.
 *
 * Assembling that by hand in each caller is exactly how the saved snapshots and the live
 * figures drifted apart in the first place, so the assembly lives here and the callers
 * only supply the data and ask for a year.
 *
 * Nothing here computes tax. Zakat is a religious obligation; this module only reproduces
 * the owner's own workbook maths, which stays in `@/lib/zakatEngine`.
 */

import { format } from "date-fns";

import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { ZAKAT_EARLIEST_ISLAMIC_YEAR } from "@/lib/zakatCalendar";
import { ZAKAT_CARRY_FORWARD_MAX_LOOKBACK_YEARS } from "@/lib/zakatCarryForward";
import {
	calculateZakatAssessment,
	computeZakatYearGrid,
	getZakatYearDefinitionByIslamicYear,
} from "@/lib/zakatEngine";
import {
	buildZakatGoldSoldLineages,
	getZakatGoldYearItems,
	toZakatGoldYearItemLedger,
	toZakatGoldYearItemMap,
} from "@/lib/zakatGoldYearItems";
import {
	getZakatGoldYearPrices,
	resolveZakatGoldGramsForYear,
	sumZakatGoldGrams,
	toZakatGoldItems,
	toZakatGoldYearMap,
} from "@/lib/zakatGoldYearRepository";
import {
	toPastRemainingOverrideMap,
	toRamadanStartMap,
	toZakatAccountSelectionMap,
	toZakatShowArchivedAccountsMap,
} from "@/lib/zakatYearRepository";

import type {
	ZakatAssessment,
	ZakatAssessmentInput,
	ZakatBasis,
	ZakatYearDefinition,
	ZakatYearGrid,
} from "@/lib/zakatEngine";
import type {
	Account,
	GoldItem,
	GoldPurity,
	Transaction,
	ZakatGoldYear,
	ZakatGoldYearItem,
	ZakatPayment,
	ZakatYearOverride,
} from "@/types";

/** The owner's workbook rate. Editable on screen; stored with every calculation. */
export const DEFAULT_ZAKAT_RATE_PERCENT = 2.5;

/** Closed accounts are listed, and counted, until the owner says otherwise. */
export const ZAKAT_SHOW_ARCHIVED_ACCOUNTS_DEFAULT = true;

export function getZakatAccountsForCurrency(accounts: Account[], currency: string): Account[] {
	const normalizedCurrency = normalizeCurrencyCode(currency);
	return accounts.filter(
		(account) => normalizeCurrencyCode(account.currency) === normalizedCurrency
	);
}

export function getZakatGoldItemsForCurrency(items: GoldItem[], currency: string): GoldItem[] {
	const normalizedCurrency = normalizeCurrencyCode(currency);
	return items.filter((item) => normalizeCurrencyCode(item.currency) === normalizedCurrency);
}

export function getZakatGoldGrams(items: GoldItem[]): number {
	return items.reduce((sum, item) => sum + item.weight, 0);
}

/**
 * The accounts a year is assessed on.
 *
 * A stored selection — including an empty one — is the owner's own answer and always
 * wins. Only a year he has never touched falls back to pre-selecting the open asset
 * accounts, which is a convenience, not a decision. Ids of accounts that no longer exist
 * are dropped so a deleted account cannot haunt a year.
 */
export function resolveZakatAccountSelection({
	storedAccountIds,
	currencyAccounts,
}: {
	storedAccountIds?: readonly string[];
	currencyAccounts: Account[];
}): Set<string> {
	if (storedAccountIds) {
		const known = new Set(currencyAccounts.map((account) => account.id));
		return new Set(storedAccountIds.filter((id) => known.has(id)));
	}

	return new Set(
		currencyAccounts
			.filter((account) => account.accountType !== "liability" && !account.isArchived)
			.map((account) => account.id)
	);
}

/**
 * The accounts that actually count: selected AND, for a closed one, only while the year
 * counts closed accounts.
 *
 * The "show closed accounts" toggle is an INCLUSION filter, not a view preference. With
 * it off an archived account is excluded from the grid, the monthly totals, MINIMUM,
 * MAXIMUM, the assessment and the export alike — hiding it must never leave it quietly
 * inflating a figure the owner can no longer see. The stored selection underneath is
 * kept, so switching the toggle back on restores the account as selected.
 */
export function getZakatCountedAccountIds({
	selectedAccountIds,
	currencyAccounts,
	showArchivedAccounts,
}: {
	selectedAccountIds: Set<string>;
	currencyAccounts: Account[];
	showArchivedAccounts: boolean;
}): Set<string> {
	if (showArchivedAccounts) return new Set(selectedAccountIds);

	const archived = new Set(
		currencyAccounts.filter((account) => account.isArchived).map((account) => account.id)
	);
	return new Set([...selectedAccountIds].filter((id) => !archived.has(id)));
}

/** The raw tables a year's assessment is derived from, straight out of Dexie. */
export interface ZakatYearAssessmentSource {
	userId: string;
	referenceCurrency: string;
	/** Every account, archived included: a closed account still held wealth back then. */
	accounts: Account[];
	transactions: Transaction[];
	/** The shared, current holding. Only a year with no holding of its own reads it. */
	goldItems: GoldItem[];
	goldYears: ZakatGoldYear[];
	/** The pieces recorded against each zakat year, across every year and currency. */
	goldYearItems?: ZakatGoldYearItem[];
	yearOverrides: ZakatYearOverride[];
	payments: ZakatPayment[];
}

/**
 * The same data with the per-year lookups built once.
 *
 * History may list a decade of snapshots, so the maps are derived from the tables once
 * and every year reads them, rather than each row re-deriving them for itself.
 */
export interface ZakatYearAssessmentContext {
	userId: string;
	referenceCurrency: string;
	accounts: Account[];
	transactions: Transaction[];
	/** The accounts denominated in `referenceCurrency`; currencies are never combined. */
	currencyAccounts: Account[];
	goldItems: GoldItem[];
	goldYears: Map<number, ZakatGoldYear>;
	/** The pieces each year was held on, keyed by Islamic year. Sold pieces are gone. */
	goldYearItems: Map<number, ZakatGoldYearItem[]>;
	/** The same pieces as RECORDED, sold ones included, so the screen can show them. */
	goldYearItemLedger: Map<number, ZakatGoldYearItem[]>;
	/** The year each piece was sold in — the first year that stops counting it. */
	soldGoldLineages: Map<string, number>;
	ramadanStarts: Map<number, Date>;
	accountSelections: Map<number, string[]>;
	showArchivedByYear: Map<number, boolean>;
	pastRemainingOverrides: Map<number, number>;
	payments: ZakatPayment[];
}

export interface ZakatYearAssessmentOptions {
	/** Defaults to MINIMUM, as every sheet in the workbook does. */
	basis?: ZakatBasis;
	ratePercent?: number;
	/** Left at zero so a year's own figures stay independent of the chain. */
	pastRemaining?: number;
	/** An already-resolved definition, when the caller has one. */
	definition?: ZakatYearDefinition;
}

export interface ZakatYearAssessment {
	islamicYear: number;
	definition: ZakatYearDefinition;
	grid: ZakatYearGrid;
	input: ZakatAssessmentInput;
	assessment: ZakatAssessment;
	/** The accounts this year was actually assessed on, after the closed-accounts rule. */
	countedAccountIds: Set<string>;
	goldGramsByPurity: Map<GoldPurity, number>;
	/** The pieces recorded for this year, empty when the year records none. */
	goldItems: ZakatGoldYearItem[];
	goldPricesByPurity: Partial<Record<GoldPurity, number>>;
	goldPriceDate: Date;
	totalGoldWeightGrams: number;
}

/** Builds the per-year lookups once, for however many years are about to be assessed. */
export function prepareZakatYearAssessmentContext(
	source: ZakatYearAssessmentSource
): ZakatYearAssessmentContext {
	const { referenceCurrency } = source;
	const normalizedCurrency = normalizeCurrencyCode(referenceCurrency);
	const liveOverrides = source.yearOverrides.filter((override) => !override.deletedAt);

	return {
		userId: source.userId,
		referenceCurrency,
		accounts: source.accounts,
		transactions: source.transactions,
		currencyAccounts: getZakatAccountsForCurrency(source.accounts, referenceCurrency),
		goldItems: getZakatGoldItemsForCurrency(source.goldItems, referenceCurrency),
		goldYears: toZakatGoldYearMap(source.goldYears, referenceCurrency),
		goldYearItems: toZakatGoldYearItemMap(source.goldYearItems ?? [], referenceCurrency),
		goldYearItemLedger: toZakatGoldYearItemLedger(source.goldYearItems ?? [], referenceCurrency),
		soldGoldLineages: buildZakatGoldSoldLineages(source.goldYearItems ?? [], referenceCurrency),
		ramadanStarts: toRamadanStartMap(liveOverrides),
		accountSelections: toZakatAccountSelectionMap(liveOverrides),
		showArchivedByYear: toZakatShowArchivedAccountsMap(liveOverrides),
		pastRemainingOverrides: toPastRemainingOverrideMap(liveOverrides),
		payments: source.payments.filter(
			(payment) =>
				!payment.deletedAt && normalizeCurrencyCode(payment.currency) === normalizedCurrency
		),
	};
}

/**
 * Every year the carry-forward chain needs to settle one year, oldest first.
 *
 * The window starts at the earliest year the app exposes and is capped, so resolving a
 * year can never turn into an unbounded walk back through history.
 */
export function getZakatCarryForwardYearRange(
	throughIslamicYear: number,
	options: { earliestIslamicYear?: number; maxLookBackYears?: number } = {}
): number[] {
	const {
		earliestIslamicYear = ZAKAT_EARLIEST_ISLAMIC_YEAR,
		maxLookBackYears = ZAKAT_CARRY_FORWARD_MAX_LOOKBACK_YEARS,
	} = options;
	if (!Number.isFinite(throughIslamicYear)) return [];

	const years: number[] = [];
	const firstIslamicYear = Math.max(earliestIslamicYear, throughIslamicYear - maxLookBackYears);
	for (let year = firstIslamicYear; year <= throughIslamicYear; year += 1) years.push(year);
	return years;
}

/**
 * Assesses ONE zakat year on its own accounts, its own closed-accounts rule, its own
 * grams and its own price per gram.
 *
 * Nothing is carried in unless the caller asks for it: a year's own zakat is what the
 * carry-forward chain is built from, so deriving it here with a balance already carried
 * would count the carried figure twice.
 */
export function buildZakatYearAssessment(
	context: ZakatYearAssessmentContext,
	islamicYear: number,
	options: ZakatYearAssessmentOptions = {}
): ZakatYearAssessment {
	const {
		basis = "minimum",
		ratePercent = DEFAULT_ZAKAT_RATE_PERCENT,
		pastRemaining = 0,
	} = options;
	const definition =
		options.definition ??
		getZakatYearDefinitionByIslamicYear(islamicYear, { ramadanStarts: context.ramadanStarts });

	const countedAccountIds = getZakatCountedAccountIds({
		selectedAccountIds: resolveZakatAccountSelection({
			storedAccountIds: context.accountSelections.get(islamicYear),
			currencyAccounts: context.currencyAccounts,
		}),
		currencyAccounts: context.currencyAccounts,
		showArchivedAccounts:
			context.showArchivedByYear.get(islamicYear) ?? ZAKAT_SHOW_ARCHIVED_ACCOUNTS_DEFAULT,
	});

	const grid = computeZakatYearGrid({
		userId: context.userId,
		accounts: context.accounts,
		transactions: context.transactions,
		selectedAccountIds: countedAccountIds,
		sheetYear: definition.sheetYear,
		yearDefinition: definition,
	});

	// Each year is valued at ITS OWN price per gram, on the pieces IT held. A year the
	// owner never priced contributes no gold value rather than borrowing another year's
	// price, and a year with no holding of its own borrows no other year's gold.
	const goldYear = context.goldYears.get(islamicYear);
	const goldGramsByPurity = resolveZakatGoldGramsForYear({
		islamicYear,
		record: goldYear,
		itemsByYear: context.goldYearItems,
		inventoryItems: context.goldItems,
	});
	const goldPricesByPurity = getZakatGoldYearPrices(goldYear);
	// The sheet prices gold at 1 Ramaḍān, so that is what an unpriced year falls back to.
	const goldPriceDate =
		goldYear?.priceDate !== undefined
			? new Date(goldYear.priceDate)
			: definition.months[0]!.startDate;

	const input: ZakatAssessmentInput = {
		monthlyTotals: grid.monthlyTotals,
		basis,
		goldItems: toZakatGoldItems(goldGramsByPurity),
		goldPrices: {
			priceDate: format(goldPriceDate, "yyyy-MM-dd"),
			pricesByPurity: goldPricesByPurity,
		},
		ratePercent,
		pastRemaining,
		payments: context.payments.filter((payment) => payment.islamicYear === definition.zakatYear),
	};

	return {
		islamicYear,
		definition,
		grid,
		input,
		assessment: calculateZakatAssessment(input),
		countedAccountIds,
		goldGramsByPurity,
		goldItems: getZakatGoldYearItems(context.goldYearItems, islamicYear),
		goldPricesByPurity,
		goldPriceDate,
		totalGoldWeightGrams: sumZakatGoldGrams(goldGramsByPurity),
	};
}

/**
 * Assesses a set of years off one prepared context.
 *
 * `optionsFor` lets the caller single a year out — the calculator applies the owner's
 * chosen basis and rate to the year on screen only, because decision 2 says a deliberate
 * switch belongs to the year it was made on and is never carried into another.
 */
export function buildZakatYearAssessments(
	context: ZakatYearAssessmentContext,
	islamicYears: Iterable<number>,
	optionsFor?: (islamicYear: number) => ZakatYearAssessmentOptions
): Map<number, ZakatYearAssessment> {
	const byYear = new Map<number, ZakatYearAssessment>();
	for (const islamicYear of islamicYears) {
		if (byYear.has(islamicYear)) continue;
		byYear.set(
			islamicYear,
			buildZakatYearAssessment(context, islamicYear, optionsFor?.(islamicYear))
		);
	}
	return byYear;
}
