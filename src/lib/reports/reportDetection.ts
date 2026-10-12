import { currencyCodesMatch } from "@/lib/analytics/balanceMath";

import type {
	Account,
	DetectedReportTransaction,
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

function isCrossCurrencyTransfer(
	transaction: Transaction,
	accountById: Map<string, Account>
): boolean {
	if (!transaction.toAccountId) return false;
	const source = accountById.get(transaction.accountId);
	const destination = accountById.get(transaction.toAccountId);
	if (!source || !destination) return false;
	return !currencyCodesMatch(source.currency, destination.currency);
}

/**
 * Suggests report roles for transactions inside a range. Detection is advisory only:
 * a confirmed user tag always wins, and nothing here mutates or persists anything.
 */
export function detectReportTransactions(
	params: DetectReportTransactionsParams
): DetectedReportTransaction[] {
	const { transactions, accounts, existingTags, fromMs, toMs } = params;

	const accountById = new Map(
		accounts.filter((account) => !account.deletedAt).map((account) => [account.id, account])
	);

	const confirmedTagByTransactionId = new Map<string, ReportTransactionTag>();
	for (const tag of existingTags) {
		if (tag.deletedAt || !tag.confirmed) continue;
		confirmedTagByTransactionId.set(tag.transactionId, tag);
	}

	const detected: DetectedReportTransaction[] = [];

	for (const transaction of transactions) {
		if (transaction.deletedAt) continue;
		if (transaction.date < fromMs || transaction.date > toMs) continue;

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
		if (transaction.type !== "Transfer") continue;

		const keywordMatch = matchKeywordRole(transaction);
		if (keywordMatch) {
			detected.push({
				transaction,
				suggestedRole: keywordMatch.role,
				reason: "keyword",
				matchedKeyword: keywordMatch.matchedKeyword,
				confirmed: false,
			});
			continue;
		}

		if (isCrossCurrencyTransfer(transaction, accountById)) {
			detected.push({
				transaction,
				suggestedRole: "remittance",
				reason: "cross-currency-transfer",
				confirmed: false,
			});
		}
	}

	return detected.sort((first, second) => first.transaction.date - second.transaction.date);
}
