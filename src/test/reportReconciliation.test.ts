/**
 * Reconciliation against the user's hand-kept tax-return spreadsheets.
 *
 * Ground truth is the user's own workbook for fiscal years 2023 - 2024 and 2024 - 2025.
 * This suite ONLY proves that aggregating the user's saved rows reproduces the totals they
 * already typed by hand. Nothing here computes tax: no rates, no slabs, no liability, no
 * "taxable income". Every expected figure below is copied verbatim from the spreadsheets.
 */
import { describe, expect, it } from "vitest";

import { resolveAnalyticsPeriod } from "@/lib/dateRange";
import { buildFiscalReport } from "@/lib/reports/reportEngine";
import { listFiscalYearOptions } from "@/lib/reports/reportFiscalYears";

import type {
	Account,
	FiscalReportSummary,
	ReportAccountTag,
	ReportManualEntry,
	ReportProject,
	ReportTransactionTag,
	Transaction,
} from "@/types";

const USER_ID = "reconciliation-user";
const UTC_OFFSET_MINUTES = 0;
const FISCAL_YEAR_START_MONTH = 7; // July

// ─── Fiscal-year ranges (derived, never hand-typed) ──────────────────────────

const FY_2324 = resolveAnalyticsPeriod({
	interval: "yearly",
	anchorDate: new Date(Date.UTC(2023, 11, 31)),
	fiscalYearStartMonth: FISCAL_YEAR_START_MONTH,
	timeZoneOffsetMinutes: UTC_OFFSET_MINUTES,
});

const FY_2425 = resolveAnalyticsPeriod({
	interval: "yearly",
	anchorDate: new Date(Date.UTC(2024, 11, 31)),
	fiscalYearStartMonth: FISCAL_YEAR_START_MONTH,
	timeZoneOffsetMinutes: UTC_OFFSET_MINUTES,
});

const FY_2324_LABEL = "2023 - 2024";
const FY_2425_LABEL = "2024 - 2025";

// ─── Accounts ────────────────────────────────────────────────────────────────

function makeAccount(overrides: Partial<Account> & Pick<Account, "id" | "title">): Account {
	return {
		userId: USER_ID,
		openingBalance: 0,
		currency: "PKR",
		isArchived: false,
		updatedAt: 0,
		...overrides,
	};
}

/** Wise settles in PKR, so remittance rows carry the PKR amount the user's sheet records. */
const REMITTANCE_SOURCE = makeAccount({
	id: "wise-pkr",
	title: "Wise PKR Settlement",
});

const MEEZAN_INVESTMENTS = makeAccount({
	id: "meezan-investments",
	title: "Al Meezan Investments 233509-1",
	openingBalance: 2_000_000,
});

const SAVINGS_ACCOUNT = makeAccount({
	id: "savings-08280103938868",
	title: "Savings Account 08280103938868",
	openingBalance: 2_237_249,
});

const DEFAULT_ACCOUNT = makeAccount({
	id: "default-08280103228090",
	title: "Default Account 08280103228090",
	openingBalance: 1_044.17,
});

const PROPERTY_ACCOUNT = makeAccount({
	id: "property-holdings",
	title: "Property Holdings",
});

const ACCOUNTS: Account[] = [
	REMITTANCE_SOURCE,
	MEEZAN_INVESTMENTS,
	SAVINGS_ACCOUNT,
	DEFAULT_ACCOUNT,
	PROPERTY_ACCOUNT,
];

const ACCOUNT_TAGS: ReportAccountTag[] = [
	{
		id: "account-tag-wise",
		userId: USER_ID,
		accountId: REMITTANCE_SOURCE.id,
		includeInReport: false,
		isRemittanceSource: true,
		updatedAt: 0,
	},
	{
		id: "account-tag-meezan",
		userId: USER_ID,
		accountId: MEEZAN_INVESTMENTS.id,
		includeInReport: true,
		updatedAt: 0,
	},
	{
		id: "account-tag-savings",
		userId: USER_ID,
		accountId: SAVINGS_ACCOUNT.id,
		includeInReport: true,
		updatedAt: 0,
	},
	{
		id: "account-tag-default",
		userId: USER_ID,
		accountId: DEFAULT_ACCOUNT.id,
		includeInReport: true,
		updatedAt: 0,
	},
];

// ─── Projects ────────────────────────────────────────────────────────────────

function makeProject(id: string, title: string, sortOrder: number): ReportProject {
	return { id, userId: USER_ID, title, sortOrder, updatedAt: 0 };
}

