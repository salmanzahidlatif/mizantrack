/**
 * Reports rebuild: fiscal-year scoping, detection guards and report aggregation.
 * Everything under test is pure — reports are recomputed at runtime and never stored.
 */
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { detectReportTransactions } from "@/lib/reports/reportDetection";
import { buildFiscalReport } from "@/lib/reports/reportEngine";
import { buildFiscalReportWorkbook } from "@/lib/reports/reportExport";
import { listFiscalYearOptions } from "@/lib/reports/reportFiscalYears";

import type {
	Account,
	ReportAccountTag,
	ReportProject,
	ReportTransactionTag,
	Transaction,
} from "@/types";

const USER_ID = "reports-test-user";
const UTC_OFFSET_MINUTES = 0;
const FISCAL_YEAR_START_MONTH = 7; // July

// FY 2023 - 2024 runs 1 Jul 2023 00:00:00.000 → 30 Jun 2024 23:59:59.999 (UTC)
const FY_FROM_MS = Date.UTC(2023, 6, 1, 0, 0, 0, 0);
const FY_TO_MS = Date.UTC(2024, 5, 30, 23, 59, 59, 999);
const FY_KEY = "FY-2023-2024";
const FY_LABEL = "2023 - 2024";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeAccount(overrides: Partial<Account> & Pick<Account, "id">): Account {
	return {
		userId: USER_ID,
		title: "Account",
		openingBalance: 0,
		currency: "AED",
		isArchived: false,
		updatedAt: 0,
		...overrides,
	};
}

function makeTransaction(
	overrides: Partial<Transaction> & Pick<Transaction, "id" | "date">
): Transaction {
	return {
		userId: USER_ID,
		type: "Transfer",
		amount: 100,
		accountId: "aed-bank",
		updatedAt: 0,
		...overrides,
	};
}

function makeTransactionTag(
	overrides: Partial<ReportTransactionTag> & Pick<ReportTransactionTag, "id" | "transactionId">
): ReportTransactionTag {
	return {
		userId: USER_ID,
		role: "remittance",
		confirmed: true,
		updatedAt: 0,
		...overrides,
	};
}

function makeAccountTag(accountId: string): ReportAccountTag {
	return {
		id: `tag-${accountId}`,
		userId: USER_ID,
		accountId,
		includeInReport: true,
		updatedAt: 0,
	};
}

function makeProject(id: string, title: string, sortOrder?: number): ReportProject {
	return { id, userId: USER_ID, title, sortOrder, updatedAt: 0 };
}

const AED_ACCOUNT = makeAccount({ id: "aed-bank", title: "ADCB", currency: "AED" });
const PKR_ACCOUNT = makeAccount({ id: "pkr-bank", title: "Meezan", currency: "PKR" });
const AED_CASH_ACCOUNT = makeAccount({ id: "aed-cash", title: "AED Cash", currency: "AED" });
const PKR_PROPERTY_ACCOUNT = makeAccount({
	id: "pkr-property",
	title: "Property Holdings",
	currency: "PKR",
});
const PKR_BRIDGE_ACCOUNT = makeAccount({
	id: "pkr-bridge",
	title: "PKR Bridge",
	currency: "PKR",
});

function buildReport(params: {
	accounts?: Account[];
	transactions?: Transaction[];
	accountTags?: ReportAccountTag[];
	projects?: ReportProject[];
	transactionTags?: ReportTransactionTag[];
	currency?: string;
}) {
	return buildFiscalReport({
		userId: USER_ID,
		fromMs: FY_FROM_MS,
		toMs: FY_TO_MS,
		rangeKey: FY_KEY,
		rangeLabel: FY_LABEL,
		accounts: params.accounts ?? [AED_ACCOUNT, PKR_ACCOUNT],
		transactions: params.transactions ?? [],
		accountTags: params.accountTags ?? [],
		projects: params.projects ?? [],
		transactionTags: params.transactionTags ?? [],
		manualEntries: [],
		monthlySalaryRows: [],
		currency: params.currency,
	});
}

// ─── Fiscal-year options ─────────────────────────────────────────────────────

