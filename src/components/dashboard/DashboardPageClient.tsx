"use client";

import {
	CalendarDays,
	ChevronLeft,
	ChevronRight,
	Plus,
	TrendingDown,
	TrendingUp,
	WalletCards,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	AnalyticsIntervalChooser,
	getIntervalLabel,
} from "@/components/dashboard/AnalyticsIntervalChooser";
import {
	DASHBOARD_GRID_CELL_CLASSNAMES,
	DASHBOARD_GRID_CLASSNAME,
} from "@/components/dashboard/dashboardGrid";
import {
	clampDashboardMonth,
	isCurrentDashboardMonth,
	shiftDashboardMonth,
} from "@/components/dashboard/monthData";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { SkeletonChart } from "@/components/shared/SkeletonChart";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useAccountsAnalytics } from "@/hooks/useAccountsAnalytics";
import { useAnalyticsMonthSummaries } from "@/hooks/useAnalyticsMonthSummaries";
import { useBudgets, type BudgetProgressRow } from "@/hooks/useBudgets";
import { useDbConfig } from "@/hooks/useDbConfig";
import { useHaptics } from "@/hooks/useHaptics";
import { usePeriodAnalytics } from "@/hooks/usePeriodAnalytics";
import { useRequiredUserId } from "@/hooks/useRequiredUserId";
import { resolveCurrencyCode } from "@/lib/analytics/balanceMath";
import {
	getLocalTimeZoneOffsetMinutes,
	getMonthKey,
	getMonthStripRanges,
	resolveAnalyticsPeriod,
	type AnalyticsInterval,
	type MonthRange,
} from "@/lib/dateRange";
import { CARD_SURFACE, LIST_ROW, PRESS_SCALE, TAPPABLE, staggerDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useFilterStore } from "@/store/filter-store";
import { useUIStore } from "@/store/ui-store";

import type {
	AccountsAnalytics,
	AnalyticsMonthSummaryItem,
	PeriodAnalytics,
	PeriodAnalyticsQuery,
} from "@/lib/analytics/periodAnalytics";

const CategoryBreakdownChart = dynamic(
	() => import("@/components/charts/CategoryDonutChart").then((mod) => mod.CategoryBreakdownChart),
	{
		loading: () => <SkeletonChart className="md:h-full md:w-full" chartClassName="h-32 md:h-36" />,
	}
);

const CashFlowTrendChart = dynamic(
	() => import("@/components/charts/DashboardDesktopCharts").then((mod) => mod.CashFlowTrendChart),
	{
		loading: () => (
			<SkeletonChart className="md:h-full md:w-full md:p-5" chartClassName="h-56 md:h-72" />
		),
	}
);

const SpendingTrendChart = dynamic(
	() => import("@/components/charts/DashboardDesktopCharts").then((mod) => mod.SpendingTrendChart),
	{
		loading: () => (
			<SkeletonChart className="md:h-full md:w-full md:p-5" chartClassName="h-40 md:h-48" />
		),
	}
);

const AccountDistributionChart = dynamic(
	() =>
		import("@/components/charts/DashboardDesktopCharts").then(
			(mod) => mod.AccountDistributionChart
		),
	{
		loading: () => (
			<SkeletonChart className="md:h-full md:w-full md:p-5" chartClassName="h-36 md:h-44" />
		),
	}
);

interface DashboardPageClientProps {
	userId?: string;
}

interface MonthStripProps {
	userId: string;
	currency: string;
	selectedMonth: Date;
	now: Date;
	timeZoneOffsetMinutes: number;
	onChangeMonth: (delta: number) => void;
	onSelectMonth: (month: Date) => void;
	onOpenInterval: () => void;
}

interface SummarySplitCardProps {
	analytics?: PeriodAnalytics;
	currency: string;
	periodLabel: string;
	className?: string;
}

interface WhatYouHaveCardProps {
	analytics?: AccountsAnalytics;
	onAddAccount: () => void;
	includeFutureDatedBalances: boolean;
	className?: string;
}

