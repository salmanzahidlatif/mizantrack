import { endOfDay, format } from "date-fns";

import { computeAccountBalances, normalizeCurrencyCode } from "@/lib/analytics/balanceMath";

import { ISLAMIC_MONTHS, type Account, type GoldItem, type GoldPurity, type Transaction } from "@/types";

export type ZakatBasis = "minimum" | "maximum";

export interface ZakatMonthDefinition {
	month: (typeof ISLAMIC_MONTHS)[number];
	islamicYear: number;
	startDate: Date;
	endDate: Date;
}

export interface ZakatYearDefinition {
	sheetYear: number;
	zakatYear: string;
	label: string;
	months: ZakatMonthDefinition[];
}

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

const YEAR_SPECS: Array<{
	sheetYear: number;
	startIslamicYear: number;
	starts: string[];
	ends: string[];
}> = [
	{
		sheetYear: 2020,
		startIslamicYear: 1440,
		starts: [
			"2019-05-07",
			"2019-06-05",
			"2019-07-05",
			"2019-08-03",
			"2019-09-01",
			"2019-10-01",
			"2019-10-30",
			"2019-11-29",
			"2019-12-28",
			"2020-01-27",
			"2020-02-26",
			"2020-03-26",
		],
		ends: [
			"2019-06-04",
			"2019-07-04",
			"2019-08-02",
			"2019-08-31",
			"2019-09-30",
			"2019-10-29",
			"2019-11-28",
			"2019-12-27",
			"2020-01-26",
			"2020-02-25",
			"2020-03-25",
			"2020-04-24",
		],
	},
	{
		sheetYear: 2021,
		startIslamicYear: 1441,
		starts: [
			"2020-04-25",
			"2020-05-25",
			"2020-06-23",
			"2020-07-23",
			"2020-08-21",
			"2020-09-19",
			"2020-10-19",
			"2020-11-17",
			"2020-12-17",
			"2021-01-15",
			"2021-02-14",
			"2021-03-15",
		],
		ends: [
			"2020-05-24",
			"2020-06-22",
			"2020-07-22",
			"2020-08-20",
			"2020-09-18",
			"2020-10-18",
			"2020-11-16",
			"2020-12-16",
			"2021-01-14",
			"2021-02-13",
			"2021-03-14",
			"2021-04-13",
		],
	},
	{
		sheetYear: 2022,
		startIslamicYear: 1442,
		starts: [
			"2021-04-14",
			"2021-05-14",
			"2021-06-12",
			"2021-07-12",
			"2021-08-10",
			"2021-09-09",
			"2021-10-08",
			"2021-11-07",
			"2021-12-06",
			"2022-01-05",
			"2022-02-03",
			"2022-03-05",
		],
		ends: [
			"2021-05-13",
			"2021-06-11",
			"2021-07-11",
			"2021-08-09",
			"2021-09-08",
			"2021-10-07",
			"2021-11-06",
			"2021-12-05",
			"2022-01-04",
			"2022-02-02",
			"2022-03-04",
			"2022-04-02",
		],
	},
	{
		sheetYear: 2023,
		startIslamicYear: 1443,
		starts: [
			"2022-04-03",
			"2022-05-03",
			"2022-06-01",
			"2022-07-01",
			"2022-07-31",
			"2022-08-29",
			"2022-09-28",
			"2022-10-27",
			"2022-11-26",
			"2022-12-26",
			"2023-01-24",
			"2023-02-22",
		],
		ends: [
			"2022-05-02",
			"2022-05-31",
			"2022-06-30",
			"2022-07-30",
			"2022-08-28",
			"2022-09-27",
			"2022-10-26",
			"2022-11-25",
			"2022-12-25",
			"2023-01-23",
			"2023-02-21",
			"2023-03-23",
		],
	},
	{
		sheetYear: 2024,
		startIslamicYear: 1444,
		starts: [
			"2023-03-24",
			"2023-04-22",
			"2023-05-22",
			"2023-06-20",
			"2023-07-20",
			"2023-08-18",
			"2023-09-17",
			"2023-10-17",
			"2023-11-16",
			"2023-12-15",
			"2024-01-14",
			"2024-02-12",
		],
		ends: [
			"2023-04-21",
			"2023-05-21",
			"2023-06-19",
			"2023-07-19",
			"2023-08-17",
			"2023-09-16",
			"2023-10-16",
			"2023-11-15",
			"2023-12-14",
			"2024-01-13",
			"2024-02-11",
			"2024-03-11",
		],
	},
	{
		sheetYear: 2025,
		startIslamicYear: 1445,
		starts: [
			"2024-03-12",
			"2024-04-11",
			"2024-05-10",
			"2024-06-09",
			"2024-07-08",
			"2024-08-07",
			"2024-09-05",
			"2024-10-05",
			"2024-11-03",
			"2024-12-03",
			"2025-01-01",
			"2025-01-31",
		],
		ends: [
			"2024-04-10",
			"2024-05-09",
			"2024-06-08",
			"2024-07-07",
			"2024-08-06",
			"2024-09-04",
			"2024-10-04",
			"2024-11-02",
			"2024-12-02",
			"2024-12-31",
			"2025-01-30",
			"2025-02-28",
		],
	},
	{
		sheetYear: 2026,
		startIslamicYear: 1446,
		starts: [
			"2025-03-01",
			"2025-03-31",
			"2025-04-29",
			"2025-05-29",
			"2025-06-27",
			"2025-07-27",
			"2025-08-25",
			"2025-09-24",
			"2025-10-23",
			"2025-11-22",
			"2025-12-21",
			"2026-01-20",
		],
		ends: [
			"2025-03-30",
			"2025-04-28",
			"2025-05-28",
			"2025-06-26",
			"2025-07-26",
			"2025-08-24",
			"2025-09-23",
			"2025-10-22",
			"2025-11-21",
			"2025-12-20",
			"2026-01-19",
			"2026-02-17",
		],
	},
];