describe("listFiscalYearOptions", () => {
	it("labels fiscal years the way the user names them", () => {
		const options = listFiscalYearOptions({
			fiscalYearStartMonth: FISCAL_YEAR_START_MONTH,
			now: new Date(Date.UTC(2024, 2, 15)),
			timeZoneOffsetMinutes: UTC_OFFSET_MINUTES,
		});

		expect(options[0]?.label).toBe(FY_LABEL);
		expect(options[0]?.key).toBe(FY_KEY);
		expect(options[0]?.fromMs).toBe(FY_FROM_MS);
		expect(options[0]?.toMs).toBe(FY_TO_MS);
	});

	it("walks back to the fiscal year holding the earliest transaction, newest first", () => {
		const options = listFiscalYearOptions({
			fiscalYearStartMonth: FISCAL_YEAR_START_MONTH,
			earliestTransactionMs: Date.UTC(2021, 8, 1),
			now: new Date(Date.UTC(2024, 2, 15)),
			timeZoneOffsetMinutes: UTC_OFFSET_MINUTES,
		});

		expect(options.map((option) => option.label)).toEqual([
			"2023 - 2024",
			"2022 - 2023",
			"2021 - 2022",
		]);
	});

	it("caps the list at 15 fiscal years", () => {
		const options = listFiscalYearOptions({
			fiscalYearStartMonth: FISCAL_YEAR_START_MONTH,
			earliestTransactionMs: Date.UTC(1990, 0, 1),
			now: new Date(Date.UTC(2024, 2, 15)),
			timeZoneOffsetMinutes: UTC_OFFSET_MINUTES,
		});

		expect(options).toHaveLength(15);
	});
});

// ─── Fiscal-year boundaries ──────────────────────────────────────────────────

describe("Fiscal-year boundaries", () => {
	const transactions = [
		makeTransaction({ id: "before", date: FY_FROM_MS - 1, description: "remittance june" }),
		makeTransaction({ id: "first-ms", date: FY_FROM_MS, description: "remittance opening day" }),
		makeTransaction({ id: "last-ms", date: FY_TO_MS, description: "remittance closing day" }),
		makeTransaction({ id: "after", date: FY_TO_MS + 1, description: "remittance july" }),
	];

	it("includes transactions at exactly fromMs and exactly toMs", () => {
		const detected = detectReportTransactions({
			transactions,
			accounts: [AED_ACCOUNT, PKR_ACCOUNT],
			existingTags: [],
			fromMs: FY_FROM_MS,
			toMs: FY_TO_MS,
		});

		expect(detected.map((entry) => entry.transaction.id)).toEqual(["first-ms", "last-ms"]);
	});

	it("excludes transactions one millisecond outside the range", () => {
		const detected = detectReportTransactions({
			transactions,
			accounts: [AED_ACCOUNT, PKR_ACCOUNT],
			existingTags: [],
			fromMs: FY_FROM_MS,
			toMs: FY_TO_MS,
		});

		expect(detected.some((entry) => entry.transaction.id === "before")).toBe(false);
		expect(detected.some((entry) => entry.transaction.id === "after")).toBe(false);
	});

	it("keeps tagged rows at both boundaries in the report", () => {
		const report = buildReport({
			transactions,
			transactionTags: transactions.map((transaction) =>
				makeTransactionTag({ id: `tag-${transaction.id}`, transactionId: transaction.id })
			),
		});

		expect(report.remittances.map((entry) => entry.transactionId)).toEqual(["first-ms", "last-ms"]);
		expect(report.remittanceTotal).toBe(200);
	});
});

// ─── Closing balances ────────────────────────────────────────────────────────