function sortDashboardAccounts(accounts: AccountsAnalytics["accounts"]) {
	return accounts
		.map((account, index) => ({ account, index }))
		.filter(({ account }) => !account.isArchived)
		.sort((a, b) => {
			const zeroA = a.account.balance === 0 ? 1 : 0;
			const zeroB = b.account.balance === 0 ? 1 : 0;
			if (zeroA !== zeroB) return zeroA - zeroB;

			const balanceDiff = b.account.balance - a.account.balance;
			if (balanceDiff !== 0) return balanceDiff;

			return a.index - b.index;
		})
		.map(({ account }) => account);
}

function useMonthSwipe(onChangeMonth: (delta: number) => void, canGoNext: boolean) {
	const ref = useRef<HTMLDivElement>(null);
	const gestureRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);

	useEffect(() => {
		const node = ref.current;
		if (!node || typeof window.PointerEvent === "undefined") return;

		const handlePointerDown = (event: PointerEvent) => {
			if (!event.isPrimary || event.pointerType !== "touch") return;
			gestureRef.current = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
			};
		};

		const handlePointerUp = (event: PointerEvent) => {
			const gesture = gestureRef.current;
			if (gesture?.pointerId !== event.pointerId) return;

			gestureRef.current = null;
			const deltaX = event.clientX - gesture.startX;
			const deltaY = event.clientY - gesture.startY;
			if (Math.abs(deltaX) < 56 || Math.abs(deltaX) < Math.abs(deltaY) * 1.15) return;
			if (deltaX < 0 && !canGoNext) return;

			onChangeMonth(deltaX > 0 ? -1 : 1);
		};

		const cancelGesture = () => {
			gestureRef.current = null;
		};

		node.addEventListener("pointerdown", handlePointerDown, { passive: true });
		node.addEventListener("pointerup", handlePointerUp, { passive: true });
		node.addEventListener("pointercancel", cancelGesture, { passive: true });

		return () => {
			node.removeEventListener("pointerdown", handlePointerDown);
			node.removeEventListener("pointerup", handlePointerUp);
			node.removeEventListener("pointercancel", cancelGesture);
		};
	}, [canGoNext, onChangeMonth]);

	return ref;
}

function isFutureMonth(range: Pick<MonthRange, "date">, now: Date) {
	return getMonthKey(range.date) > getMonthKey(now);
}

function normalizeMonthRanges(
	summaries: AnalyticsMonthSummaryItem[] | undefined,
	selectedMonth: Date,
	timeZoneOffsetMinutes: number
) {
	return (
		summaries?.map((summary) => ({
			date: summary.from,
			key: summary.key,
			label: summary.label,
			shortLabel: summary.month,
			from: summary.from,
			to: summary.to,
			fromMs: summary.fromMs,
			toMs: summary.toMs,
		})) ??
		getMonthStripRanges(selectedMonth, {
			months: 5,
			timeZoneOffsetMinutes,
		})
	);
}

