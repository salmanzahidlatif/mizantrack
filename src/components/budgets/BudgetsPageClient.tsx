"use client";

import { ChevronLeft, ChevronRight, Plus, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";

import { BudgetDrawer } from "@/components/budgets/BudgetDrawer";
import { BudgetList } from "@/components/budgets/BudgetList";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { Button } from "@/components/ui/button";
import { useBudgets, type BudgetProgressRow } from "@/hooks/useBudgets";
import { useDbConfig } from "@/hooks/useDbConfig";
import { useHaptics } from "@/hooks/useHaptics";
import { usePeriodAnalytics } from "@/hooks/usePeriodAnalytics";
import { useRequiredUserId } from "@/hooks/useRequiredUserId";
import { resolveCurrencyCode } from "@/lib/analytics/balanceMath";
import {
	formatMonthLabel,
	getLocalTimeZoneOffsetMinutes,
	getMonthKey,
	getMonthRange,
	getMonthStripRanges,
} from "@/lib/dateRange";
import { CARD_SURFACE, PRESS_SCALE, TAPPABLE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useFilterStore } from "@/store/filter-store";

import type { PeriodAnalyticsQuery } from "@/lib/analytics/periodAnalytics";
import type { Budget } from "@/types";

interface BudgetsPageClientProps {
	userId?: string;
}

function isFutureMonth(date: Date, now: Date, timeZoneOffsetMinutes: number) {
	return getMonthKey(date, { timeZoneOffsetMinutes }) > getMonthKey(now, { timeZoneOffsetMinutes });
}

function BudgetSummarySkeleton() {
	return (
		<div className="grid grid-cols-3 gap-2" aria-busy="true">
			{["budgeted", "spent", "remaining"].map((item) => (
				<div key={item} className={cn(CARD_SURFACE, "space-y-2 p-3")}>
					<div className="shimmer h-3 w-16 rounded-full bg-muted" />
					<div className="shimmer h-5 w-20 rounded-full bg-muted" />
				</div>
			))}
		</div>
	);
}

function BudgetListSkeleton() {
	return (
		<div className="space-y-3" aria-busy="true">
			{[0, 1, 2].map((item) => (
				<div key={item} className={cn(CARD_SURFACE, "space-y-4 p-4")}>
					<div className="flex items-center gap-3">
						<div className="shimmer h-11 w-11 rounded-2xl bg-muted" />
						<div className="min-w-0 flex-1 space-y-2">
							<div className="shimmer h-4 w-32 rounded-full bg-muted" />
							<div className="shimmer h-5 w-24 rounded-full bg-muted" />
						</div>
					</div>
					<div className="shimmer h-3 rounded-full bg-muted" />
				</div>
			))}
		</div>
	);
}

function MonthStrip({
	selectedMonth,
	now,
	timeZoneOffsetMinutes,
	onSelectMonth,
	onChangeMonth,
}: {
	selectedMonth: Date;
	now: Date;
	timeZoneOffsetMinutes: number;
	onSelectMonth: (date: Date) => void;
	onChangeMonth: (direction: -1 | 1) => void;
}) {
	const ranges = useMemo(
		() =>
			getMonthStripRanges(selectedMonth, {
				months: 5,
				timeZoneOffsetMinutes,
			}),
		[selectedMonth, timeZoneOffsetMinutes]
	);
	const selectedKey = getMonthKey(selectedMonth, { timeZoneOffsetMinutes });
	const selectedRange = getMonthRange(selectedMonth, { timeZoneOffsetMinutes });
	const canGoNext = !isFutureMonth(new Date(selectedRange.toMs + 1), now, timeZoneOffsetMinutes);

	return (
		<section className="space-y-2" aria-labelledby="budgets-month-heading">
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
						aria-label="Select budget month">
						{ranges.map((range) => {
							const selected = range.key === selectedKey;
							const disabled = isFutureMonth(range.date, now, timeZoneOffsetMinutes);

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
										{formatMonthLabel(range.date, { timeZoneOffsetMinutes })}
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
				</div>
			</div>
			<h2 id="budgets-month-heading" className="sr-only">
				Budget month
			</h2>
		</section>
	);
}

export function BudgetsPageClient({ userId: providedUserId }: BudgetsPageClientProps = {}) {
	const userId = useRequiredUserId(providedUserId);
	const config = useDbConfig(userId);
	const { activeCurrency } = useFilterStore();
	const haptics = useHaptics();
	const [now] = useState(() => new Date());
	const [selectedMonth, setSelectedMonth] = useState(() => new Date());
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [editingBudget, setEditingBudget] = useState<Budget | null>(null);
	const currency = resolveCurrencyCode(activeCurrency, config?.currency);
	const timeZoneOffsetMinutes = useMemo(() => getLocalTimeZoneOffsetMinutes(now), [now]);
	const monthRange = useMemo(
		() => getMonthRange(selectedMonth, { timeZoneOffsetMinutes }),
		[selectedMonth, timeZoneOffsetMinutes]
	);
	const monthLabel = monthRange.label;
	const periodQuery = useMemo<PeriodAnalyticsQuery>(
		() => ({
			currency,
			interval: "monthly",
			anchorDate: monthRange.date,
			now,
			timeZoneOffsetMinutes,
		}),
		[currency, monthRange.date, now, timeZoneOffsetMinutes]
	);
	const analytics = usePeriodAnalytics(userId, periodQuery);
	const budgetData = useBudgets(userId, monthRange.key, currency, analytics);
	const rows = budgetData?.rows ?? [];
	const totalBudgeted = rows.reduce((sum, row) => sum + row.budgeted, 0);
	const totalSpent = rows.reduce((sum, row) => sum + row.spent, 0);
	const totalRemaining = totalBudgeted - totalSpent;
	const overBudgetCount = rows.filter((row) => row.status === "over").length;
	const loading = budgetData === undefined || analytics === undefined;

	function changeMonth(direction: -1 | 1) {
		const next =
			direction < 0
				? getMonthRange(new Date(monthRange.fromMs - 1), { timeZoneOffsetMinutes })
				: getMonthRange(new Date(monthRange.toMs + 1), { timeZoneOffsetMinutes });
		if (isFutureMonth(next.date, now, timeZoneOffsetMinutes)) return;

		setSelectedMonth(next.date);
		haptics.selection();
	}

	function selectMonth(date: Date) {
		if (isFutureMonth(date, now, timeZoneOffsetMinutes)) return;

		setSelectedMonth(getMonthRange(date, { timeZoneOffsetMinutes }).date);
		haptics.selection();
	}

	function openCreateDrawer() {
		setEditingBudget(null);
		setDrawerOpen(true);
		haptics.light();
	}

	function openEditDrawer(row: BudgetProgressRow) {
		setEditingBudget(row.budget);
		setDrawerOpen(true);
		haptics.selection();
	}

	function handleDrawerOpenChange(open: boolean) {
		setDrawerOpen(open);
		if (!open) setEditingBudget(null);
	}

	return (
		<div className="space-y-5">
			<div className="flex items-start justify-between gap-3">
				<div className="space-y-1">
					<h1 className="hidden text-2xl font-bold md:block">Budgets</h1>
					<p className="text-sm text-muted-foreground">
						{currency} monthly category limits for {monthLabel}
					</p>
				</div>
				<Button type="button" size="sm" onClick={openCreateDrawer}>
					<Plus className="h-4 w-4" />
					Add Budget
				</Button>
			</div>

			<MonthStrip
				selectedMonth={monthRange.date}
				now={now}
				timeZoneOffsetMinutes={timeZoneOffsetMinutes}
				onSelectMonth={selectMonth}
				onChangeMonth={changeMonth}
			/>

			{loading ? (
				<BudgetSummarySkeleton />
			) : (
				<section className="grid grid-cols-3 gap-2" aria-label="Budget summary">
					<div className={cn(CARD_SURFACE, "p-3")}>
						<p className="text-xs text-muted-foreground">Budgeted</p>
						<CurrencyAmount amount={totalBudgeted} currency={currency} className="tabular-nums" />
					</div>
					<div className={cn(CARD_SURFACE, "p-3")}>
						<p className="text-xs text-muted-foreground">Spent</p>
						<CurrencyAmount amount={totalSpent} currency={currency} className="tabular-nums" />
					</div>
					<div
						className={cn(
							CARD_SURFACE,
							"p-3",
							overBudgetCount > 0 && "border-red-500/50 bg-red-500/10"
						)}>
						<p className="flex items-center gap-1 text-xs text-muted-foreground">
							<WalletCards className="h-3.5 w-3.5" />
							{overBudgetCount > 0 ? `${overBudgetCount} over` : "Remaining"}
						</p>
						<CurrencyAmount
							amount={Math.abs(totalRemaining)}
							currency={currency}
							variant={totalRemaining < 0 ? "negative" : "positive"}
							className="tabular-nums"
						/>
					</div>
				</section>
			)}

			{loading ? (
				<BudgetListSkeleton />
			) : (
				<BudgetList
					userId={userId}
					rows={rows}
					currency={currency}
					monthLabel={monthLabel}
					onEdit={openEditDrawer}
				/>
			)}

			<BudgetDrawer
				userId={userId}
				open={drawerOpen}
				period={monthRange.key}
				currency={currency}
				categories={budgetData?.categories ?? []}
				budget={editingBudget}
				onOpenChange={handleDrawerOpenChange}
			/>
		</div>
	);
}