describe("Closing balances", () => {
	it("reflects every transaction up to toMs and ignores later ones", () => {
		const account = makeAccount({ id: "aed-bank", title: "ADCB", openingBalance: 1000 });
		const report = buildReport({
			accounts: [account],
			accountTags: [makeAccountTag("aed-bank")],
			transactions: [
				makeTransaction({
					id: "pre-range-income",
					date: FY_FROM_MS - 86_400_000,
					type: "Income",
					amount: 250,
				}),
				makeTransaction({
					id: "in-range-expense",
					date: Date.UTC(2023, 11, 1),
					type: "Expense",
					amount: 100,
				}),
				makeTransaction({
					id: "after-range-income",
					date: FY_TO_MS + 1,
					type: "Income",
					amount: 9999,
				}),
			],
		});

		expect(report.accountBalances).toHaveLength(1);
		expect(report.accountBalances[0]?.closingBalance).toBe(1150);
	});

	it("only includes accounts the user tagged for the report", () => {
		const report = buildReport({
			accounts: [AED_ACCOUNT, PKR_ACCOUNT],
			accountTags: [makeAccountTag("pkr-bank")],
		});

		expect(report.accountBalances.map((balance) => balance.accountId)).toEqual(["pkr-bank"]);
	});
});

// ─── Detection ───────────────────────────────────────────────────────────────