function MonthStrip({
	userId,
	currency,
	selectedMonth,
	now,
	timeZoneOffsetMinutes,
	onChangeMonth,
	onSelectMonth,
	onOpenInterval,
}: MonthStripProps) {
	const summaries = useAnalyticsMonthSummaries(userId, {
		currency,
		months: 5,
		anchorDate: selectedMonth,
		mode: "around",
		timeZoneOffsetMinutes,
	});
	const ranges = useMemo(
		() => normalizeMonthRanges(summaries, selectedMonth, timeZoneOffsetMinutes),
		[summaries, selectedMonth, timeZoneOffsetMinutes]
	);
	const selectedKey = getMonthKey(selectedMonth, { timeZoneOffsetMinutes });
	const canGoNext = !isCurrentDashboardMonth(selectedMonth, now);

	return (
		<section className="space-y-2" aria-labelledby="dashboard-month-heading">
			<div className={cn(CARD_SURFACE, "p-2")}>
				<div className="flex items-center gap-1">
					<button
						type="button"
						aria-label="Previous month"
						onClick={() => onChangeMonth(-1)}
						className={cn(
							"flex h-10 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground",
							PRESS_SCALE,
							TAPPABLE
						)}>
						<ChevronLeft className="h-4 w-4" />
					</button>
					<div
						data-swipe-navigation-ignore
						className="no-scrollbar flex min-w-0 flex-1 snap-x gap-1 overflow-x-auto"
						aria-label="Select dashboard month">
						{ranges.map((range) => {
							const selected = range.key === selectedKey;
							const disabled = isFutureMonth(range, now);

							return (
								<button
									key={range.key}
									type="button"
									aria-label={`${range.label}${selected ? ", selected" : ""}`}
									aria-current={selected ? "date" : undefined}
									aria-pressed={selected}
									disabled={disabled}
									onClick={() => onSelectMonth(range.date)}
									className={cn(
										"snap-center rounded-2xl px-3 py-2 text-center transition-colors disabled:pointer-events-none disabled:opacity-30",
										selected
											? "bg-primary text-primary-foreground shadow-sm"
											: "text-muted-foreground hover:bg-muted hover:text-foreground",
										PRESS_SCALE,
										TAPPABLE
									)}>
									<span className="block text-xs font-semibold whitespace-nowrap">
										{range.label}
									</span>
								</button>
							);
						})}
					</div>
					<button
						type="button"
						aria-label="Next month"
						disabled={!canGoNext}
						onClick={() => onChangeMonth(1)}
						className={cn(
							"flex h-10 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35",
							PRESS_SCALE,
							TAPPABLE
						)}>
						<ChevronRight className="h-4 w-4" />
					</button>
					<button
						type="button"
						aria-label="Choose interval"
						onClick={onOpenInterval}
						className={cn(
							"flex h-10 w-10 items-center justify-center rounded-full bg-muted text-foreground hover:bg-muted/80",
							PRESS_SCALE,
							TAPPABLE
						)}>
						<CalendarDays className="h-4 w-4" />
					</button>
				</div>
			</div>
			<h2 id="dashboard-month-heading" className="sr-only">
				Dashboard month
			</h2>
			<p className="sr-only" aria-live="polite">
				Showing {getMonthKey(selectedMonth, { timeZoneOffsetMinutes })}.
			</p>
		</section>
	);
}

function WhatYouHaveSkeleton({ className }: { className?: string }) {
	return (
		<section
			className={cn(CARD_SURFACE, "overflow-hidden p-4 md:flex md:h-full md:flex-col", className)}
			aria-busy="true"
			data-testid="what-you-have-skeleton">
			<p className="sr-only" role="status">
				Loading account balances
			</p>
			<div aria-hidden="true">
				<div className="mb-4 flex items-start justify-between gap-3">
					<div className="space-y-2">
						<div className="shimmer h-4 w-28 rounded-full bg-muted/70" />
						<div className="shimmer h-9 w-44 rounded-full bg-muted/70" />
					</div>
					<div className="shimmer h-5 w-5 rounded-full bg-muted/70" />
				</div>
				<div className="grid grid-cols-2 gap-2">
					{Array.from({ length: 5 }).map((_, index) => (
						<div
							key={index}
							className={cn("min-h-[72px] rounded-2xl border border-border/60 bg-muted/35 p-3")}>
							<div className="shimmer h-3 w-20 rounded-full bg-muted/70" />
							<div className="shimmer mt-2 h-5 w-24 rounded-full bg-muted/70" />
						</div>
					))}
					<div className="min-h-[72px] rounded-2xl border border-dashed border-border/80 bg-muted/20 p-3" />
				</div>
				<div className="mt-4 flex justify-end">
					<div className="shimmer h-5 w-20 rounded-full bg-muted/70" />
				</div>
			</div>
		</section>
	);
}