function localDate(isoDate: string): Date {
	const [year, month, day] = isoDate.split("-").map(Number);
	return new Date(year!, month! - 1, day!);
}

export const ZAKAT_YEAR_DEFINITIONS: ZakatYearDefinition[] = YEAR_SPECS.map((spec) => {
	const endIslamicYear = spec.startIslamicYear + 1;
	const months = ISLAMIC_MONTHS.map((month, index) => ({
		month,
		islamicYear: index < 4 ? spec.startIslamicYear : endIslamicYear,
		startDate: localDate(spec.starts[index]!),
		endDate: localDate(spec.ends[index]!),
	}));

	return {
		sheetYear: spec.sheetYear,
		zakatYear: `${spec.startIslamicYear}-${endIslamicYear}`,
		label: `${spec.sheetYear} (${spec.startIslamicYear}–${endIslamicYear})`,
		months,
	};
});

export function getZakatYearDefinition(sheetYear: number): ZakatYearDefinition {
	const definition = ZAKAT_YEAR_DEFINITIONS.find((year) => year.sheetYear === sheetYear);
	if (!definition) {
		throw new Error(`Unsupported zakat sheet year: ${sheetYear}`);
	}
	return definition;
}

export function getDefaultZakatSheetYear(date = new Date()): number {
	const at = date.getTime();
	const matching = ZAKAT_YEAR_DEFINITIONS.find(
		(year) =>
			at >= year.months[0]!.startDate.getTime() &&
			at <= endOfDay(year.months[11]!.endDate).getTime()
	);
	return matching?.sheetYear ?? ZAKAT_YEAR_DEFINITIONS.at(-1)!.sheetYear;
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
}: {
	userId: string;
	accounts: Account[];
	transactions: Transaction[];
	selectedAccountIds: Set<string>;
	sheetYear: number;
}): ZakatYearGrid {
	const year = getZakatYearDefinition(sheetYear);
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

	const monthlyTotals = year.months.map((month) => {
		const computed = computeAccountBalances(userId, accounts, transactions, {
			asOfMs: endOfDay(month.endDate).getTime(),
		}).balances;

		let total = 0;
		for (const account of selectedAccounts) {
			const balance = normalizeZakatAccountBalance(account, computed.get(account.id) ?? 0);
			accountRows.get(account.id)?.balances.push(balance);
			total += balance;
		}
		return total;
	});

	return {
		year,
		accounts: Array.from(accountRows.values()),
		monthlyTotals,
		minimum: monthlyTotals.length > 0 ? Math.min(...monthlyTotals) : 0,
		maximum: monthlyTotals.length > 0 ? Math.max(...monthlyTotals) : 0,
	};
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
	const minimum = monthlyTotals.length > 0 ? Math.min(...monthlyTotals) : 0;
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
