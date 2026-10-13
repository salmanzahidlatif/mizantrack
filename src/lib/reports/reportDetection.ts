import {
	buildAccountCurrencyIndex,
	transactionMatchesCurrency,
} from "@/lib/reports/reportCurrency";

import type {
	Account,
	DetectedReportTransaction,
	ReportAccountTag,
	ReportTransactionRole,
	ReportTransactionTag,
	Transaction,
} from "@/types";

export const REMITTANCE_KEYWORDS = ["remittance", "remit"] as const;

export const PLOT_KEYWORDS = [
	"property",
	"plot",
	"marla",
	"bwc",
	"metro city",
	"lakeshore",
	"waterfront",
	"awami",
	"overseas block",
	"file",
	"installment",
	"instalment",
] as const;

export interface DetectReportTransactionsParams {
	transactions: Transaction[];
	accounts: Account[];
	existingTags: ReportTransactionTag[];
	fromMs: number;
	toMs: number;
	/** Scopes detection to a single currency. Omitted or empty means "every currency". */
	currency?: string;
	/** Decides which accounts count as "mine" for incoming transfers. */
	accountTags?: ReportAccountTag[];
}

interface KeywordMatch {
	role: ReportTransactionRole;
	matchedKeyword: string;
}

function getSearchableText(transaction: Transaction): string {
	const parts: string[] = [];
	if (transaction.description) parts.push(transaction.description);
	if (transaction.tags) parts.push(...transaction.tags);
	return parts.join(" ").toLowerCase();
}

function findKeyword(text: string, keywords: readonly string[]): string | undefined {
	return keywords.find((keyword) => text.includes(keyword));
}

function matchRemittanceKeyword(transaction: Transaction): string | undefined {
	const text = getSearchableText(transaction);
	if (!text) return undefined;
	return findKeyword(text, REMITTANCE_KEYWORDS);
}

function matchKeywordRole(transaction: Transaction): KeywordMatch | undefined {
	const text = getSearchableText(transaction);
	if (!text) return undefined;

	const remittanceKeyword = findKeyword(text, REMITTANCE_KEYWORDS);
	if (remittanceKeyword) {
		return { role: "remittance", matchedKeyword: remittanceKeyword };
	}

	const plotKeyword = findKeyword(text, PLOT_KEYWORDS);
	if (plotKeyword) {
		return { role: "plot-payment", matchedKeyword: plotKeyword };
	}

	return undefined;
}

/**
 * The accounts an inflow can land in. Normally the ones the user ticked for the report;
 * when nothing is ticked yet every account counts, so the review queue is never
 * mysteriously empty on a fresh report.
 */
/**
 * Suggests report roles for transactions inside a range and inside the selected currency.
 * Detection is advisory only: a confirmed user tag always wins, and nothing here mutates
 * or persists anything.
 *
 * Per transaction type:
 * - Income   → ALWAYS a candidate. "remittance" on a remittance keyword, else "income".
 *              Income is the only way money enters the reported wealth, so this is where
 *              remittances are found, however they are worded.
 * - Transfer → a candidate only when a remittance or plot keyword matches. A transfer moves
 *              money between the owner's own accounts, so nothing was earned; suggesting
 *              them as income double-counted the income that first brought the money in.
 * - Expense  → never a candidate.
 */
export function detectReportTransactions(
	params: DetectReportTransactionsParams
): DetectedReportTransaction[] {
	const { transactions, accounts, existingTags, fromMs, toMs, currency } = params;

	const accountById = buildAccountCurrencyIndex(accounts);

	const confirmedTagByTransactionId = new Map<string, ReportTransactionTag>();
	for (const tag of existingTags) {
		if (tag.deletedAt || !tag.confirmed) continue;
		confirmedTagByTransactionId.set(tag.transactionId, tag);
	}

	const detected: DetectedReportTransaction[] = [];

	for (const transaction of transactions) {
		if (transaction.deletedAt) continue;
		if (transaction.date < fromMs || transaction.date > toMs) continue;
		if (!transactionMatchesCurrency(transaction, accountById, currency ?? "")) continue;

		const confirmedTag = confirmedTagByTransactionId.get(transaction.id);
		if (confirmedTag) {
			detected.push({
				transaction,
				suggestedRole: confirmedTag.role,
				reason: "manual",
				confirmed: true,
				projectId: confirmedTag.projectId,
			});
			continue;
		}

		// Expenses are never plot/remittance candidates: the real data contains many small
		// "metro" expenses that mean Dubai Metro travel, not Metro City property payments.
		if (transaction.type === "Expense") continue;

		// Every income is reviewable: a remittance lands as money arriving in the destination
		// account, and its description rarely says so.
		if (transaction.type === "Income") {
			const remittanceKeyword = matchRemittanceKeyword(transaction);
			detected.push({
				transaction,
				suggestedRole: remittanceKeyword ? "remittance" : "income",
				reason: remittanceKeyword ? "keyword" : "inflow",
				matchedKeyword: remittanceKeyword,
				confirmed: false,
			});
			continue;
		}

		const keywordMatch = matchKeywordRole(transaction);
		if (keywordMatch) {
			detected.push({
				transaction,
				suggestedRole: keywordMatch.role,
				reason: "keyword",
				matchedKeyword: keywordMatch.matchedKeyword,
				confirmed: false,
			});
		}

		// A transfer is never suggested as income. In this app a transfer always moves money
		// between the owner's own accounts, so nothing was earned: the reported wealth is
		// unchanged, it only sits somewhere else. Suggesting them double-counted the income
		// that first brought the money in — a remittance recorded as income into a bridge
		// account and then paid onward to a bank was counted twice. Keyword matches above
		// still surface plot payments and explicitly described remittances.
	}

	return detected.sort((first, second) => first.transaction.date - second.transaction.date);
}