const AWAMI = makeProject("awami", "BWC 3.5 Marla Awami Block", 1);
const OVERSEAS = makeProject("overseas", "BWC 7 Marla Overseas Block", 2);
const WATERFRONT = makeProject("waterfront", "BWC 18 Marla Waterfront Block", 3);
const NMC_GUJAR_KHAN = makeProject("nmc-gujar-khan", "New Metro City Gujar Khan 10 Marla", 4);
const NMC_A_SOUTH = makeProject("nmc-a-south", "New Metro City A South Block", 5);
const LAKESHORE = makeProject("lakeshore", "Lakeshore 10 marla", 6);

const PROJECTS: ReportProject[] = [
	AWAMI,
	OVERSEAS,
	WATERFRONT,
	NMC_GUJAR_KHAN,
	NMC_A_SOUTH,
	LAKESHORE,
];

// ─── Ledger ──────────────────────────────────────────────────────────────────

interface RemittanceRow {
	id: string;
	date: number;
	amount: number;
}

interface PlotPaymentRow {
	id: string;
	date: number;
	amount: number;
	projectId: string;
}

/** 1 Jul 2023 00:00:00.000 — the first millisecond of fiscal year 2023 - 2024. */
const FY_2324_FIRST_MS = Date.UTC(2023, 6, 1, 0, 0, 0, 0);
/** 30 Jun 2024 23:59:59.999 — the last millisecond of fiscal year 2023 - 2024. */
const FY_2324_LAST_MS = Date.UTC(2024, 5, 30, 23, 59, 59, 999);
/** 1 Jul 2024 00:00:00.000 — the first millisecond of fiscal year 2024 - 2025. */
const FY_2425_FIRST_MS = Date.UTC(2024, 6, 1, 0, 0, 0, 0);
/** 30 Jun 2025 23:59:59.999 — the last millisecond of fiscal year 2024 - 2025. */
const FY_2425_LAST_MS = Date.UTC(2025, 5, 30, 23, 59, 59, 999);
/** 30 Jun 2023 23:59:59.999 — one millisecond BEFORE fiscal year 2023 - 2024 opens. */
const BEFORE_FY_2324_MS = FY_2324_FIRST_MS - 1;
/** 1 Jul 2025 00:00:00.000 — one millisecond AFTER fiscal year 2024 - 2025 closes. */
const AFTER_FY_2425_MS = FY_2425_LAST_MS + 1;

const REMITTANCES_2324: RemittanceRow[] = [
	{ id: "remit-2324-1", date: Date.UTC(2023, 7, 15), amount: 319_440 },
	{ id: "remit-2324-2", date: Date.UTC(2024, 3, 1), amount: 500_000 },
	{ id: "remit-2324-3", date: Date.UTC(2024, 3, 27), amount: 400_000 },
	{ id: "remit-2324-4", date: Date.UTC(2024, 4, 7), amount: 400_000 },
	{ id: "remit-2324-5", date: Date.UTC(2024, 4, 8), amount: 500_000 },
	{ id: "remit-2324-6", date: Date.UTC(2024, 4, 14), amount: 500_000 },
];

const REMITTANCES_2425: RemittanceRow[] = [
	{ id: "remit-2425-1", date: Date.UTC(2024, 6, 12), amount: 377_000 },
	{ id: "remit-2425-2", date: Date.UTC(2024, 8, 20), amount: 300_000 },
	{ id: "remit-2425-3", date: Date.UTC(2024, 10, 5), amount: 341_168 },
	{ id: "remit-2425-4", date: Date.UTC(2025, 0, 10), amount: 489_000 },
	{ id: "remit-2425-5", date: Date.UTC(2025, 1, 14), amount: 493_546 },
	{ id: "remit-2425-6", date: Date.UTC(2025, 3, 3), amount: 45_700 },
	{ id: "remit-2425-7", date: Date.UTC(2025, 4, 18), amount: 20_000 },
	{ id: "remit-2425-8", date: Date.UTC(2025, 5, 25), amount: 200_000 },
];