describe("detectReportTransactions", () => {
	const inRangeDate = Date.UTC(2023, 9, 10);

	it("flags a transfer described as a remittance", () => {
		const transaction = makeTransaction({
			id: "remit-1",
			date: inRangeDate,
			description: "4.5 lac remittance",
		});

		const detected = detectReportTransactions({
			transactions: [transaction],
			accounts: [AED_ACCOUNT, PKR_ACCOUNT],
			existingTags: [],
			fromMs: FY_FROM_MS,
			toMs: FY_TO_MS,
		});

		expect(detected).toHaveLength(1);
		expect(detected[0]?.suggestedRole).toBe("remittance");
		expect(detected[0]?.reason).toBe("keyword");
		expect(detected[0]?.matchedKeyword).toBe("remittance");
		expect(detected[0]?.confirmed).toBe(false);
	});

	it("never flags an expense such as 'metro nol card' as a plot payment", () => {
		const detected = detectReportTransactions({
			transactions: [
				makeTransaction({
					id: "metro-nol",
					date: inRangeDate,
					type: "Expense",
					amount: 7.5,
					description: "metro nol card",
				}),
				makeTransaction({
					id: "metro-city-expense",
					date: inRangeDate,
					type: "Expense",
					amount: 12,
					description: "Metro City snack",
				}),
			],
			accounts: [AED_ACCOUNT, PKR_ACCOUNT],
			existingTags: [],
			fromMs: FY_FROM_MS,
			toMs: FY_TO_MS,
		});

		expect(detected).toHaveLength(0);
	});

	it("flags a same-currency incoming transfer into an included account", () => {
		const detected = detectReportTransactions({
			transactions: [
				makeTransaction({
					id: "bridge-transfer",
					date: inRangeDate,
					accountId: "pkr-bridge",
					toAccountId: "pkr-bank",
					description: "monthly send home",
				}),
			],
			accounts: [PKR_ACCOUNT, PKR_BRIDGE_ACCOUNT],
			accountTags: [makeAccountTag("pkr-bank")],
			existingTags: [],
			fromMs: FY_FROM_MS,
			toMs: FY_TO_MS,
		});

		expect(detected).toHaveLength(1);
		expect(detected[0]?.suggestedRole).toBe("income");
		expect(detected[0]?.reason).toBe("inflow");
	});

	it("ignores an outgoing transfer that matches no keyword", () => {
		const detected = detectReportTransactions({
			transactions: [
				makeTransaction({
					id: "outgoing",
					date: inRangeDate,
					accountId: "pkr-bank",
					toAccountId: "pkr-bridge",
					description: "moving money out",
				}),
			],
			accounts: [PKR_ACCOUNT, PKR_BRIDGE_ACCOUNT],
			accountTags: [makeAccountTag("pkr-bank")],
			existingTags: [],
			fromMs: FY_FROM_MS,
			toMs: FY_TO_MS,
		});

		expect(detected).toHaveLength(0);
	});

	it("surfaces every income as a candidate even without a keyword", () => {
		const detected = detectReportTransactions({
			transactions: [
				makeTransaction({
					id: "meezan-income",
					date: inRangeDate,
					type: "Income",
					accountId: "pkr-bank",
					amount: 400_000,
					description: "Credit from UAE",
				}),
			],
			accounts: [PKR_ACCOUNT],
			existingTags: [],
			fromMs: FY_FROM_MS,
			toMs: FY_TO_MS,
		});

		expect(detected).toHaveLength(1);
		expect(detected[0]?.suggestedRole).toBe("income");
		expect(detected[0]?.reason).toBe("inflow");
		expect(detected[0]?.confirmed).toBe(false);
	});

	it("suggests remittance for an income whose description matches a remittance keyword", () => {
		const detected = detectReportTransactions({
			transactions: [
				makeTransaction({
					id: "meezan-remittance",
					date: inRangeDate,
					type: "Income",
					accountId: "pkr-bank",
					amount: 400_000,
					description: "Remittance received",
				}),
			],
			accounts: [PKR_ACCOUNT],
			existingTags: [],
			fromMs: FY_FROM_MS,
			toMs: FY_TO_MS,
		});

		expect(detected).toHaveLength(1);
		expect(detected[0]?.suggestedRole).toBe("remittance");
		expect(detected[0]?.reason).toBe("keyword");
		expect(detected[0]?.matchedKeyword).toBe("remittance");
	});

	it("still never surfaces an expense, even one that looks like an inflow", () => {
		const detected = detectReportTransactions({
			transactions: [
				makeTransaction({
					id: "metro-expense",
					date: inRangeDate,
					type: "Expense",
					accountId: "pkr-bank",
					amount: 7.5,
					description: "metro city",
				}),
				makeTransaction({
					id: "remittance-fee",
					date: inRangeDate,
					type: "Expense",
					accountId: "pkr-bank",
					amount: 25,
					description: "remittance fee",
				}),
			],
			accounts: [PKR_ACCOUNT],
			accountTags: [makeAccountTag("pkr-bank")],
			existingTags: [],
			fromMs: FY_FROM_MS,
			toMs: FY_TO_MS,
		});

		expect(detected).toHaveLength(0);
	});

	it("only surfaces candidates from accounts in the selected currency", () => {
		const detected = detectReportTransactions({
			transactions: [
				makeTransaction({
					id: "pkr-income",
					date: inRangeDate,
					type: "Income",
					accountId: "pkr-bank",
					description: "Credit",
				}),
				makeTransaction({
					id: "aed-income",
					date: inRangeDate,
					type: "Income",
					accountId: "aed-bank",
					description: "Salary",
				}),
				makeTransaction({
					id: "orphan-income",
					date: inRangeDate,
					type: "Income",
					accountId: "deleted-account",
					description: "Credit",
				}),
			],
			accounts: [AED_ACCOUNT, PKR_ACCOUNT],
			existingTags: [],
			fromMs: FY_FROM_MS,
			toMs: FY_TO_MS,
			currency: "PKR",
		});

		expect(detected.map((entry) => entry.transaction.id)).toEqual(["pkr-income"]);
	});

	it("falls back to every account when the user has included none yet", () => {
		const detected = detectReportTransactions({
			transactions: [
				makeTransaction({
					id: "bridge-transfer",
					date: inRangeDate,
					accountId: "pkr-bridge",
					toAccountId: "pkr-bank",
					description: "no keyword here",
				}),
			],
			accounts: [PKR_ACCOUNT, PKR_BRIDGE_ACCOUNT],
			accountTags: [],
			existingTags: [],
			fromMs: FY_FROM_MS,
			toMs: FY_TO_MS,
		});

		expect(detected).toHaveLength(1);
		expect(detected[0]?.reason).toBe("inflow");
	});

	it("lets a confirmed user tag override auto-detection", () => {
		const transaction = makeTransaction({
			id: "remit-1",
			date: inRangeDate,
			description: "4.5 lac remittance",
		});

		const detected = detectReportTransactions({
			transactions: [transaction],
			accounts: [AED_ACCOUNT, PKR_ACCOUNT],
			existingTags: [
				makeTransactionTag({
					id: "user-tag-1",
					transactionId: "remit-1",
					role: "plot-payment",
					projectId: "bwc-7-marla",
					confirmed: true,
				}),
			],
			fromMs: FY_FROM_MS,
			toMs: FY_TO_MS,
		});

		expect(detected).toHaveLength(1);
		expect(detected[0]?.suggestedRole).toBe("plot-payment");
		expect(detected[0]?.reason).toBe("manual");
		expect(detected[0]?.confirmed).toBe(true);
		expect(detected[0]?.projectId).toBe("bwc-7-marla");
	});

	it("surfaces a confirmed tag even on an expense that auto-detection would skip", () => {
		const detected = detectReportTransactions({
			transactions: [
				makeTransaction({
					id: "manual-expense",
					date: inRangeDate,
					type: "Expense",
					amount: 500,
					description: "transfer fee",
				}),
			],
			accounts: [AED_ACCOUNT, PKR_ACCOUNT],
			existingTags: [
				makeTransactionTag({
					id: "user-tag-2",
					transactionId: "manual-expense",
					role: "excluded",
					confirmed: true,
				}),
			],
			fromMs: FY_FROM_MS,
			toMs: FY_TO_MS,
		});

		expect(detected).toHaveLength(1);
		expect(detected[0]?.suggestedRole).toBe("excluded");
	});

	it("returns candidates sorted by date ascending", () => {
		const detected = detectReportTransactions({
			transactions: [
				makeTransaction({ id: "late", date: Date.UTC(2024, 4, 1), description: "plot payment" }),
				makeTransaction({ id: "early", date: Date.UTC(2023, 7, 1), description: "remit home" }),
			],
			accounts: [AED_ACCOUNT, PKR_ACCOUNT],
			existingTags: [],
			fromMs: FY_FROM_MS,
			toMs: FY_TO_MS,
		});

		expect(detected.map((entry) => entry.transaction.id)).toEqual(["early", "late"]);
	});
});

