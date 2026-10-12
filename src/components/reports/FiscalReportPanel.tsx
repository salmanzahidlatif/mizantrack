"use client";

import { endOfDay, format, startOfDay } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { ReportAccountsSection } from "@/components/reports/ReportAccountsSection";
import { ReportIncomesSection } from "@/components/reports/ReportIncomesSection";
import { ReportManualEntriesSection } from "@/components/reports/ReportManualEntriesSection";
import {
	ReportPeriodSelector,
	type ReportPeriodMode,
} from "@/components/reports/ReportPeriodSelector";
import { ReportProjectsSection } from "@/components/reports/ReportProjectsSection";
import { ReportRemittancesSection } from "@/components/reports/ReportRemittancesSection";
import { ReportReviewSection } from "@/components/reports/ReportReviewSection";
import { ReportSalaryGrid } from "@/components/reports/ReportSalaryGrid";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useAccounts } from "@/hooks/useAccounts";
import { useDbConfig } from "@/hooks/useDbConfig";
import { useFiscalReport, useTransactionDateBounds } from "@/hooks/useFiscalReport";
import { normalizeCurrencyCode, resolveCurrencyCode } from "@/lib/analytics/balanceMath";
import { db } from "@/lib/db/local";
import { CARD_SURFACE } from "@/lib/motion";
import { exportFiscalReport } from "@/lib/reports/reportExport";
import { listFiscalYearOptions } from "@/lib/reports/reportFiscalYears";
import { cn } from "@/lib/utils";
import { useFilterStore } from "@/store/filter-store";

import type { FiscalReportRange } from "@/hooks/useFiscalReport";
import type { DateRange } from "@/types";

interface FiscalReportPanelProps {
	userId: string;
}