const PLOT_PAYMENTS: PlotPaymentRow[] = [
	// ── Fiscal year 2022 - 2023: one millisecond before 2023 - 2024 opens.
	{ id: "plot-2223-overseas-1", date: BEFORE_FY_2324_MS, amount: 9_999, projectId: OVERSEAS.id },

	// ── Fiscal year 2023 - 2024.
	{ id: "plot-2324-awami-1", date: Date.UTC(2023, 7, 26), amount: 50_000, projectId: AWAMI.id },
	{ id: "plot-2324-awami-2", date: Date.UTC(2024, 1, 2), amount: 21_000, projectId: AWAMI.id },
	{ id: "plot-2324-awami-3", date: Date.UTC(2024, 3, 17), amount: 7_000, projectId: AWAMI.id },
	{ id: "plot-2324-overseas-1", date: FY_2324_FIRST_MS, amount: 62_314, projectId: OVERSEAS.id },
	{
		id: "plot-2324-overseas-2",
		date: Date.UTC(2023, 8, 15),
		amount: 14_500,
		projectId: OVERSEAS.id,
	},
	{
		id: "plot-2324-overseas-3",
		date: Date.UTC(2023, 11, 15),
		amount: 14_500,
		projectId: OVERSEAS.id,
	},
	{
		id: "plot-2324-overseas-4",
		date: Date.UTC(2024, 2, 15),
		amount: 14_500,
		projectId: OVERSEAS.id,
	},
	{
		id: "plot-2324-overseas-5",
		date: Date.UTC(2024, 5, 15),
		amount: 14_500,
		projectId: OVERSEAS.id,
	},
	{
		id: "plot-2324-waterfront-1",
		date: Date.UTC(2023, 10, 15),
		amount: 338_250,
		projectId: WATERFRONT.id,
	},
	{
		id: "plot-2324-waterfront-2",
		date: Date.UTC(2024, 0, 13),
		amount: 402_000,
		projectId: WATERFRONT.id,
	},
	{
		id: "plot-2324-waterfront-3",
		date: FY_2324_LAST_MS,
		amount: 44_250,
		projectId: WATERFRONT.id,
	},
	{
		id: "plot-2324-nmc-1",
		date: Date.UTC(2023, 6, 10),
		amount: 452_312,
		projectId: NMC_GUJAR_KHAN.id,
	},
	{
		id: "plot-2324-nmc-2",
		date: Date.UTC(2023, 7, 10),
		amount: 50_940,
		projectId: NMC_GUJAR_KHAN.id,
	},
	{
		id: "plot-2324-nmc-3",
		date: Date.UTC(2023, 9, 10),
		amount: 100_000,
		projectId: NMC_GUJAR_KHAN.id,
	},
	{
		id: "plot-2324-nmc-4",
		date: Date.UTC(2023, 11, 10),
		amount: 100_000,
		projectId: NMC_GUJAR_KHAN.id,
	},
	{
		id: "plot-2324-nmc-5",
		date: Date.UTC(2024, 1, 20),
		amount: 1_000_000,
		projectId: NMC_GUJAR_KHAN.id,
	},
	{
		id: "plot-2324-nmc-6",
		date: Date.UTC(2024, 4, 20),
		amount: 300_000,
		projectId: NMC_GUJAR_KHAN.id,
	},
	{
		id: "plot-2324-lakeshore-1",
		date: Date.UTC(2024, 3, 25),
		amount: 45_000,
		projectId: LAKESHORE.id,
	},
	{
		id: "plot-2324-lakeshore-2",
		date: Date.UTC(2024, 5, 20),
		amount: 45_000,
		projectId: LAKESHORE.id,
	},

	// ── Fiscal year 2024 - 2025.
	// The user's 2023 - 2024 sheet lists this 27,500 Awami instalment, but the payment is
	// dated 05/08/2024, which is fiscal year 2024 - 2025. See the reconciliation-break block.
	{ id: "plot-2425-awami-1", date: Date.UTC(2024, 7, 5), amount: 27_500, projectId: AWAMI.id },
	{ id: "plot-2425-awami-2", date: Date.UTC(2024, 8, 10), amount: 31_250, projectId: AWAMI.id },
	{ id: "plot-2425-awami-3", date: Date.UTC(2025, 2, 10), amount: 31_250, projectId: AWAMI.id },
	{
		id: "plot-2425-overseas-1",
		date: Date.UTC(2024, 7, 20),
		amount: 500_000,
		projectId: OVERSEAS.id,
	},
	{
		id: "plot-2425-overseas-2",
		date: Date.UTC(2024, 10, 15),
		amount: 300_000,
		projectId: OVERSEAS.id,
	},
	{
		id: "plot-2425-overseas-3",
		date: Date.UTC(2025, 1, 18),
		amount: 171_126,
		projectId: OVERSEAS.id,
	},
	{
		id: "plot-2425-waterfront-1",
		date: Date.UTC(2024, 8, 5),
		amount: 500_000,
		projectId: WATERFRONT.id,
	},
	{
		id: "plot-2425-waterfront-2",
		date: Date.UTC(2024, 11, 12),
		amount: 400_000,
		projectId: WATERFRONT.id,
	},
	{
		id: "plot-2425-waterfront-3",
		date: Date.UTC(2025, 2, 20),
		amount: 100_000,
		projectId: WATERFRONT.id,
	},
	{
		id: "plot-2425-waterfront-4",
		date: FY_2425_LAST_MS,
		amount: 72_250,
		projectId: WATERFRONT.id,
	},
	{
		id: "plot-2425-lakeshore-1",
		date: FY_2425_FIRST_MS,
		amount: 180_000,
		projectId: LAKESHORE.id,
	},
	{
		id: "plot-2425-lakeshore-2",
		date: Date.UTC(2025, 0, 15),
		amount: 360_000,
		projectId: LAKESHORE.id,
	},

	// ── Fiscal year 2025 - 2026: one millisecond after 2024 - 2025 closes.
	{ id: "plot-2526-lakeshore-1", date: AFTER_FY_2425_MS, amount: 123_456, projectId: LAKESHORE.id },
];

