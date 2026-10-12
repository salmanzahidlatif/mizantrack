import { computeAccountBalances } from "@/lib/analytics/balanceMath";

import type {
	Account,
	FiscalReportSummary,
	ReportAccountBalance,
	ReportAccountTag,
	ReportManualEntry,
	ReportMonthlySalaryRow,
	ReportProject,
	ReportProjectGroup,
	ReportProjectPayment,
	ReportRemittance,
	ReportTransactionTag,
	Transaction,
} from "@/types";

export const UNASSIGNED_PROJECT_ID = "__unassigned__";

export interface BuildFiscalReportParams {
	userId: string;
	fromMs: number;
	toMs: number;
	rangeKey: string;
	rangeLabel: string;
	accounts: Account[];
	transactions: Transaction[];
	accountTags: ReportAccountTag[];
	projects: ReportProject[];
	transactionTags: ReportTransactionTag[];
	manualEntries: ReportManualEntry[];
	monthlySalaryRows: ReportMonthlySalaryRow[];
}

interface TaggedTransaction {
	transaction: Transaction;
	tag: ReportTransactionTag;
	currency: string;
}

function resolveTitle(transaction: Transaction, fallback: string): string {
	const description = transaction.description?.trim();
	if (description) return description;
	const place = transaction.place?.trim();
	if (place) return place;
	return fallback;
}

function compareProjects(first: ReportProject, second: ReportProject): number {
	const firstOrder = first.sortOrder ?? Number.MAX_SAFE_INTEGER;
	const secondOrder = second.sortOrder ?? Number.MAX_SAFE_INTEGER;
	if (firstOrder !== secondOrder) return firstOrder - secondOrder;
	return first.title.localeCompare(second.title);
}

/**
 * Picks the currency carrying the largest absolute amount, breaking ties by the
 * currency seen first. Amounts in other currencies are never converted.
 */
function resolveDominantCurrency(entries: Array<{ amount: number; currency: string }>): string {
	const totals = new Map<string, number>();
	for (const entry of entries) {
		totals.set(entry.currency, (totals.get(entry.currency) ?? 0) + entry.amount);
	}

	let dominant = "";
	let dominantTotal = -Infinity;
	for (const [currency, total] of totals) {
		if (total > dominantTotal) {
			dominant = currency;
			dominantTotal = total;
		}
	}
	return dominant;
}

function sumInCurrency(
	entries: Array<{ amount: number; currency: string }>,
	currency: string
): number {
	return entries.reduce(
		(total, entry) => (entry.currency === currency ? total + entry.amount : total),
		0
	);
}

function listCurrencies(entries: Array<{ currency: string }>): string[] {
	return [...new Set(entries.map((entry) => entry.currency))];
}

function isManualEntryInScope(
	entry: ReportManualEntry,
	rangeKey: string,
	fromMs: number,
	toMs: number
): boolean {
	if (entry.fiscalYearKey) return entry.fiscalYearKey === rangeKey;
	if (entry.date !== undefined) return entry.date >= fromMs && entry.date <= toMs;
	return true;
}

/**
 * Builds the runtime fiscal report. Pure and deterministic: it reads nothing but its
 * params, writes nothing, and no result is ever persisted. Amounts are only ever
 * aggregated — no rates, conversions or derived figures are invented.
 */