function BalanceBasisBadge({
	includeFutureDatedBalances,
}: {
	includeFutureDatedBalances: boolean;
}) {
	return (
		<span
			className={cn(
				"rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-[0.14em] uppercase",
				includeFutureDatedBalances
					? "border-primary/40 bg-primary/10 text-primary"
					: "border-border/70 bg-background/70 text-muted-foreground"
			)}>
			{includeFutureDatedBalances ? "Incl. future" : "As of today"}
		</span>
	);
}

function WhatYouHaveCard({
	analytics,
	onAddAccount,
	includeFutureDatedBalances,
	className,
}: WhatYouHaveCardProps) {
	if (!analytics) {
		return <WhatYouHaveSkeleton className={className} />;
	}

	const accounts = sortDashboardAccounts(analytics.accounts).slice(0, 5);

	return (
		<section
			className={cn(CARD_SURFACE, "overflow-hidden p-4 md:flex md:h-full md:flex-col", className)}
			aria-labelledby="what-you-have"
			data-testid="what-you-have-card">
			<div className="mb-4 flex items-start justify-between gap-3">
				<div>
					<p id="what-you-have" className="text-sm font-semibold">
						What You Have
					</p>
					<p className="mt-1 text-xs text-muted-foreground">
						{includeFutureDatedBalances
							? "Net worth (including future)"
							: "Net worth (as of today)"}
					</p>
					<CurrencyAmount
						amount={analytics.netWorth}
						currency={analytics.currency}
						colorized
						showNegativeSign
						className="mt-2 block text-3xl leading-9"
					/>
				</div>
				<span className="flex shrink-0 flex-col items-end gap-2">
					<BalanceBasisBadge includeFutureDatedBalances={includeFutureDatedBalances} />
					<WalletCards className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
				</span>
			</div>

			<div className="grid grid-cols-2 gap-2">
				{accounts.map((account, index) => (
					<Link
						key={account.accountId}
						href="/accounts"
						data-testid="dashboard-account-tile"
						data-account-id={account.accountId}
						data-balance={account.balance}
						className={cn(
							"press min-h-[72px] rounded-2xl border border-border/60 bg-muted/35 p-3 text-left",
							LIST_ROW
						)}
						style={staggerDelay(index, 30)}>
						<p className="truncate text-xs font-medium text-muted-foreground">{account.title}</p>
						<CurrencyAmount
							amount={account.balance}
							currency={account.currency}
							colorized
							showNegativeSign
							className="mt-1 block truncate text-sm leading-5"
						/>
					</Link>
				))}
				<button
					type="button"
					onClick={onAddAccount}
					className={cn(
						"press flex min-h-[72px] flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-muted/20 p-3 text-xs font-semibold text-muted-foreground",
						TAPPABLE
					)}>
					<Plus className="mb-1 h-4 w-4" aria-hidden="true" />
					Add Account
				</button>
			</div>

			<div className="mt-4 flex justify-end">
				<Button asChild variant="link" size="sm" className="h-auto px-0 text-xs font-bold">
					<Link href="/accounts">VIEW MORE</Link>
				</Button>
			</div>
		</section>
	);
}

function SummarySplitCard({ analytics, currency, periodLabel, className }: SummarySplitCardProps) {
	if (!analytics) {
		return <SkeletonCard className={cn("h-28 md:h-full", className)} />;
	}

	const items = [
		{
			label: "Income",
			amount: analytics.income,
			variant: "positive" as const,
			icon: TrendingUp,
			underline: "bg-emerald-500",
		},
		{
			label: "Expense",
			amount: analytics.expense,
			variant: "negative" as const,
			icon: TrendingDown,
			underline: "bg-red-500",
		},
	];

	return (
		<section
			className={cn(CARD_SURFACE, "overflow-hidden md:flex md:h-full md:flex-col", className)}
			aria-label={`Income and expense for ${periodLabel}`}>
			<div className="grid grid-cols-2 divide-x divide-border/60 md:min-h-0 md:flex-1">
				{items.map(({ label, amount, variant, icon: Icon, underline }) => (
					<Link
						key={label}
						href="/transactions"
						className="press relative min-h-28 p-4 text-left md:flex md:min-h-full md:flex-col md:justify-between">
						<div className="mb-3 flex items-center justify-between gap-2 md:mb-0">
							<span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
								<Icon className="h-4 w-4" aria-hidden="true" />
							</span>
							<ChevronRight className="h-4 w-4 text-muted-foreground/60" aria-hidden="true" />
						</div>
						<div className="md:pt-4">
							<CurrencyAmount
								amount={amount}
								currency={currency}
								variant={variant}
								className="block text-lg leading-6 tabular-nums"
							/>
							<p className="mt-1 text-xs font-medium text-muted-foreground">{label}</p>
						</div>
						<span
							className={cn("absolute right-4 bottom-0 left-4 h-1 rounded-t-full", underline)}
						/>
					</Link>
				))}
			</div>
		</section>
	);
}

