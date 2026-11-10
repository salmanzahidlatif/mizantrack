import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";

import type { Category } from "@/types";

/**
 * Keywords that mark an income category as salary-like.
 *
 * Every keyword is matched on word boundaries (see `matchesKeyword`), so "payroll" never
 * matches "Payment to landlord" or "Paypal". Only precise earnings terms belong here —
 * generic stems silently fold unrelated money into the salary run-rate:
 * - "income" would swallow "Rental Income", "Interest Income", "Dividend Income";
 * - bare "pay" would swallow "Google Pay Cashback";
 * - "pension" and "allowance" are rarely employment pay for a working user ("Allowance
 *   from parents", a retirement pension), so they are left out of auto-detection — a user
 *   who wants them counted can still select the category explicitly.
 */
export const SALARY_CATEGORY_KEYWORDS: readonly string[] = [
	"salary",
	"salaries",
	"payroll",
	"paycheck",
	"paycheque",
	"pay cheque",
	"pay check",
	"take home",
	"wage",
	"wages",
	"stipend",
	"gratuity",
	"provident fund",
	"bonus",
	"commission",
	"commissions",
	"overtime",
] as const;

/**
 * Terms that disqualify a title even when it also contains a salary keyword.
 *
 * "Salary Advance Repayment" is a deduction, "Income Tax Refund" is not earnings, and
 * "Rental Income" / "Interest Income" / "Dividend Income" are investment returns.
 */
export const SALARY_CATEGORY_NEGATIVE_KEYWORDS: readonly string[] = [
	"tax",
	"refund",
	"loan",
	"advance",
	"advances",
	"repayment",
	"repayments",
	"rental",
	"rent",
	"interest",
	"dividend",
	"dividends",
	"cashback",
	"reimbursement",
	"reimbursements",
] as const;

function normalizeTitle(title: string): string {
	return title
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesKeyword(title: string, keyword: string): boolean {
	const escaped = escapeRegExp(keyword).replace(/\s+/g, "\\s+");
	return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(title);
}

/** True when a category title looks salary-like and carries no disqualifying term. */
export function isSalaryCategoryTitle(title: string): boolean {
	const normalizedTitle = normalizeTitle(title ?? "");
	if (!normalizedTitle.trim()) return false;

	if (
		SALARY_CATEGORY_NEGATIVE_KEYWORDS.some((keyword) => matchesKeyword(normalizedTitle, keyword))
	) {
		return false;
	}

	return SALARY_CATEGORY_KEYWORDS.some((keyword) => matchesKeyword(normalizedTitle, keyword));
}

export interface SalaryCategoryMatch {
	/** Ids of income categories whose titles matched a salary keyword. */
	categoryIds: string[];
	/** Matched categories, for UI display. */
	categories: Category[];
}

function categoryMatchesScope(category: Category, userId: string, currency: string): boolean {
	if (category.userId !== userId || category.deletedAt || category.type !== "Income") return false;
	return !category.currency || normalizeCurrencyCode(category.currency) === currency;
}

/**
 * Auto-detect salary categories among the user's Income categories,
 * scoped to `currency` (untagged legacy categories match any currency).
 */
export function detectSalaryCategories(
	userId: string,
	categories: Category[],
	currency: string
): SalaryCategoryMatch {
	const normalizedCurrency = normalizeCurrencyCode(currency);
	const matched = categories
		.filter(
			(category) =>
				categoryMatchesScope(category, userId, normalizedCurrency) &&
				isSalaryCategoryTitle(category.title)
		)
		.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));

	return {
		categoryIds: matched.map((category) => category.id),
		categories: matched,
	};
}
