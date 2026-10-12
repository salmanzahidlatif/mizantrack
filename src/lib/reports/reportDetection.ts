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
function resolveIncludedAccountIds(
	accountTags: ReportAccountTag[] | undefined,
	accountById: Map<string, Account>
): Set<string> {
	const included = new Set(
		(accountTags ?? [])
			.filter((tag) => !tag.deletedAt && tag.includeInReport)
			.map((tag) => tag.accountId)
	);

	if (included.size === 0) return new Set(accountById.keys());
	return included;
}

/**
 * Suggests report roles for transactions inside a range and inside the selected currency.
 * Detection is advisory only: a confirmed user tag always wins, and nothing here mutates
 * or persists anything.
 *
 * Per transaction type:
 * - Income            → ALWAYS a candidate. "remittance" on a remittance keyword, else "income".
 * - Incoming Transfer → ALWAYS a candidate (the destination is an included account).
 *                       Keyword role when one matches, else "income". A remittance can arrive
 *                       as a plain same-currency transfer off a bridge account, with no
 *                       telltale wording, so keyword-only matching would miss most of them.
 * - Outgoing Transfer → a candidate only when a remittance or plot keyword matches.
 * - Expense           → never a candidate.
 */
export function detectReportTransactions(
	params: DetectReportTransactionsParams
): DetectedReportTransaction[] {
	const { transactions, accounts, existingTags, fromMs, toMs, currency, accountTags } = params;

	const accountById = buildAccountCurrencyIndex(accounts);
	const includedAccountIds = resolveIncludedAccountIds(accountTags, accountById);

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
			continue;
		}

		// An incoming transfer is money arriving in an account the user reports on — the other
		// half of the manual bridge-account remittance flow — so it is always reviewable.
		if (transaction.toAccountId && includedAccountIds.has(transaction.toAccountId)) {
			detected.push({
				transaction,
				suggestedRole: "income",
				reason: "inflow",
				confirmed: false,
			});
		}
	}

	return detected.sort((first, second) => first.transaction.date - second.transaction.date);
}