export function FiscalReportPanel({ userId }: FiscalReportPanelProps) {
	const config = useDbConfig(userId);
	const { activeCurrency } = useFilterStore();
	const defaultCurrency = resolveCurrencyCode(activeCurrency, config?.currency);
	const fiscalYearStartMonth = config?.fiscalYearStartMonth ?? 7;

	const bounds = useTransactionDateBounds(userId);
	const accounts = useAccounts(userId, { showArchived: true });
	const projects = useLiveQuery(
		() =>
			db.reportProjects
				.where("userId")
				.equals(userId)
				.filter((project) => !project.deletedAt)
				.toArray(),
		[userId]
	);

	const [selectedKey, setSelectedKey] = useState<string | null>(null);
	const [mode, setMode] = useState<ReportPeriodMode>("fiscal-year");
	const [customRange, setCustomRange] = useState<DateRange | undefined>(undefined);
	const [selectedCurrency, setSelectedCurrency] = useState<string | null>(null);

	const fiscalYearOptions = useMemo(
		() =>
			listFiscalYearOptions({
				fiscalYearStartMonth,
				earliestTransactionMs: bounds?.earliestMs,
			}),
		[fiscalYearStartMonth, bounds?.earliestMs]
	);

	// Default to the newest fiscal year that actually contains transactions.
	const defaultKey = useMemo(() => {
		const latestMs = bounds?.latestMs;
		const withData =
			latestMs === undefined
				? undefined
				: fiscalYearOptions.find((option) => latestMs >= option.fromMs && latestMs <= option.toMs);
		return withData?.key ?? fiscalYearOptions[0]?.key ?? "";
	}, [bounds?.latestMs, fiscalYearOptions]);

	const activeKey =
		selectedKey && fiscalYearOptions.some((option) => option.key === selectedKey)
			? selectedKey
			: defaultKey;

	const range = useMemo<FiscalReportRange | undefined>(() => {
		if (mode === "custom") {
			if (!customRange) return undefined;
			const fromMs = startOfDay(customRange.from).getTime();
			const toMs = endOfDay(customRange.to).getTime();
			return {
				key: `custom-${fromMs}-${toMs}`,
				label: `${format(fromMs, "d MMM yyyy")} – ${format(toMs, "d MMM yyyy")}`,
				fromMs,
				toMs,
			};
		}

		const option = fiscalYearOptions.find((item) => item.key === activeKey);
		if (!option) return undefined;
		return { key: option.key, label: option.label, fromMs: option.fromMs, toMs: option.toMs };
	}, [activeKey, customRange, fiscalYearOptions, mode]);

	const currencyOptions = useMemo(() => {
		const codes = new Set<string>();
		const fallback = normalizeCurrencyCode(defaultCurrency);
		if (fallback) codes.add(fallback);
		for (const account of accounts ?? []) {
			const code = normalizeCurrencyCode(account.currency);
			if (code) codes.add(code);
		}
		return [...codes].sort((first, second) => first.localeCompare(second));
	}, [accounts, defaultCurrency]);

	// One currency scopes the ENTIRE report: accounts, review queue, remittances, incomes,
	// plot payments and the export. The app-wide active currency is only the starting point.
	const reportCurrency =
		selectedCurrency && currencyOptions.includes(selectedCurrency)
			? selectedCurrency
			: normalizeCurrencyCode(defaultCurrency);

	const { summary, detected, isLoading } = useFiscalReport(userId, range, reportCurrency);

	const accountsById = useMemo(
		() => new Map((accounts ?? []).map((account) => [account.id, account])),
		[accounts]
	);

	function handleExport() {
		if (!summary) return;

		try {
			exportFiscalReport(summary);
			toast.success("Report exported.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Export failed. Please try again.");
		}
	}

	return (
		<div className="space-y-5" aria-busy={isLoading}>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<p className="text-sm text-muted-foreground">
					{summary
						? `Fiscal report for ${summary.rangeLabel} — ${reportCurrency} only`
						: "Choose a period to build a report"}
				</p>
				<div className="flex items-center gap-2">
					<Select
						value={reportCurrency}
						onValueChange={setSelectedCurrency}
						disabled={currencyOptions.length < 2}>
						<SelectTrigger size="sm" className="w-28" aria-label="Report currency">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{currencyOptions.map((code) => (
								<SelectItem key={code} value={code}>
									{code}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button size="sm" variant="outline" disabled={!summary} onClick={handleExport}>
						<Download className="mr-1.5 h-3.5 w-3.5" />
						Export
					</Button>
				</div>
			</div>

			<p className="text-xs text-muted-foreground">
				This report covers {reportCurrency} only. Amounts are never converted — switch the currency
				to report on another one.
			</p>

			<ReportPeriodSelector
				options={fiscalYearOptions}
				selectedKey={activeKey}
				onSelectFiscalYear={setSelectedKey}
				mode={mode}
				onModeChange={setMode}
				customRange={customRange}
				onCustomRangeChange={setCustomRange}
				fiscalYearStartMonth={fiscalYearStartMonth}
				range={range}
			/>

			{summary && summary.warnings.length > 0 && (
				<div className="space-y-2" role="status">
					{summary.warnings.map((warning) => (
						<p
							key={warning}
							className={cn(
								CARD_SURFACE,
								"flex items-start gap-2 border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300"
							)}>
							<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
							<span>{warning}</span>
						</p>
					))}
				</div>
			)}

			{!summary || !range ? (
				<div className="space-y-4">
					{mode === "custom" && !customRange ? (
						<p className={cn(CARD_SURFACE, "p-6 text-center text-sm text-muted-foreground")}>
							Pick a custom date range to build the report.
						</p>
					) : (
						<>
							<SkeletonCard className="h-40" />
							<SkeletonCard className="h-52" />
							<SkeletonCard className="h-40" />
						</>
					)}
				</div>
			) : (
				<>
					<ReportAccountsSection
						userId={userId}
						accounts={accounts ?? []}
						balances={summary.accountBalances}
						currency={reportCurrency}
					/>

					<ReportReviewSection
						userId={userId}
						detected={detected}
						accountsById={accountsById}
						projects={projects ?? []}
					/>

					<ReportRemittancesSection
						remittances={summary.remittances}
						total={summary.remittanceTotal}
					/>

					<ReportIncomesSection incomes={summary.incomes} total={summary.incomeTotal} />

					<ReportProjectsSection
						userId={userId}
						projects={projects ?? []}
						groups={summary.projectGroups}
						grandTotal={summary.projectGrandTotal}
					/>

					<ReportManualEntriesSection
						userId={userId}
						entries={summary.manualEntries}
						currencies={currencyOptions}
						defaultCurrency={reportCurrency}
						fiscalYearKey={summary.rangeKey}
					/>

					<ReportSalaryGrid
						userId={userId}
						fiscalYearKey={summary.rangeKey}
						fromMs={summary.fromMs}
						toMs={summary.toMs}
						rows={summary.monthlySalaryRows}
					/>
				</>
			)}
		</div>
	);
}