function makeRemittanceTransaction(row: RemittanceRow): Transaction {
	return {
		id: row.id,
		userId: USER_ID,
		type: "Transfer",
		date: row.date,
		amount: row.amount,
		description: "Remittance to Pakistan",
		accountId: REMITTANCE_SOURCE.id,
		toAccountId: SAVINGS_ACCOUNT.id,
		updatedAt: 0,
	};
}

function makePlotTransaction(row: PlotPaymentRow): Transaction {
	return {
		id: row.id,
		userId: USER_ID,
		type: "Transfer",
		date: row.date,
		amount: row.amount,
		description: "Plot instalment",
		accountId: SAVINGS_ACCOUNT.id,
		toAccountId: PROPERTY_ACCOUNT.id,
		updatedAt: 0,
	};
}

/** Untagged everyday rows: they move balances but never enter a report section. */
const UNTAGGED_TRANSACTIONS: Transaction[] = [
	{
		id: "meezan-profit-payout",
		userId: USER_ID,
		type: "Income",
		date: Date.UTC(2024, 9, 31),
		amount: 500_000,
		description: "Al Meezan profit payout",
		accountId: MEEZAN_INVESTMENTS.id,
		updatedAt: 0,
	},
	{
		id: "meezan-top-up",
		userId: USER_ID,
		type: "Transfer",
		date: Date.UTC(2025, 2, 3),
		amount: 226_363,
		description: "Top-up to Al Meezan",
		accountId: SAVINGS_ACCOUNT.id,
		toAccountId: MEEZAN_INVESTMENTS.id,
		updatedAt: 0,
	},
	{
		id: "savings-bank-charges",
		userId: USER_ID,
		type: "Expense",
		date: Date.UTC(2025, 4, 2),
		amount: 1_234.15,
		description: "Bank charges",
		accountId: SAVINGS_ACCOUNT.id,
		updatedAt: 0,
	},
	{
		id: "default-utility-debit",
		userId: USER_ID,
		type: "Expense",
		date: Date.UTC(2025, 3, 9),
		amount: 1_000,
		description: "Utility debit",
		accountId: DEFAULT_ACCOUNT.id,
		updatedAt: 0,
	},
	{
		id: "savings-after-cutoff-income",
		userId: USER_ID,
		type: "Income",
		date: Date.UTC(2025, 6, 2),
		amount: 750_000,
		description: "Received after the fiscal year closed",
		accountId: SAVINGS_ACCOUNT.id,
		updatedAt: 0,
	},
];

const TRANSACTIONS: Transaction[] = [
	...REMITTANCES_2324.map(makeRemittanceTransaction),
	...REMITTANCES_2425.map(makeRemittanceTransaction),
	...PLOT_PAYMENTS.map(makePlotTransaction),
	...UNTAGGED_TRANSACTIONS,
];

const TRANSACTION_TAGS: ReportTransactionTag[] = [
	...[...REMITTANCES_2324, ...REMITTANCES_2425].map<ReportTransactionTag>((row) => ({
		id: `tag-${row.id}`,
		userId: USER_ID,
		transactionId: row.id,
		role: "remittance",
		confirmed: true,
		updatedAt: 0,
	})),
	...PLOT_PAYMENTS.map<ReportTransactionTag>((row) => ({
		id: `tag-${row.id}`,
		userId: USER_ID,
		transactionId: row.id,
		role: "plot-payment",
		projectId: row.projectId,
		confirmed: true,
		updatedAt: 0,
	})),
];