// ─── Incomes ─────────────────────────────────────────────────────────────────

describe("Tagged incomes", () => {
	const incomeDate = Date.UTC(2023, 9, 10);

	function incomeTransaction(id: string, accountId: string, amount: number): Transaction {
		return makeTransaction({
			id,
			date: incomeDate,
			type: "Income",
			accountId,
			amount,
			description: `Credit ${id}`,
		});
	}

	it("collects transactions tagged as income into their own list and total", () => {
		const report = buildReport({
			accounts: [PKR_ACCOUNT],
			transactions: [
				incomeTransaction("income-1", "pkr-bank", 400_000),
				incomeTransaction("income-2", "pkr-bank", 250_000),
			],
			transactionTags: [
				makeTransactionTag({ id: "t1", transactionId: "income-1", role: "income" }),
				makeTransactionTag({ id: "t2", transactionId: "income-2", role: "income" }),
			],
		});

		expect(report.incomes.map((entry) => entry.transactionId)).toEqual(["income-1", "income-2"]);
		expect(report.incomeTotal).toBe(650_000);
		expect(report.incomes.every((entry) => entry.currency === "PKR")).toBe(true);
		expect(report.remittances).toEqual([]);
	});

	it("carries a tagged income through to the Excel export", () => {
		const report = buildReport({
			accounts: [PKR_ACCOUNT],
			transactions: [incomeTransaction("income-1", "pkr-bank", 400_000)],
			transactionTags: [
				makeTransactionTag({ id: "t1", transactionId: "income-1", role: "income" }),
			],
			currency: "PKR",
		});

		const sheet = buildFiscalReportWorkbook(report).Sheets["Banks & Salaries"];
		const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet!, { header: 1, blankrows: true });

		expect(rows).toContainEqual(["Incomes"]);
		expect(rows.some((row) => row[1] === "Credit income-1" && row[2] === 400_000)).toBe(true);

		const incomeIndex = rows.findIndex((row) => row[0] === "Incomes");
		expect(rows.slice(incomeIndex).find((row) => row[0] === "Total")).toEqual([
			"Total",
			undefined,
			400_000,
			"PKR",
		]);
	});

	it("keeps income out of the remittance and project totals", () => {
		const report = buildReport({
			accounts: [PKR_ACCOUNT],
			transactions: [incomeTransaction("income-1", "pkr-bank", 400_000)],
			transactionTags: [
				makeTransactionTag({ id: "t1", transactionId: "income-1", role: "income" }),
			],
		});

		expect(report.remittanceTotal).toBe(0);
		expect(report.projectGrandTotal).toBe(0);
		expect(report.incomeTotal).toBe(400_000);
	});
});

