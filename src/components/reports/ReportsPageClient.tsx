"use client";

import { useMemo, useState } from "react";

import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { CategoryBreakdownChart } from "@/components/charts/CategoryDonutChart";
import { TrendChart } from "@/components/charts/TrendBarChart";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { TransactionDrawer } from "@/components/transactions/TransactionDrawer";
import { useActiveAccounts } from "@/hooks/useAccounts";
import { useDbConfig } from "@/hooks/useDbConfig";
import { useTransactions } from "@/hooks/useTransactions";
import { getDateRange } from "@/lib/dateRange";
import { exportToExcel } from "@/lib/export";
import { useFilterStore } from "@/store/filter-store";

import type { DateRange } from "@/types";

interface ReportsPageClientProps {
	userId: string;
}

export function ReportsPageClient({ userId }: ReportsPageClientProps) {
	const config = useDbConfig(userId);
	const currency = config?.currency ?? "AED";
	const fiscalYearStartMonth = config?.fiscalYearStartMonth ?? 7;

	const accounts = useActiveAccounts(userId);
	const { period, accountId, customRange, setAccountId } = useFilterStore();

	const { from, to } = getDateRange(period, fiscalYearStartMonth, customRange ?? undefined);

	const transactions = useTransactions(userId, {
		accountId: accountId ?? undefined,
		from: from.getTime(),
		to: to.getTime(),
	});

	// Export dialog state
	const [exportOpen, setExportOpen] = useState(false);
	const [exportRange, setExportRange] = useState<DateRange>({ from, to });
	const [exporting, setExporting] = useState(false);

	const { income, expense, net } = useMemo(() => {
		if (!transactions) return { income: 0, expense: 0, net: 0 };
		let inc = 0;
		let exp = 0;
		for (const t of transactions) {
			if (t.type === "Income") inc += t.amount;
			else if (t.type === "Expense") exp += t.amount;
		}
		return { income: inc, expense: exp, net: inc - exp };
	}, [transactions]);

	async function handleExport() {
		setExporting(true);
		try {
			await exportToExcel(userId, exportRange);
		} catch {
			toast.error("Export failed. Please try again.");
		} finally {
			setExporting(false);
			setExportOpen(false);
		}
	}

	return (
		<div className="space-y-5">
			{/* Header */}
			<div className="flex items-start justify-between gap-2">
				<div>
					<h1 className="text-2xl font-bold">Reports</h1>
					<p className="text-sm text-muted-foreground">Analyse your spending</p>
				</div>
				<Button
					size="sm"
					variant="outline"
					className="shrink-0"
					onClick={() => {
						setExportRange({ from, to });
						setExportOpen(true);
					}}>
					<Download className="mr-1.5 h-3.5 w-3.5" />
					Export
				</Button>
			</div>

			{/* Export dialog */}
			<Dialog open={exportOpen} onOpenChange={setExportOpen}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>Export to Excel</DialogTitle>
					</DialogHeader>
					<div className="space-y-3 py-2">
						<p className="text-sm text-muted-foreground">Select date range to export:</p>
						<DateRangePicker
							standalone
							value={exportRange}
							onChange={setExportRange}
							fiscalYearStartMonth={fiscalYearStartMonth}
						/>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setExportOpen(false)}>
							Cancel
						</Button>
						<Button onClick={() => { void handleExport(); }} disabled={exporting}>
							{exporting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
							Download
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Filters */}
			<div className="space-y-2">
				<DateRangePicker fiscalYearStartMonth={fiscalYearStartMonth} />

				{/* Account filter */}
				<Select
					value={accountId ?? "all"}
					onValueChange={(v) => setAccountId(v === "all" ? null : v)}>
					<SelectTrigger className="h-8 w-auto min-w-[150px] text-xs">
						<SelectValue placeholder="All Accounts" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all" className="text-xs">
							All Accounts
						</SelectItem>
						{(accounts ?? []).map((a) => (
							<SelectItem key={a.id} value={a.id} className="text-xs">
								{a.title}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{/* Summary strip */}
			{transactions === undefined ? (
				<div className="grid grid-cols-3 gap-3">
					{Array.from({ length: 3 }).map((_, i) => (
						<SkeletonCard key={i} className="h-16" />
					))}
				</div>
			) : (
				<div className="grid grid-cols-3 gap-3">
					{[
						{ label: "Income", amount: income, variant: "positive" as const },
						{ label: "Expenses", amount: -expense, variant: "negative" as const },
						{ label: "Net", amount: net, variant: (net >= 0 ? "positive" : "negative") as "positive" | "negative" },
					].map(({ label, amount, variant }) => (
						<div key={label} className="rounded-xl border border-border bg-card p-3 text-center">
							<p className="mb-1 text-xs text-muted-foreground">{label}</p>
							<CurrencyAmount amount={amount} currency={currency} variant={variant} />
						</div>
					))}
				</div>
			)}

			{/* Category breakdown donut */}
			{transactions === undefined ? (
				<div className="h-64 animate-pulse rounded-xl bg-muted" />
			) : (
				<CategoryBreakdownChart userId={userId} transactions={transactions} />
			)}

			{/* Monthly trend chart */}
			<TrendChart userId={userId} months={6} />

			{/* Drawer — FAB support */}
			<TransactionDrawer userId={userId} />
		</div>
	);
}