function DesktopMetricStrip({
	analytics,
	currency,
}: {
	analytics?: PeriodAnalytics;
	currency: string;
}) {
	if (!analytics) {
		return (
			<section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-busy="true">
				{Array.from({ length: 4 }).map((_, index) => (
					<SkeletonCard key={index} className="h-24 md:h-28" />
				))}
			</section>
		);
	}

	const savingsRate = analytics.income > 0 ? (analytics.net / analytics.income) * 100 : 0;
	const topExpenseCategory = analytics.expenseBreakdown.reduce<
		PeriodAnalytics["expenseBreakdown"][number] | undefined
	>((topCategory, category) => {
		if (!topCategory || category.amount > topCategory.amount) return category;
		return topCategory;
	}, undefined);
	const metrics: Array<{ label: string; value: ReactNode; helper: ReactNode }> = [
		{
			label: "Net cash flow",
			value: (
				<CurrencyAmount
					amount={analytics.net}
					currency={currency}
					colorized
					showNegativeSign
					className="text-lg leading-6 tabular-nums md:text-xl md:leading-7"
				/>
			),
			helper: analytics.period.label,
		},
		{
			label: "Savings rate",
			value: (
				<span
					className={cn(
						"text-lg leading-6 font-semibold tabular-nums md:text-xl md:leading-7",
						savingsRate >= 0
							? "text-emerald-600 dark:text-emerald-400"
							: "text-red-600 dark:text-red-400"
					)}>
					{Math.round(savingsRate)}%
				</span>
			),
			helper: "Net ÷ income",
		},
		{
			label: "Top expense",
			value: topExpenseCategory ? (
				<span className="block truncate text-lg leading-6 font-semibold md:text-xl md:leading-7">
					{topExpenseCategory.title}
				</span>
			) : (
				<span className="text-lg leading-6 font-semibold md:text-xl md:leading-7">—</span>
			),
			helper: topExpenseCategory ? (
				<>
					<CurrencyAmount
						amount={topExpenseCategory.amount}
						currency={currency}
						variant="negative"
						className="text-[11px] leading-4"
					/>{" "}
					spent
				</>
			) : (
				"No expenses in period"
			),
		},
		{
			label: "Transactions",
			value: (
				<span className="text-lg leading-6 font-semibold tabular-nums md:text-xl md:leading-7">
					{analytics.transactionCount}
				</span>
			),
			helper: "Income and expenses",
		},
	];

	return (
		<section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Financial overview">
			{metrics.map((metric) => (
				<div key={metric.label} className={cn(CARD_SURFACE, "min-h-24 p-3 md:min-h-28 md:p-4")}>
					<p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
					<div className="mt-2">{metric.value}</div>
					<div className="mt-2 text-[11px] leading-4 text-muted-foreground">{metric.helper}</div>
				</div>
			))}
		</section>
	);
}