// ─── Currency scoping ────────────────────────────────────────────────────────

describe("Currency scoping", () => {
	const inRangeDate = Date.UTC(2023, 9, 10);

	const transactions = [
		makeTransaction({
			id: "pkr-income",
			date: inRangeDate,
			type: "Income",
			accountId: "pkr-bank",
			amount: 400_000,
		}),
		makeTransaction({
			id: "aed-income",
			date: inRangeDate,
			type: "Income",
			accountId: "aed-bank",
			amount: 9_000,
		}),
	];

	const transactionTags = [
		makeTransactionTag({ id: "t1", transactionId: "pkr-income", role: "income" }),
		makeTransactionTag({ id: "t2", transactionId: "aed-income", role: "income" }),
	];

	it("keeps only the selected currency in the incomes list", () => {
		const report = buildReport({ transactions, transactionTags, currency: "PKR" });

		expect(report.currency).toBe("PKR");
		expect(report.incomes.map((entry) => entry.transactionId)).toEqual(["pkr-income"]);
		expect(report.incomeTotal).toBe(400_000);
		expect(report.warnings).toEqual([]);
	});

	it("keeps only the selected currency's closing balances", () => {
		const report = buildReport({
			accountTags: [makeAccountTag("aed-bank"), makeAccountTag("pkr-bank")],
			currency: "PKR",
		});

		expect(report.accountBalances.map((balance) => balance.accountId)).toEqual(["pkr-bank"]);
	});

	it("keeps only the selected currency's plot payments", () => {
		const report = buildReport({
			projects: [makeProject("bwc", "BWC 7 Marla Overseas Block", 1)],
			transactions,
			transactionTags: [
				makeTransactionTag({
					id: "t1",
					transactionId: "pkr-income",
					role: "plot-payment",
					projectId: "bwc",
				}),
				makeTransactionTag({
					id: "t2",
					transactionId: "aed-income",
					role: "plot-payment",
					projectId: "bwc",
				}),
			],
			currency: "PKR",
		});

		const group = report.projectGroups.find((entry) => entry.project.id === "bwc");
		expect(group?.payments.map((payment) => payment.transactionId)).toEqual(["pkr-income"]);
		expect(group?.total).toBe(400_000);
		expect(report.projectGrandTotal).toBe(400_000);
		expect(report.warnings).toEqual([]);
	});

	it("aggregates every currency when no currency is selected", () => {
		const report = buildReport({ transactions, transactionTags });

		expect(report.currency).toBe("");
		expect(report.incomes).toHaveLength(2);
	});
});

// ─── Project grouping ────────────────────────────────────────────────────────