const MANUAL_ENTRIES: ReportManualEntry[] = [
	{
		id: "manual-nayatel-2324",
		userId: USER_ID,
		label: "Nayatel tax",
		amount: 4_020,
		currency: "PKR",
		section: "other",
		fiscalYearKey: FY_2324.key,
		updatedAt: 0,
	},
	{
		id: "manual-nayatel-2425",
		userId: USER_ID,
		label: "Nayatel tax",
		amount: 4_285,
		currency: "PKR",
		section: "other",
		fiscalYearKey: FY_2425.key,
		updatedAt: 0,
	},
];

function buildReportFor(period: typeof FY_2324, label: string): FiscalReportSummary {
	return buildFiscalReport({
		userId: USER_ID,
		fromMs: period.fromMs,
		toMs: period.toMs,
		rangeKey: period.key,
		rangeLabel: label,
		accounts: ACCOUNTS,
		transactions: TRANSACTIONS,
		accountTags: ACCOUNT_TAGS,
		projects: PROJECTS,
		transactionTags: TRANSACTION_TAGS,
		manualEntries: MANUAL_ENTRIES,
		monthlySalaryRows: [],
	});
}

const report2324 = buildReportFor(FY_2324, FY_2324_LABEL);
const report2425 = buildReportFor(FY_2425, FY_2425_LABEL);

function projectTotal(report: FiscalReportSummary, projectId: string): number | undefined {
	return report.projectGroups.find((group) => group.project.id === projectId)?.total;
}

// ─── Spreadsheet ground truth ────────────────────────────────────────────────

/** Copied verbatim from the user's workbook. */
const SHEET = {
	fy2324: {
		remittanceTotal: 2_619_440,
		projects: {
			awami: 105_500,
			overseas: 120_314,
			waterfront: 784_500,
			nmcGujarKhan: 2_003_252,
			lakeshore: 90_000,
		},
		projectGrandTotal: 3_103_566,
		nayatelTax: 4_020,
	},
	fy2425: {
		remittanceTotal: 2_266_414,
		projects: {
			awami: 62_500,
			overseas: 971_126,
			waterfront: 1_072_250,
			nmcASouth: 0,
			lakeshore: 540_000,
		},
		projectGrandTotal: 2_645_876,
		closingBalances: {
			meezanInvestments: 2_726_363,
			savings: 1_136_064.85,
			default: 44.17,
		},
		nayatelTax: 4_285,
	},
} as const;

/**
 * The single reconciliation break: the 27,500 Awami instalment the user wrote on the
 * 2023 - 2024 sheet is dated 05/08/2024, so the engine scopes it to 2024 - 2025.
 */
const AWAMI_FISCAL_YEAR_SHIFT = 27_500;

// ─── Fiscal-year ranges ──────────────────────────────────────────────────────

describe("Fiscal-year ranges match the user's 1 Jul → 30 Jun workbook", () => {
	it("resolves 2023 - 2024 and 2024 - 2025 to the exact millisecond", () => {
		expect(FY_2324.fromMs).toBe(FY_2324_FIRST_MS);
		expect(FY_2324.toMs).toBe(FY_2324_LAST_MS);
		expect(FY_2425.fromMs).toBe(FY_2425_FIRST_MS);
		expect(FY_2425.toMs).toBe(FY_2425_LAST_MS);
	});

	it("names both years the way the spreadsheets are named", () => {
		const options = listFiscalYearOptions({
			fiscalYearStartMonth: FISCAL_YEAR_START_MONTH,
			earliestTransactionMs: BEFORE_FY_2324_MS,
			now: new Date(Date.UTC(2025, 2, 15)),
			timeZoneOffsetMinutes: UTC_OFFSET_MINUTES,
		});

		expect(options.map((option) => option.label)).toEqual([
			FY_2425_LABEL,
			FY_2324_LABEL,
			"2022 - 2023",
		]);
		expect(options[0]?.key).toBe(FY_2425.key);
		expect(options[1]?.key).toBe(FY_2324.key);
	});
});

// ─── Remittances ─────────────────────────────────────────────────────────────

describe("Remittances reconcile with the spreadsheets", () => {
	it("reproduces the six 2023 - 2024 payments and their total", () => {
		expect(report2324.remittances).toHaveLength(6);
		expect(report2324.remittances.map((entry) => entry.amount)).toEqual([
			319_440, 500_000, 400_000, 400_000, 500_000, 500_000,
		]);
		expect(report2324.remittanceTotal).toBe(SHEET.fy2324.remittanceTotal);
		expect(report2324.remittances.every((entry) => entry.currency === "PKR")).toBe(true);
	});

	it("reproduces the eight 2024 - 2025 payments and their total", () => {
		expect(report2425.remittances).toHaveLength(8);
		expect(report2425.remittances.map((entry) => entry.amount)).toEqual([
			377_000, 300_000, 341_168, 489_000, 493_546, 45_700, 20_000, 200_000,
		]);
		expect(report2425.remittanceTotal).toBe(SHEET.fy2425.remittanceTotal);
	});

	it("keeps 2023 - 2024 remittances out of the 2024 - 2025 report", () => {
		const leaked = report2425.remittances.filter((entry) =>
			REMITTANCES_2324.some((row) => row.id === entry.transactionId)
		);

		expect(leaked).toEqual([]);
		expect(report2425.remittances.every((entry) => entry.date >= FY_2425_FIRST_MS)).toBe(true);
		expect(report2425.remittances.every((entry) => entry.date <= FY_2425_LAST_MS)).toBe(true);
	});
});