function BudgetProgressPanel({
	rows,
	isLoading,
	currency,
	periodLabel,
}: {
	rows: BudgetProgressRow[];
	isLoading: boolean;
	currency: string;
	periodLabel: string;
}) {
	if (isLoading) {
		return (
			<section
				className={cn(CARD_SURFACE, "overflow-hidden p-4 md:h-full md:w-full md:p-5")}
				aria-busy="true">
				<div className="shimmer mb-4 h-4 w-32 rounded-full bg-muted/70" />
				<div className="space-y-4">
					{Array.from({ length: 4 }).map((_, index) => (
						<div key={index}>
							<div className="mb-2 flex justify-between gap-4">
								<div className="shimmer h-3 w-28 rounded-full bg-muted/70" />
								<div className="shimmer h-3 w-20 rounded-full bg-muted/70" />
							</div>
							<div className="shimmer h-2 w-full rounded-full bg-muted/70" />
						</div>
					))}
				</div>
			</section>
		);
	}

	const visibleRows = rows.slice(0, 4);

	return (
		<section
			className={cn(CARD_SURFACE, "overflow-hidden p-4 md:h-full md:w-full md:p-5")}
			aria-labelledby="budget-progress-title">
			<div className="mb-4 flex items-start justify-between gap-3">
				<div>
					<h2 id="budget-progress-title" className="text-sm font-semibold">
						Budget progress
					</h2>
					<p className="mt-1 text-xs text-muted-foreground">{periodLabel}</p>
				</div>
				<Button asChild variant="link" size="sm" className="h-auto px-0 text-xs font-bold">
					<Link href="/budgets">VIEW BUDGETS</Link>
				</Button>
			</div>

			{visibleRows.length === 0 ? (
				<div className="flex min-h-40 flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 p-5 text-center">
					<p className="text-sm font-semibold">No budgets for this month</p>
					<p className="mt-2 max-w-64 text-xs leading-5 text-muted-foreground">
						Create category budgets to compare planned spending with actual expenses.
					</p>
				</div>
			) : (
				<div className="space-y-4">
					{visibleRows.map((row) => (
						<div key={row.budget.id}>
							<div className="mb-2 flex items-center justify-between gap-3">
								<div className="min-w-0">
									<p className="truncate text-sm font-medium">{row.title}</p>
									<p className="text-[11px] text-muted-foreground">
										{row.status === "over"
											? "Over budget"
											: row.status === "near"
												? "Near limit"
												: "Within budget"}
									</p>
								</div>
								<div className="shrink-0 text-right text-xs">
									<CurrencyAmount
										amount={row.spent}
										currency={row.currency || currency}
										className="tabular-nums"
									/>
									<span className="text-muted-foreground"> / </span>
									<CurrencyAmount
										amount={row.budgeted}
										currency={row.currency || currency}
										className="tabular-nums"
									/>
								</div>
							</div>
							<Progress
								value={row.progressPercent}
								aria-label={`${row.title} budget progress ${Math.round(row.progressPercent)} percent`}
								className={cn(
									row.status === "over"
										? "[&_[data-slot=progress-indicator]]:bg-red-500"
										: row.status === "near"
											? "[&_[data-slot=progress-indicator]]:bg-amber-500"
											: "[&_[data-slot=progress-indicator]]:bg-emerald-500"
								)}
							/>
						</div>
					))}
				</div>
			)}
		</section>
	);
}