describe("Project grouping", () => {
	it("totals payments per project and across projects", () => {
		const report = buildReport({
			accounts: [PKR_ACCOUNT, PKR_PROPERTY_ACCOUNT],
			projects: [
				makeProject("bwc", "BWC 7 Marla Overseas Block", 1),
				makeProject("lakeshore", "Lakeshore File", 2),
				makeProject("awami", "Awami Villa", 3),
			],
			transactions: [
				makeTransaction({
					id: "bwc-1",
					date: Date.UTC(2023, 8, 1),
					accountId: "pkr-bank",
					toAccountId: "pkr-property",
					amount: 100_000,
				}),
				makeTransaction({
					id: "bwc-2",
					date: Date.UTC(2023, 7, 1),
					accountId: "pkr-bank",
					toAccountId: "pkr-property",
					amount: 200_000,
				}),
				makeTransaction({
					id: "lake-1",
					date: Date.UTC(2024, 1, 1),
					accountId: "pkr-bank",
					toAccountId: "pkr-property",
					amount: 50_000,
				}),
			],
			transactionTags: [
				makeTransactionTag({
					id: "t1",
					transactionId: "bwc-1",
					role: "plot-payment",
					projectId: "bwc",
				}),
				makeTransactionTag({
					id: "t2",
					transactionId: "bwc-2",
					role: "plot-payment",
					projectId: "bwc",
				}),
				makeTransactionTag({
					id: "t3",
					transactionId: "lake-1",
					role: "plot-payment",
					projectId: "lakeshore",
				}),
			],
		});

		const bwc = report.projectGroups.find((group) => group.project.id === "bwc");
		const lakeshore = report.projectGroups.find((group) => group.project.id === "lakeshore");
		const awami = report.projectGroups.find((group) => group.project.id === "awami");

		expect(bwc?.total).toBe(300_000);
		expect(bwc?.currency).toBe("PKR");
		expect(bwc?.payments.map((payment) => payment.transactionId)).toEqual(["bwc-2", "bwc-1"]);
		expect(lakeshore?.total).toBe(50_000);
		expect(awami?.total).toBe(0);
		expect(awami?.payments).toEqual([]);
		expect(report.projectGrandTotal).toBe(350_000);
		expect(report.warnings).toEqual([]);
	});

	it("warns instead of converting when one project mixes currencies", () => {
		const report = buildReport({
			accounts: [AED_ACCOUNT, PKR_ACCOUNT, AED_CASH_ACCOUNT, PKR_PROPERTY_ACCOUNT],
			projects: [makeProject("bwc", "BWC 7 Marla Overseas Block", 1)],
			transactions: [
				makeTransaction({
					id: "pkr-payment",
					date: Date.UTC(2023, 8, 1),
					accountId: "pkr-bank",
					toAccountId: "pkr-property",
					amount: 500_000,
				}),
				makeTransaction({
					id: "aed-payment",
					date: Date.UTC(2023, 9, 1),
					accountId: "aed-bank",
					toAccountId: "aed-cash",
					amount: 6_000,
				}),
			],
			transactionTags: [
				makeTransactionTag({
					id: "t1",
					transactionId: "pkr-payment",
					role: "plot-payment",
					projectId: "bwc",
				}),
				makeTransactionTag({
					id: "t2",
					transactionId: "aed-payment",
					role: "plot-payment",
					projectId: "bwc",
				}),
			],
		});

		const bwc = report.projectGroups[0];
		expect(bwc?.payments).toHaveLength(2);
		expect(bwc?.currency).toBe("PKR");
		expect(bwc?.total).toBe(500_000);
		expect(report.projectGrandTotal).toBe(500_000);
		expect(report.warnings).toHaveLength(1);
		expect(report.warnings[0]).toContain("mixes currencies");
		expect(report.warnings[0]).toContain("AED");
		expect(report.warnings[0]).toContain("PKR");
	});

	it("warns instead of converting when remittances mix currencies", () => {
		const report = buildReport({
			accounts: [AED_ACCOUNT, PKR_ACCOUNT],
			transactions: [
				makeTransaction({
					id: "aed-remit",
					date: Date.UTC(2023, 8, 1),
					accountId: "aed-bank",
					amount: 5_000,
				}),
				makeTransaction({
					id: "pkr-remit",
					date: Date.UTC(2023, 9, 1),
					accountId: "pkr-bank",
					amount: 1_000,
				}),
			],
			transactionTags: [
				makeTransactionTag({ id: "t1", transactionId: "aed-remit" }),
				makeTransactionTag({ id: "t2", transactionId: "pkr-remit" }),
			],
		});

		expect(report.remittanceTotal).toBe(5_000);
		expect(report.warnings.some((warning) => warning.includes("Remittances mix currencies"))).toBe(
			true
		);
	});
});

// ─── Report shape ────────────────────────────────────────────────────────────

describe("buildFiscalReport", () => {
	it("is deterministic and never mutates its inputs", () => {
		const transactions = [
			makeTransaction({
				id: "remit-1",
				date: Date.UTC(2023, 9, 1),
				accountId: "pkr-bank",
				amount: 450_000,
				description: "4.5 lac remittance",
			}),
		];
		const snapshot = JSON.stringify(transactions);
		const tags = [makeTransactionTag({ id: "t1", transactionId: "remit-1" })];

		const first = buildReport({ transactions, transactionTags: tags });
		const second = buildReport({ transactions, transactionTags: tags });

		expect(JSON.stringify(transactions)).toBe(snapshot);
		expect(first).toEqual(second);
		expect(first.rangeKey).toBe(FY_KEY);
		expect(first.rangeLabel).toBe(FY_LABEL);
		expect(first.remittances[0]?.title).toBe("4.5 lac remittance");
	});
});