// ─── Plot payments ───────────────────────────────────────────────────────────

describe("Plot payments reconcile with the spreadsheets", () => {
	it("reproduces every 2023 - 2024 project total that is free of the dating break", () => {
		expect(projectTotal(report2324, OVERSEAS.id)).toBe(SHEET.fy2324.projects.overseas);
		expect(projectTotal(report2324, WATERFRONT.id)).toBe(SHEET.fy2324.projects.waterfront);
		expect(projectTotal(report2324, NMC_GUJAR_KHAN.id)).toBe(SHEET.fy2324.projects.nmcGujarKhan);
		expect(projectTotal(report2324, LAKESHORE.id)).toBe(SHEET.fy2324.projects.lakeshore);
	});

	it("reproduces every 2024 - 2025 project total that is free of the dating break", () => {
		expect(projectTotal(report2425, OVERSEAS.id)).toBe(SHEET.fy2425.projects.overseas);
		expect(projectTotal(report2425, WATERFRONT.id)).toBe(SHEET.fy2425.projects.waterfront);
		expect(projectTotal(report2425, LAKESHORE.id)).toBe(SHEET.fy2425.projects.lakeshore);
	});

	it("still lists New Metro City A South Block with a zero total in 2024 - 2025", () => {
		const group = report2425.projectGroups.find((entry) => entry.project.id === NMC_A_SOUTH.id);

		expect(group).toBeDefined();
		expect(group?.project.title).toBe("New Metro City A South Block");
		expect(group?.total).toBe(SHEET.fy2425.projects.nmcASouth);
		expect(group?.payments).toEqual([]);
	});

	it("lists every project the user keeps, in their own order, with no stray groups", () => {
		expect(report2324.projectGroups.map((group) => group.project.title)).toEqual([
			"BWC 3.5 Marla Awami Block",
			"BWC 7 Marla Overseas Block",
			"BWC 18 Marla Waterfront Block",
			"New Metro City Gujar Khan 10 Marla",
			"New Metro City A South Block",
			"Lakeshore 10 marla",
		]);
		expect(report2425.projectGroups).toHaveLength(PROJECTS.length);
	});

	it("reports each project total in PKR without inventing a conversion", () => {
		const withPayments = report2425.projectGroups.filter((group) => group.payments.length > 0);

		expect(withPayments.every((group) => group.currency === "PKR")).toBe(true);
		expect(report2324.warnings).toEqual([]);
		expect(report2425.warnings).toEqual([]);
	});

	it("matches the 2023 - 2024 grand total once the misdated instalment is accounted for", () => {
		expect(report2324.projectGrandTotal).toBe(
			SHEET.fy2324.projectGrandTotal - AWAMI_FISCAL_YEAR_SHIFT
		);
	});

	it("matches the 2024 - 2025 grand total once the misdated instalment is accounted for", () => {
		expect(report2425.projectGrandTotal).toBe(
			SHEET.fy2425.projectGrandTotal + AWAMI_FISCAL_YEAR_SHIFT
		);
	});
});

// ─── The one reconciliation break ────────────────────────────────────────────

