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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import { SkeletonChart } from "@/components/shared/SkeletonChart";
import { Button } from "@/components/ui/button";
import { useAccountsAnalytics } from "@/hooks/useAccountsAnalytics";
import { useAnalyticsMonthSummaries } from "@/hooks/useAnalyticsMonthSummaries";
import { useDbConfig } from "@/hooks/useDbConfig";
import { useHaptics } from "@/hooks/useHaptics";
import { usePeriodAnalytics } from "@/hooks/usePeriodAnalytics";
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
		loading: () => <SkeletonChart height={280} />,
	}
);

interface DashboardPageClientProps {
	userId: string;
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
}

interface WhatYouHaveCardProps {
	analytics?: AccountsAnalytics;
	onAddAccount: () => void;
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

function WhatYouHaveSkeleton() {
	return (
		<section
			className={cn(CARD_SURFACE, "overflow-hidden p-4")}
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
							className="min-h-[72px] rounded-2xl border border-border/60 bg-muted/35 p-3">
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

function WhatYouHaveCard({ analytics, onAddAccount }: WhatYouHaveCardProps) {
	if (!analytics) {
		return <WhatYouHaveSkeleton />;
	}

	const accounts = sortDashboardAccounts(analytics.accounts).slice(0, 5);

	return (
		<section className={cn(CARD_SURFACE, "overflow-hidden p-4")} aria-labelledby="what-you-have">
			<div className="mb-4 flex items-start justify-between gap-3">
				<div>
					<p id="what-you-have" className="text-sm font-semibold">
						What You Have
					</p>
					<CurrencyAmount
						amount={analytics.netWorth}
						currency={analytics.currency}
						colorized
						showNegativeSign
						className="mt-2 block text-3xl leading-9"
					/>
				</div>
				<WalletCards className="mt-1 h-5 w-5 text-muted-foreground" aria-hidden="true" />
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

function SummarySplitCard({ analytics, currency, periodLabel }: SummarySplitCardProps) {
	if (!analytics) {
		return <SkeletonCard className="h-28" />;
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
			className={cn(CARD_SURFACE, "overflow-hidden")}
			aria-label={`Income and expense for ${periodLabel}`}>
			<div className="grid grid-cols-2 divide-x divide-border/60">
				{items.map(({ label, amount, variant, icon: Icon, underline }) => (
					<Link key={label} href="/transactions" className="press relative min-h-28 p-4 text-left">
						<div className="mb-3 flex items-center justify-between gap-2">
							<span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
								<Icon className="h-4 w-4" aria-hidden="true" />
							</span>
							<ChevronRight className="h-4 w-4 text-muted-foreground/60" aria-hidden="true" />
						</div>
						<CurrencyAmount
							amount={amount}
							currency={currency}
							variant={variant}
							className="block text-lg leading-6"
						/>
						<p className="mt-1 text-xs font-medium text-muted-foreground">{label}</p>
						<span
							className={cn("absolute right-4 bottom-0 left-4 h-1 rounded-t-full", underline)}
						/>
					</Link>
				))}
			</div>
		</section>
	);
}

export function DashboardPageClient({ userId }: DashboardPageClientProps) {
	const config = useDbConfig(userId);
	const haptics = useHaptics();
	const { activeCurrency } = useFilterStore();
	const openAddAccount = useUIStore((state) => state.openAddAccount);
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
	const periodAnalytics = usePeriodAnalytics(userId, periodQuery);
	const accountAnalytics = useAccountsAnalytics(userId, {
		currency,
		enabledCurrencies: config?.enabledCurrencies,
		asOf: interval === "all-time" ? now : resolvedPeriod.to,
		period: {
			interval,
			anchorDate: selectedMonth,
			fiscalYearStartMonth,
			now,
			timeZoneOffsetMinutes,
		},
		timeZoneOffsetMinutes,
	});
	const periodLabel = periodAnalytics?.period.label ?? resolvedPeriod.label;

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

	const isAnalyticsBusy = periodAnalytics === undefined || accountAnalytics === undefined;

	return (
		<div className="space-y-5" aria-busy={isAnalyticsBusy}>
			<div>
				<h1 className="hidden text-2xl font-bold tracking-tight md:block">Dashboard</h1>
				<p className="text-sm text-muted-foreground">
					{getIntervalLabel(interval)} view · {periodLabel}
				</p>
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
				className="touch-pan-y space-y-5"
				style={{ touchAction: "pan-y" }}>
				<WhatYouHaveCard analytics={accountAnalytics} onAddAccount={handleAddAccount} />

				<SummarySplitCard
					analytics={periodAnalytics}
					currency={currency}
					periodLabel={periodLabel}
				/>

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
					action={
						<Button asChild variant="link" size="sm" className="h-auto px-0 text-xs font-bold">
							<Link href="/reports">VIEW MORE</Link>
						</Button>
					}
				/>
			</div>
		</div>
	);
}
