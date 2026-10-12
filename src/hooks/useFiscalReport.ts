import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";

import { db } from "@/lib/db/local";
import { detectReportTransactions } from "@/lib/reports/reportDetection";
import { buildFiscalReport } from "@/lib/reports/reportEngine";

import type { DetectedReportTransaction, FiscalReportSummary } from "@/types";

export interface FiscalReportRange {
	key: string;
	label: string;
	fromMs: number;
	toMs: number;
}

export interface UseFiscalReportResult {
	summary: FiscalReportSummary | undefined;
	detected: DetectedReportTransaction[];
	isLoading: boolean;
}

export interface TransactionDateBounds {
	earliestMs?: number;
	latestMs?: number;
}

const MAX_INDEXED_DB_DATE = 8640000000000000;

/** Earliest and latest transaction timestamps, used to pick sensible fiscal years. */
export function useTransactionDateBounds(userId: string): TransactionDateBounds | undefined {
	return useLiveQuery(async () => {
		if (!userId) return { earliestMs: undefined, latestMs: undefined };

		const earliest = await db.transactions
			.where("[userId+date]")
			.between([userId, 0], [userId, MAX_INDEXED_DB_DATE])
			.first();
		const latest = await db.transactions
			.where("[userId+date]")
			.between([userId, 0], [userId, MAX_INDEXED_DB_DATE])
			.last();

		return { earliestMs: earliest?.date, latestMs: latest?.date };
	}, [userId]);
}

/**
 * Loads every report input from Dexie and recomputes the report on each change.
 * Nothing is ever written back: the summary only exists for the current render.
 */
export function useFiscalReport(
	userId: string,
	range: FiscalReportRange | undefined
): UseFiscalReportResult {
	const data = useLiveQuery(async () => {
		if (!userId) return undefined;

		const [
			accounts,
			transactions,
			accountTags,
			projects,
			transactionTags,
			manualEntries,
			monthlySalaryRows,
		] = await Promise.all([
			db.accounts.where("userId").equals(userId).toArray(),
			db.transactions.where("userId").equals(userId).toArray(),
			db.reportAccountTags.where("userId").equals(userId).toArray(),
			db.reportProjects.where("userId").equals(userId).toArray(),
			db.reportTransactionTags.where("userId").equals(userId).toArray(),
			db.reportManualEntries.where("userId").equals(userId).toArray(),
			db.reportMonthlySalaryRows.where("userId").equals(userId).toArray(),
		]);

		return {
			accounts,
			transactions,
			accountTags,
			projects,
			transactionTags,
			manualEntries,
			monthlySalaryRows,
		};
	}, [userId]);

	const summary = useMemo(() => {
		if (!data || !range) return undefined;

		return buildFiscalReport({
			userId,
			fromMs: range.fromMs,
			toMs: range.toMs,
			rangeKey: range.key,
			rangeLabel: range.label,
			accounts: data.accounts,
			// The engine needs the FULL list: closing balances accumulate from each
			// account's opening balance, not from the start of the selected range.
			transactions: data.transactions,
			accountTags: data.accountTags,
			projects: data.projects,
			transactionTags: data.transactionTags,
			manualEntries: data.manualEntries,
			monthlySalaryRows: data.monthlySalaryRows,
		});
	}, [data, range, userId]);

	const detected = useMemo(() => {
		if (!data || !range) return [];

		return detectReportTransactions({
			transactions: data.transactions,
			accounts: data.accounts,
			existingTags: data.transactionTags,
			fromMs: range.fromMs,
			toMs: range.toMs,
		});
	}, [data, range]);

	return { summary, detected, isLoading: data === undefined || range === undefined };
}