describe("Reconciliation break: the 27,500 Awami instalment dated 05/08/2024", () => {
	it("falls short of the 2023 - 2024 sheet by exactly 27,500", () => {
		const engineTotal = projectTotal(report2324, AWAMI.id);

		expect(engineTotal).toBe(78_000);
		expect(SHEET.fy2324.projects.awami - (engineTotal ?? 0)).toBe(AWAMI_FISCAL_YEAR_SHIFT);
	});

	it("overshoots the 2024 - 2025 sheet by exactly the same 27,500", () => {
		const engineTotal = projectTotal(report2425, AWAMI.id);

		expect(engineTotal).toBe(90_000);
		expect((engineTotal ?? 0) - SHEET.fy2425.projects.awami).toBe(AWAMI_FISCAL_YEAR_SHIFT);
	});

	it("loses nothing: both years summed together reconcile exactly", () => {
		const engineAwami =
			(projectTotal(report2324, AWAMI.id) ?? 0) + (projectTotal(report2425, AWAMI.id) ?? 0);
		const sheetAwami = SHEET.fy2324.projects.awami + SHEET.fy2425.projects.awami;

		expect(engineAwami).toBe(sheetAwami);
		expect(report2324.projectGrandTotal + report2425.projectGrandTotal).toBe(
			SHEET.fy2324.projectGrandTotal + SHEET.fy2425.projectGrandTotal
		);
	});

	it("places the instalment in the fiscal year its date belongs to", () => {
		const awami2425 = report2425.projectGroups.find((group) => group.project.id === AWAMI.id);

		expect(awami2425?.payments.map((payment) => payment.transactionId)).toEqual([
			"plot-2425-awami-1",
			"plot-2425-awami-2",
			"plot-2425-awami-3",
		]);
		expect(
			report2324.projectGroups
				.find((group) => group.project.id === AWAMI.id)
				?.payments.map((payment) => payment.transactionId)
		).toEqual(["plot-2324-awami-1", "plot-2324-awami-2", "plot-2324-awami-3"]);
	});
});

// ─── Closing balances ────────────────────────────────────────────────────────

describe("Closing balances at 30 Jun 2025 reconcile to the cent", () => {
	function closingBalance(accountId: string): number | undefined {
		return report2425.accountBalances.find((balance) => balance.accountId === accountId)
			?.closingBalance;
	}

	it("lists exactly the three accounts the user puts on the sheet", () => {
		expect(report2425.accountBalances.map((balance) => balance.title)).toEqual([
			"Al Meezan Investments 233509-1",
			"Savings Account 08280103938868",
			"Default Account 08280103228090",
		]);
	});

	it("reproduces Al Meezan Investments 233509-1", () => {
		expect(closingBalance(MEEZAN_INVESTMENTS.id)).toBe(
			SHEET.fy2425.closingBalances.meezanInvestments
		);
	});

	it("reproduces Savings Account 08280103938868 including the .85", () => {
		expect(closingBalance(SAVINGS_ACCOUNT.id)).toBeCloseTo(SHEET.fy2425.closingBalances.savings, 2);
	});

	it("reproduces Default Account 08280103228090 including the .17", () => {
		expect(closingBalance(DEFAULT_ACCOUNT.id)).toBeCloseTo(SHEET.fy2425.closingBalances.default, 2);
	});

	it("excludes money that only arrived after 30 Jun 2025", () => {
		const afterCutoff = TRANSACTIONS.filter((transaction) => transaction.date > FY_2425_LAST_MS);

		expect(afterCutoff.map((transaction) => transaction.id)).toEqual([
			"plot-2526-lakeshore-1",
			"savings-after-cutoff-income",
		]);
		expect(closingBalance(SAVINGS_ACCOUNT.id)).toBeCloseTo(SHEET.fy2425.closingBalances.savings, 2);
		expect(closingBalance(SAVINGS_ACCOUNT.id)).not.toBeCloseTo(
			SHEET.fy2425.closingBalances.savings + 750_000 - 123_456,
			2
		);
	});

	it("carries opening balances and pre-year movements into the cumulative maths", () => {
		// The 9,999 instalment predates 2023 - 2024 yet must still have left the savings account.
		const savingsWithoutPreYearPayment = buildFiscalReport({
			userId: USER_ID,
			fromMs: FY_2425.fromMs,
			toMs: FY_2425.toMs,
			rangeKey: FY_2425.key,
			rangeLabel: FY_2425_LABEL,
			accounts: ACCOUNTS,
			transactions: TRANSACTIONS.filter((transaction) => transaction.id !== "plot-2223-overseas-1"),
			accountTags: ACCOUNT_TAGS,
			projects: PROJECTS,
			transactionTags: TRANSACTION_TAGS,
			manualEntries: MANUAL_ENTRIES,
			monthlySalaryRows: [],
		}).accountBalances.find((balance) => balance.accountId === SAVINGS_ACCOUNT.id);

		expect(savingsWithoutPreYearPayment?.closingBalance).toBeCloseTo(
			SHEET.fy2425.closingBalances.savings + 9_999,
			2
		);
	});
});

// ─── Fiscal-year boundaries ──────────────────────────────────────────────────

