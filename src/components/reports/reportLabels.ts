import type { DetectedReportTransaction, ReportTransactionRole } from "@/types";

export const REPORT_ROLE_OPTIONS: Array<{ value: ReportTransactionRole; label: string }> = [
	{ value: "remittance", label: "Remittance" },
	{ value: "plot-payment", label: "Plot payment" },
	{ value: "income", label: "Income" },
	{ value: "excluded", label: "Excluded" },
];

export function getReportRoleLabel(role: ReportTransactionRole): string {
	return REPORT_ROLE_OPTIONS.find((option) => option.value === role)?.label ?? role;
}

/** Explains, in the user's words, why a transaction was suggested. */
export function getDetectionReasonLabel(detected: DetectedReportTransaction): string {
	switch (detected.reason) {
		case "keyword":
			return detected.matchedKeyword
				? `Matched the keyword "${detected.matchedKeyword}"`
				: "Matched a report keyword";
		case "inflow":
			return "Money received into an included account — tag it so it counts";
		case "account-flag":
			return "Account is marked as a remittance source";
		case "manual":
			return "Tagged by you";
		default:
			return "Suggested automatically";
	}
}