export function DashboardPageClient({ userId: providedUserId }: DashboardPageClientProps = {}) {
	const userId = useRequiredUserId(providedUserId);
	const config = useDbConfig(userId);
	const haptics = useHaptics();
	const { activeCurrency, includeFutureDatedBalances, setIncludeFutureDatedBalances } =
		useFilterStore();
	const openAddAccount = useUIStore((state) => state.openAddAccount);
	const currency = resolveCurrencyCode(activeCurrency, config?.currency);
	const fiscalYearStartMonth = config?.fiscalYearStartMonth ?? 7;
	const [now] = useState(() => new Date());
	const [selectedMonth, setSelectedMonth] = useState(() => clampDashboardMonth(new Date()));
	const [interval, setInterval] = useState<AnalyticsInterval>("monthly");
	const [intervalOpen, setIntervalOpen] = useState(false);
	const timeZoneOffsetMinutes = useMemo(() => getLocalTimeZoneOffsetMinutes(now), [now]);
	const canGoNext = !isCurrentDashboardMonth(selectedMonth, now);

	const periodQuery = useMemo<PeriodAnalyticsQuery>(
		() => ({
			currency,
			interval,
			anchorDate: selectedMonth,
			fiscalYearStartMonth,
			now,
			timeZoneOffsetMinutes,
		}),
		[currency, fiscalYearStartMonth, interval, now, selectedMonth, timeZoneOffsetMinutes]
	);
	const resolvedPeriod = useMemo(
		() =>
			resolveAnalyticsPeriod({
				interval,
				anchorDate: selectedMonth,
				fiscalYearStartMonth,
				now,
				timeZoneOffsetMinutes,
			}),
		[interval, fiscalYearStartMonth, now, selectedMonth, timeZoneOffsetMinutes]
	);
	const periodAnalytics = usePeriodAnalytics(userId, periodQuery);
	const monthlyBudgetAnalytics = usePeriodAnalytics(
		userId,
		interval !== "monthly"
			? {
					currency,
					interval: "monthly",
					anchorDate: selectedMonth,
					fiscalYearStartMonth,
					now,
					timeZoneOffsetMinutes,
				}
			: undefined
	);
	const accountAnalytics = useAccountsAnalytics(userId, {
		currency,
		enabledCurrencies: config?.enabledCurrencies,
		asOf: now,
		period: {
			interval,
			anchorDate: selectedMonth,
			fiscalYearStartMonth,
			now,
			timeZoneOffsetMinutes,
		},
		timeZoneOffsetMinutes,
		includeFutureDatedBalances,
	});
	const trendSummaries = useAnalyticsMonthSummaries(userId, {
		currency,
		months: 8,
		anchorDate: selectedMonth,
		mode: "ending",
		timeZoneOffsetMinutes,
	});
	const periodLabel = periodAnalytics?.period.label ?? resolvedPeriod.label;
	const budgetPeriodKey = useMemo(
		() => getMonthKey(selectedMonth, { timeZoneOffsetMinutes }),
		[selectedMonth, timeZoneOffsetMinutes]
	);
	const budgetMonthLabel = useMemo(
		() =>
			resolveAnalyticsPeriod({
				interval: "monthly",
				anchorDate: selectedMonth,
				now,
				timeZoneOffsetMinutes,
			}).label,
		[now, selectedMonth, timeZoneOffsetMinutes]
	);
	const budgetProgress = useBudgets(
		userId,
		budgetPeriodKey,
		currency,
		interval === "monthly" ? periodAnalytics : monthlyBudgetAnalytics
	);

	const changeMonth = useCallback(
		(delta: number) => {
			const nextMonth = shiftDashboardMonth(selectedMonth, delta, now);
			if (nextMonth.getTime() === selectedMonth.getTime()) return;

			setSelectedMonth(nextMonth);
			haptics.selection();
		},
		[haptics, now, selectedMonth]
	);
	const swipeRef = useMonthSwipe(changeMonth, canGoNext);

	function handleSelectMonth(month: Date) {
		const nextMonth = clampDashboardMonth(month, now);
		if (nextMonth.getTime() === selectedMonth.getTime()) return;

		setSelectedMonth(nextMonth);
		haptics.selection();
	}

	function handleAddAccount() {
		haptics.light();
		openAddAccount();
	}

	function handleToggleFutureBalances() {
		setIncludeFutureDatedBalances(!includeFutureDatedBalances);
		haptics.selection();
	}

	const isAnalyticsBusy = periodAnalytics === undefined || accountAnalytics === undefined;

	return (
		<div className="space-y-4 md:space-y-5" aria-busy={isAnalyticsBusy}>
			<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<h1 className="hidden text-2xl font-bold tracking-tight md:block">Dashboard</h1>
					<p className="text-sm text-muted-foreground">
						{getIntervalLabel(interval)} view · {periodLabel}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<BalanceBasisBadge includeFutureDatedBalances={includeFutureDatedBalances} />
					<Button variant="outline" size="sm" onClick={handleToggleFutureBalances}>
						{includeFutureDatedBalances ? "Exclude Future" : "Include Future"}
					</Button>
				</div>
			</div>

			<MonthStrip
				userId={userId}
				currency={currency}
				selectedMonth={selectedMonth}
				now={now}
				timeZoneOffsetMinutes={timeZoneOffsetMinutes}
				onChangeMonth={changeMonth}
				onSelectMonth={handleSelectMonth}
				onOpenInterval={() => setIntervalOpen(true)}
			/>

			<AnalyticsIntervalChooser
				open={intervalOpen}
				value={interval}
				onOpenChange={setIntervalOpen}
				onApply={setInterval}
			/>

			<div
				ref={swipeRef}
				data-swipe-navigation-ignore
				aria-label="Swipe dashboard month summary"
				data-testid="dashboard-responsive-grid"
				className={DASHBOARD_GRID_CLASSNAME}
				style={{ touchAction: "pan-y" }}>
				<div className={DASHBOARD_GRID_CELL_CLASSNAMES[0]} data-testid="dashboard-top-card-cell">
					<WhatYouHaveCard
						analytics={accountAnalytics}
						onAddAccount={handleAddAccount}
						includeFutureDatedBalances={includeFutureDatedBalances}
						className="md:w-full"
					/>
				</div>

				<div className={DASHBOARD_GRID_CELL_CLASSNAMES[1]} data-testid="dashboard-top-card-cell">
					<SummarySplitCard
						analytics={periodAnalytics}
						currency={currency}
						periodLabel={periodLabel}
						className="md:w-full"
					/>
				</div>

				<div className={DASHBOARD_GRID_CELL_CLASSNAMES[2]} data-testid="dashboard-top-card-cell">
					<AccountDistributionChart
						analytics={accountAnalytics}
						isLoading={accountAnalytics === undefined}
						includeFutureDatedBalances={includeFutureDatedBalances}
						className="md:w-full"
					/>
				</div>

				<div className={DASHBOARD_GRID_CELL_CLASSNAMES[3]}>
					<DesktopMetricStrip analytics={periodAnalytics} currency={currency} />
				</div>

				<div className={DASHBOARD_GRID_CELL_CLASSNAMES[4]}>
					<CashFlowTrendChart
						summaries={trendSummaries}
						currency={currency}
						isLoading={trendSummaries === undefined}
						className="md:w-full"
					/>
				</div>

				<div className={DASHBOARD_GRID_CELL_CLASSNAMES[5]}>
					<SpendingTrendChart
						summaries={trendSummaries}
						currency={currency}
						isLoading={trendSummaries === undefined}
						className="md:w-full"
					/>
				</div>

				<div className={DASHBOARD_GRID_CELL_CLASSNAMES[6]}>
					<CategoryBreakdownChart
						userId={userId}
						breakdown={periodAnalytics?.expenseBreakdown}
						total={periodAnalytics?.expense}
						currency={currency}
						isLoading={periodAnalytics === undefined}
						title={interval === "monthly" ? "Your Monthly Expense" : "Your Expense"}
						periodLabel={periodLabel}
						emptyTitle="No expenses in this period"
						emptyDescription="Expense categories will appear here when you record spending."
						className="md:w-full"
						action={
							<Button asChild variant="link" size="sm" className="h-auto px-0 text-xs font-bold">
								<Link href="/reports">VIEW MORE</Link>
							</Button>
						}
					/>
				</div>

				<div className={DASHBOARD_GRID_CELL_CLASSNAMES[7]}>
					<BudgetProgressPanel
						rows={budgetProgress?.rows ?? []}
						isLoading={budgetProgress === undefined}
						currency={currency}
						periodLabel={budgetMonthLabel}
					/>
				</div>
			</div>
		</div>
	);
}