describe("Fiscal-year boundaries are inclusive at both ends", () => {
	it("includes a payment dated exactly 1 Jul 00:00:00.000", () => {
		const overseas2324 = report2324.projectGroups.find((group) => group.project.id === OVERSEAS.id);
		const lakeshore2425 = report2425.projectGroups.find(
			(group) => group.project.id === LAKESHORE.id
		);

		expect(overseas2324?.payments[0]?.transactionId).toBe("plot-2324-overseas-1");
		expect(overseas2324?.payments[0]?.date).toBe(FY_2324_FIRST_MS);
		expect(lakeshore2425?.payments[0]?.transactionId).toBe("plot-2425-lakeshore-1");
		expect(lakeshore2425?.payments[0]?.date).toBe(FY_2425_FIRST_MS);
	});

	it("includes a payment dated exactly 30 Jun 23:59:59.999", () => {
		const waterfront2324 = report2324.projectGroups.find(
			(group) => group.project.id === WATERFRONT.id
		);
		const waterfront2425 = report2425.projectGroups.find(
			(group) => group.project.id === WATERFRONT.id
		);

		expect(waterfront2324?.payments.at(-1)?.transactionId).toBe("plot-2324-waterfront-3");
		expect(waterfront2324?.payments.at(-1)?.date).toBe(FY_2324_LAST_MS);
		expect(waterfront2425?.payments.at(-1)?.transactionId).toBe("plot-2425-waterfront-4");
		expect(waterfront2425?.payments.at(-1)?.date).toBe(FY_2425_LAST_MS);
	});

	it("excludes a payment one millisecond before the year opens", () => {
		const everyPaymentId = report2324.projectGroups.flatMap((group) =>
			group.payments.map((payment) => payment.transactionId)
		);

		expect(everyPaymentId).not.toContain("plot-2223-overseas-1");
		expect(projectTotal(report2324, OVERSEAS.id)).toBe(SHEET.fy2324.projects.overseas);
	});

	it("excludes a payment one millisecond after the year closes", () => {
		const everyPaymentId = report2425.projectGroups.flatMap((group) =>
			group.payments.map((payment) => payment.transactionId)
		);

		expect(everyPaymentId).not.toContain("plot-2526-lakeshore-1");
		expect(projectTotal(report2425, LAKESHORE.id)).toBe(SHEET.fy2425.projects.lakeshore);
	});

	it("keeps the 30 Jun 2024 23:59:59.999 payment out of the 2024 - 2025 report", () => {
		const everyPaymentId2425 = report2425.projectGroups.flatMap((group) =>
			group.payments.map((payment) => payment.transactionId)
		);

		expect(everyPaymentId2425).not.toContain("plot-2324-waterfront-3");
		expect(everyPaymentId2425.some((id) => id.startsWith("plot-2324-"))).toBe(false);
	});
});

// ─── Manual entries ──────────────────────────────────────────────────────────

describe("Manual Nayatel rows pass through untouched", () => {
	it("carries 4,020 PKR into 2023 - 2024", () => {
		expect(report2324.manualEntries).toHaveLength(1);
		expect(report2324.manualEntries[0]?.label).toBe("Nayatel tax");
		expect(report2324.manualEntries[0]?.amount).toBe(SHEET.fy2324.nayatelTax);
		expect(report2324.manualEntries[0]?.currency).toBe("PKR");
	});

	it("carries 4,285 PKR into 2024 - 2025", () => {
		expect(report2425.manualEntries).toHaveLength(1);
		expect(report2425.manualEntries[0]?.label).toBe("Nayatel tax");
		expect(report2425.manualEntries[0]?.amount).toBe(SHEET.fy2425.nayatelTax);
		expect(report2425.manualEntries[0]?.currency).toBe("PKR");
	});

	it("never folds a manual row into any computed total", () => {
		expect(report2425.remittanceTotal).toBe(SHEET.fy2425.remittanceTotal);
		expect(report2425.projectGrandTotal).toBe(
			SHEET.fy2425.projectGrandTotal + AWAMI_FISCAL_YEAR_SHIFT
		);
	});
});

// ─── Determinism ─────────────────────────────────────────────────────────────

describe("The report is reproducible", () => {
	it("returns identical output for identical input and mutates nothing", () => {
		const snapshot = JSON.stringify(TRANSACTIONS);
		const rebuilt = buildReportFor(FY_2425, FY_2425_LABEL);

		expect(rebuilt).toEqual(report2425);
		expect(JSON.stringify(TRANSACTIONS)).toBe(snapshot);
		expect(rebuilt.rangeKey).toBe(FY_2425.key);
		expect(rebuilt.rangeLabel).toBe(FY_2425_LABEL);
		expect(rebuilt.fromMs).toBe(FY_2425_FIRST_MS);
		expect(rebuilt.toMs).toBe(FY_2425_LAST_MS);
	});
});