export function buildFiscalReport(params: BuildFiscalReportParams): FiscalReportSummary {
	const {
		userId,
		fromMs,
		toMs,
		rangeKey,
		rangeLabel,
		accounts,
		transactions,
		accountTags,
		projects,
		transactionTags,
		manualEntries,
		monthlySalaryRows,
	} = params;

	const warnings: string[] = [];

	// Balances are cumulative from each account's opening balance, so the FULL transaction
	// list is passed and only the as-of cutoff limits it — never the range start.
	const computation = computeAccountBalances(userId, accounts, transactions, { asOfMs: toMs });

	const includedAccountIds = new Set(
		accountTags
			.filter((tag) => tag.userId === userId && !tag.deletedAt && tag.includeInReport)
			.map((tag) => tag.accountId)
	);

	const accountBalances: ReportAccountBalance[] = computation.accounts
		.filter((account) => includedAccountIds.has(account.id))
		.map((account) => ({
			accountId: account.id,
			title: account.title,
			currency: account.currency,
			closingBalance: computation.balances.get(account.id) ?? account.openingBalance,
			isArchived: account.isArchived,
		}));

	if (computation.warnings.length > 0) {
		warnings.push(
			`${computation.warnings.length} transfer${computation.warnings.length === 1 ? "" : "s"} used legacy balance arithmetic (cross-currency or missing counterparty); closing balances may need review.`
		);
	}

	const accountById = new Map(
		accounts
			.filter((account) => account.userId === userId && !account.deletedAt)
			.map((account) => [account.id, account])
	);

	const tagByTransactionId = new Map<string, ReportTransactionTag>();
	for (const tag of transactionTags) {
		if (tag.userId !== userId || tag.deletedAt) continue;
		tagByTransactionId.set(tag.transactionId, tag);
	}

	const taggedInRange: TaggedTransaction[] = [];
	for (const transaction of transactions) {
		if (transaction.userId !== userId || transaction.deletedAt) continue;
		if (transaction.date < fromMs || transaction.date > toMs) continue;
		const tag = tagByTransactionId.get(transaction.id);
		if (!tag) continue;
		taggedInRange.push({
			transaction,
			tag,
			currency: accountById.get(transaction.accountId)?.currency ?? "",
		});
	}

	taggedInRange.sort((first, second) => first.transaction.date - second.transaction.date);

	const remittances: ReportRemittance[] = taggedInRange
		.filter((entry) => entry.tag.role === "remittance")
		.map((entry) => ({
			transactionId: entry.transaction.id,
			date: entry.transaction.date,
			amount: entry.transaction.amount,
			currency: entry.currency,
			title: resolveTitle(entry.transaction, "Remittance"),
		}));

	const remittanceCurrencies = listCurrencies(remittances);
	let remittanceTotal = 0;
	if (remittanceCurrencies.length > 1) {
		const dominantCurrency = resolveDominantCurrency(remittances);
		remittanceTotal = sumInCurrency(remittances, dominantCurrency);
		warnings.push(
			`Remittances mix currencies (${remittanceCurrencies.join(", ")}). The total shows ${dominantCurrency} only; no exchange rate was applied.`
		);
	} else {
		remittanceTotal = remittances.reduce((total, entry) => total + entry.amount, 0);
	}

	const paymentsByProjectId = new Map<string, ReportProjectPayment[]>();
	for (const entry of taggedInRange) {
		if (entry.tag.role !== "plot-payment") continue;
		const projectId = entry.tag.projectId ?? UNASSIGNED_PROJECT_ID;
		const payment: ReportProjectPayment = {
			transactionId: entry.transaction.id,
			date: entry.transaction.date,
			amount: entry.transaction.amount,
			currency: entry.currency,
			title: resolveTitle(entry.transaction, "Property payment"),
		};
		const existing = paymentsByProjectId.get(projectId);
		if (existing) existing.push(payment);
		else paymentsByProjectId.set(projectId, [payment]);
	}

	const userProjects = projects
		.filter((project) => project.userId === userId && !project.deletedAt)
		.sort(compareProjects);

	const knownProjectIds = new Set(userProjects.map((project) => project.id));
	const orphanProjectIds = [...paymentsByProjectId.keys()].filter(
		(projectId) => !knownProjectIds.has(projectId)
	);

	const groupProjects: ReportProject[] = [
		...userProjects,
		...orphanProjectIds.map((projectId) => ({
			id: projectId,
			userId,
			title: projectId === UNASSIGNED_PROJECT_ID ? "Unassigned payments" : "Unknown project",
			updatedAt: 0,
		})),
	];

	const projectGroups: ReportProjectGroup[] = groupProjects.map((project) => {
		const payments = (paymentsByProjectId.get(project.id) ?? [])
			.slice()
			.sort((first, second) => first.date - second.date);
		const currencies = listCurrencies(payments);

		if (currencies.length > 1) {
			const dominantCurrency = resolveDominantCurrency(payments);
			warnings.push(
				`"${project.title}" mixes currencies (${currencies.join(", ")}). The total shows ${dominantCurrency} only; no exchange rate was applied.`
			);
			return {
				project,
				payments,
				total: sumInCurrency(payments, dominantCurrency),
				currency: dominantCurrency,
			};
		}

		return {
			project,
			payments,
			total: payments.reduce((total, payment) => total + payment.amount, 0),
			currency: currencies[0] ?? "",
		};
	});

	const projectCurrencies = [
		...new Set(projectGroups.filter((group) => group.currency).map((group) => group.currency)),
	];
	let projectGrandTotal = 0;
	if (projectCurrencies.length > 1) {
		const dominantCurrency = resolveDominantCurrency(
			projectGroups.map((group) => ({ amount: group.total, currency: group.currency }))
		);
		projectGrandTotal = sumInCurrency(
			projectGroups.map((group) => ({ amount: group.total, currency: group.currency })),
			dominantCurrency
		);
		warnings.push(
			`Projects mix currencies (${projectCurrencies.join(", ")}). The grand total shows ${dominantCurrency} only; no exchange rate was applied.`
		);
	} else {
		projectGrandTotal = projectGroups.reduce((total, group) => total + group.total, 0);
	}

	const scopedManualEntries = manualEntries
		.filter((entry) => entry.userId === userId && !entry.deletedAt)
		.filter((entry) => isManualEntryInScope(entry, rangeKey, fromMs, toMs))
		.sort((first, second) => first.label.localeCompare(second.label));

	const scopedMonthlySalaryRows = monthlySalaryRows
		.filter((row) => row.userId === userId && !row.deletedAt && row.fiscalYearKey === rangeKey)
		.sort((first, second) => first.monthKey.localeCompare(second.monthKey));

	return {
		rangeKey,
		rangeLabel,
		fromMs,
		toMs,
		accountBalances,
		remittances,
		remittanceTotal,
		projectGroups,
		projectGrandTotal,
		manualEntries: scopedManualEntries,
		monthlySalaryRows: scopedMonthlySalaryRows,
		warnings,
	};
}
