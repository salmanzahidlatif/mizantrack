"use client";

import { CalendarDays, ChevronLeft, ChevronRight, CircleSlash2 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
	Bar,
	BarChart,
	Cell,
	CartesianGrid,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { CategoryBreakdownChart } from "@/components/charts/CategoryDonutChart";
import {
	AnalyticsIntervalChooser,
	getIntervalLabel,
} from "@/components/dashboard/AnalyticsIntervalChooser";
import {
	clampDashboardMonth,
	isCurrentDashboardMonth,
	shiftDashboardMonth,
} from "@/components/dashboard/monthData";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { Button } from "@/components/ui/button";
import { useDbConfig } from "@/hooks/useDbConfig";
import { useHaptics } from "@/hooks/useHaptics";
import { usePeriodAnalytics } from "@/hooks/usePeriodAnalytics";
import { useRequiredUserId } from "@/hooks/useRequiredUserId";
import {
	getLocalTimeZoneOffsetMinutes,
	resolveAnalyticsPeriod,
	type AnalyticsInterval,
} from "@/lib/dateRange";
import { CARD_SURFACE, PRESS_SCALE, TAPPABLE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useFilterStore } from "@/store/filter-store";

import type {
	CategoryBreakdownItem,
	PeriodAnalytics,
	PeriodAnalyticsQuery,
} from "@/lib/analytics/periodAnalytics";

interface ReportsPageClientProps {
	userId?: string;
}

interface IncomeExpenseCardProps {
	analytics?: PeriodAnalytics;
	currency: string;
	periodLabel: string;
}

interface BreakdownSummaryCardProps {
	userId: string;
	title: string;
	total: number;
	currency: string;
	breakdown: CategoryBreakdownItem[];
	emptyTitle: string;
	emptyDescription: string;
	periodLabel: string;
}

function ReportControls({
	interval,
	periodLabel,
	canGoNext,
	onPrevious,
	onNext,
	onOpenInterval,
}: {
	interval: AnalyticsInterval;
	periodLabel: string;
	canGoNext: boolean;
	onPrevious: () => void;
	onNext: () => void;
	onOpenInterval: () => void;
}) {
	return (
		<div className={cn(CARD_SURFACE, "flex items-center gap-2 p-2")}>
			<button
				type="button"
				aria-label="Previous month"
				onClick={onPrevious}
				className={cn(
					"flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground",
					PRESS_SCALE,
					TAPPABLE
				)}>
				<ChevronLeft className="h-4 w-4" />
			</button>
			<div className="min-w-0 flex-1 text-center">
				<p className="truncate text-sm font-semibold">{periodLabel}</p>
				<p className="text-xs text-muted-foreground">{getIntervalLabel(interval)}</p>
			</div>
			<button
				type="button"
				aria-label="Next month"
				disabled={!canGoNext}
				onClick={onNext}
				className={cn(
					"flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35",
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
	);
}

function IncomeExpenseTooltip({
	active,
	payload,
	currency,
}: {
	active?: boolean;
	payload?: Array<{ payload?: { name: string; amount: number } }>;
	currency: string;
}) {
	const item = payload?.[0]?.payload;
	if (!active || !item) return null;

	return (
		<div className="rounded-xl border border-border/70 bg-popover/95 p-3 text-xs shadow-[var(--shadow-card)] backdrop-blur">
			<p className="mb-1 font-semibold">{item.name}</p>
			<CurrencyAmount amount={item.amount} currency={currency} className="text-xs" />
		</div>
	);
}

function IncomeExpenseCard({ analytics, currency, periodLabel }: IncomeExpenseCardProps) {
	if (!analytics) {
		return <SkeletonCard className="h-72" />;
	}

	const chartData = [
		{ name: "Income", amount: analytics.income, fill: "#22c55e" },
		{ name: "Expense", amount: analytics.expense, fill: "#ef4444" },
	];

	return (
		<section className={cn(CARD_SURFACE, "p-4")} aria-labelledby="income-expense-heading">
			<div className="mb-3">
				<p id="income-expense-heading" className="text-sm font-semibold">
					Income VS Expense
				</p>
				<p className="mt-0.5 text-xs text-muted-foreground">{periodLabel}</p>
			</div>
			<div
				className="h-48"
				role="img"
				aria-label={`Income ${analytics.income} and expense ${analytics.expense} for ${periodLabel}`}>
				<ResponsiveContainer width="100%" height="100%">
					<BarChart data={chartData} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
						<CartesianGrid strokeDasharray="3 3" className="stroke-border" />
						<XAxis dataKey="name" tick={{ fontSize: 11 }} />
						<YAxis tick={{ fontSize: 11 }} />
						<Tooltip content={<IncomeExpenseTooltip currency={currency} />} />
						<Bar dataKey="amount" radius={[8, 8, 0, 0]} isAnimationActive={false}>
							{chartData.map((item) => (
								<Cell key={item.name} fill={item.fill} />
							))}
						</Bar>
					</BarChart>
				</ResponsiveContainer>
			</div>
			<div className="mt-3 grid grid-cols-2 gap-2" aria-label="Income and expense legend">
				{chartData.map((item) => (
					<div key={item.name} className="rounded-2xl bg-muted/35 p-3">
						<div className="mb-1 flex items-center gap-2">
							<span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.fill }} />
							<span className="text-xs font-medium text-muted-foreground">{item.name}</span>
						</div>
						<CurrencyAmount
							amount={item.amount}
							currency={currency}
							variant={item.name === "Income" ? "positive" : "negative"}
							className="text-sm"
						/>
					</div>
				))}
			</div>
		</section>
	);
}

function BreakdownSummaryCard({
	userId,
	title,
	total,
	currency,
	breakdown,
	emptyTitle,
	emptyDescription,
	periodLabel,
}: BreakdownSummaryCardProps) {
	const hasData = total > 0 && breakdown.length > 0;

	if (!hasData) {
		return (
			<section
				className={cn(
					CARD_SURFACE,
					"flex min-h-52 flex-col items-center justify-center p-6 text-center"
				)}>
				<CircleSlash2 className="mb-3 h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
				<p className="text-sm font-semibold">{emptyTitle}</p>
				<p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground">{emptyDescription}</p>
				<CurrencyAmount amount={0} currency={currency} className="mt-4 text-2xl" />
			</section>
		);
	}

	return (
		<CategoryBreakdownChart
			userId={userId}
			breakdown={breakdown}
			total={total}
			currency={currency}
			title={title}
			periodLabel={periodLabel}
			action={
				title === "Expense" ? (
					<Button asChild variant="outline" size="sm" className="text-xs font-bold">
						<Link href="/transactions">VIEW DETAILS</Link>
					</Button>
				) : undefined
			}
		/>
	);
}

export function ReportsPageClient({ userId: providedUserId }: ReportsPageClientProps = {}) {
	const userId = useRequiredUserId(providedUserId);
	const config = useDbConfig(userId);
	const haptics = useHaptics();
	const { activeCurrency } = useFilterStore();
	const activeCurrencyCode = activeCurrency.trim();
	const currency = activeCurrencyCode.length > 0 ? activeCurrencyCode : (config?.currency ?? "PKR");
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
	const analytics = usePeriodAnalytics(userId, periodQuery);
	const periodLabel = analytics?.period.label ?? resolvedPeriod.label;

	function changeMonth(delta: number) {
		const nextMonth = shiftDashboardMonth(selectedMonth, delta, now);
		if (nextMonth.getTime() === selectedMonth.getTime()) return;

		setSelectedMonth(nextMonth);
		haptics.selection();
	}

	return (
		<div className="space-y-5" aria-busy={analytics === undefined}>
			<div>
				<h1 className="hidden text-2xl font-bold md:block">Reports</h1>
				<p className="text-sm text-muted-foreground">Insights for {periodLabel}</p>
			</div>

			<ReportControls
				interval={interval}
				periodLabel={periodLabel}
				canGoNext={canGoNext}
				onPrevious={() => changeMonth(-1)}
				onNext={() => changeMonth(1)}
				onOpenInterval={() => setIntervalOpen(true)}
			/>

			<AnalyticsIntervalChooser
				open={intervalOpen}
				value={interval}
				onOpenChange={setIntervalOpen}
				onApply={setInterval}
			/>

			<IncomeExpenseCard analytics={analytics} currency={currency} periodLabel={periodLabel} />

			{analytics ? (
				<>
					<BreakdownSummaryCard
						userId={userId}
						title="Expense"
						total={analytics.expense}
						currency={currency}
						breakdown={analytics.expenseBreakdown}
						emptyTitle="No expenses in this period"
						emptyDescription="Spending categories will appear here once expenses are recorded."
						periodLabel={periodLabel}
					/>

					<BreakdownSummaryCard
						userId={userId}
						title="Income"
						total={analytics.income}
						currency={currency}
						breakdown={analytics.incomeBreakdown}
						emptyTitle="No Income in this period"
						emptyDescription="Income categories will appear here once income is recorded."
						periodLabel={periodLabel}
					/>
				</>
			) : (
				<div className="space-y-4">
					<SkeletonCard className="h-72" />
					<SkeletonCard className="h-52" />
				</div>
			)}
		</div>
	);
}
