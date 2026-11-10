"use client";

import { useId, useMemo } from "react";
import {
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	ReferenceLine,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { MeasuredChartContainer } from "@/components/charts/MeasuredChartContainer";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { SkeletonChart } from "@/components/shared/SkeletonChart";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { COMPARISON_PRESET_OPTIONS, type ComparisonPresetId } from "@/lib/comparisonPresets";
import { CARD_SURFACE } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type {
	CategoryComparisonItem,
	ComparisonAnalytics,
} from "@/lib/analytics/comparisonAnalytics";
import type { FilterPeriod } from "@/types";

const SAVINGS_COLOR = "#22c55e";
const INCREASE_COLOR = "#ef4444";
/**
 * Unbounded ("All") and single-day ("Today") windows make for a meaningless — and, for "All",
 * unrepresentable — preceding window, so they are not offered here.
 */
const COMPARISON_RANGE_PRESETS: readonly FilterPeriod[] = [
	"week",
	"month",
	"quarter",
	"half-year",
	"year",
	"fiscal-year",
	"custom",
];

export interface SavingsComparisonCardProps {
	data?: ComparisonAnalytics;
	isLoading?: boolean;
	currency: string;
	presetId: ComparisonPresetId;
	onPresetChange: (presetId: ComparisonPresetId) => void;
	customRange?: { from: Date; to: Date } | null;
	onCustomRangeChange?: (range: { from: Date; to: Date } | null) => void;
	fiscalYearStartMonth?: number;
	className?: string;
}

interface SavingsTooltipProps {
	active?: boolean;
	payload?: Array<{ payload?: CategoryComparisonItem }>;
	currency: string;
}

function formatChangeShare(changeShare: number | null): string {
	if (changeShare === null || !Number.isFinite(changeShare)) return "—";
	return `${(changeShare * 100).toFixed(1)}%`;
}

function SavingsTooltip({ active, payload, currency }: SavingsTooltipProps) {
	const item = payload?.[0]?.payload;
	if (!active || !item) return null;

	return (
		<div className="rounded-xl border border-border/70 bg-popover/95 p-3 text-xs shadow-[var(--shadow-card)] backdrop-blur">
			<p className="mb-2 font-semibold">{item.title}</p>
			<div className="space-y-1.5">
				<div className="flex items-center justify-between gap-4">
					<span className="text-muted-foreground">Previous</span>
					<CurrencyAmount amount={item.previousAmount} currency={currency} className="text-xs" />
				</div>
				<div className="flex items-center justify-between gap-4">
					<span className="text-muted-foreground">Current</span>
					<CurrencyAmount amount={item.currentAmount} currency={currency} className="text-xs" />
				</div>
				<div className="flex items-center justify-between gap-4">
					<span className="text-muted-foreground">
						{item.savings >= 0 ? "Saved" : "Extra spend"}
					</span>
					<span className="flex items-center gap-2">
						<CurrencyAmount
							amount={Math.abs(item.savings)}
							currency={currency}
							variant={item.savings >= 0 ? "positive" : "negative"}
							className="text-xs"
						/>
						<span className="text-muted-foreground">{formatChangeShare(item.changeShare)}</span>
					</span>
				</div>
			</div>
		</div>
	);
}

function SavingsHeadline({ totalBenefit, currency }: { totalBenefit: number; currency: string }) {
	if (totalBenefit === 0) {
		return (
			<p className="text-sm font-semibold">
				No change
				<span className="ml-2 align-middle" data-testid="savings-headline">
					<CurrencyAmount amount={0} currency={currency} className="text-xl leading-7" />
				</span>
			</p>
		);
	}

	const isBetter = totalBenefit > 0;

	return (
		<p className="text-sm text-muted-foreground">
			{"You're "}
			<span className={cn("font-semibold", isBetter ? "text-income" : "text-expense")}>
				{isBetter ? "better off" : "down"}
			</span>{" "}
			by{" "}
			<span data-testid="savings-headline" className="align-middle">
				<CurrencyAmount
					amount={Math.abs(totalBenefit)}
					currency={currency}
					variant={isBetter ? "positive" : "negative"}
					className="text-2xl leading-8"
				/>
			</span>
		</p>
	);
}

export function SavingsComparisonCard({
	data,
	isLoading,
	currency,
	presetId,
	onPresetChange,
	customRange,
	onCustomRangeChange,
	fiscalYearStartMonth,
	className,
}: SavingsComparisonCardProps) {
	const reactId = useId();
	const titleId = `savings-comparison-title-${reactId}`;
	const listId = `savings-comparison-list-${reactId}`;

	const rows = useMemo(() => {
		if (!data) return [];
		return [...data.topSavings, ...data.topIncreases].sort(
			(first, second) => second.savings - first.savings
		);
	}, [data]);

	if (isLoading || !data) {
		return <SkeletonChart className={cn("md:h-full", className)} chartClassName="h-32 md:h-36" />;
	}

	const { totals } = data;
	const isEmpty = rows.length === 0 && totals.totalBenefit === 0;

	const presetSelect = (
		<Select value={presetId} onValueChange={(value) => onPresetChange(value as ComparisonPresetId)}>
			<SelectTrigger size="sm" aria-label="Comparison period" className="w-full sm:w-56">
				<SelectValue placeholder="Select a comparison" />
			</SelectTrigger>
			<SelectContent>
				{COMPARISON_PRESET_OPTIONS.map((option) => (
					<SelectItem key={option.value} value={option.value}>
						{option.label}
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);

	const customPicker =
		presetId === "custom" && onCustomRangeChange ? (
			<DateRangePicker
				standalone
				value={customRange ?? undefined}
				onChange={(range) => onCustomRangeChange(range)}
				fiscalYearStartMonth={fiscalYearStartMonth}
				presets={COMPARISON_RANGE_PRESETS}
			/>
		) : null;

	// Charting a fallback window while the picker shows its own default would make the controls
	// disagree with the data, so ask for a range first.
	if (presetId === "custom" && !customRange) {
		return (
			<div
				className={cn(
					"flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card p-4 text-center shadow-[var(--shadow-card)] md:min-h-56 md:p-6",
					"md:h-full",
					className
				)}>
				<p id={titleId} className="text-sm font-semibold">
					Pick a date range
				</p>
				<p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground">
					Choose the period you want to compare against the one immediately before it.
				</p>
				<div className="mt-4 w-full space-y-3">
					<div className="mx-auto w-full max-w-64">{presetSelect}</div>
					<div className="flex justify-center">{customPicker}</div>
				</div>
			</div>
		);
	}

	if (isEmpty) {
		return (
			<div
				className={cn(
					"flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card p-4 text-center shadow-[var(--shadow-card)] md:min-h-56 md:p-6",
					"md:h-full",
					className
				)}>
				<p id={titleId} className="text-sm font-semibold">
					Not enough history to compare yet
				</p>
				<p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground">
					Add transactions across two periods to see where you&apos;re saving.
				</p>
				<div className="mt-4 w-full max-w-64 space-y-3">
					{presetSelect}
					{customPicker}
				</div>
			</div>
		);
	}

	return (
		<div className={cn(CARD_SURFACE, "overflow-hidden p-4 md:h-full", className)}>
			<div className="mb-3 flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<p id={titleId} className="text-sm font-semibold">
						Savings vs Previous Period
					</p>
					<p className="mt-0.5 truncate text-xs text-muted-foreground">
						{`${data.current.label} vs ${data.previous.label}`}
					</p>
					<p className="text-[10px] text-muted-foreground">Equal period-to-date windows</p>
				</div>
				{presetSelect}
			</div>

			{customPicker && <div className="mb-3">{customPicker}</div>}

			<div className="mb-4">
				<SavingsHeadline totalBenefit={totals.totalBenefit} currency={currency} />
				<p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
					<span className="flex items-center gap-1">
						Spending
						<CurrencyAmount
							amount={Math.abs(totals.expenseSavings)}
							currency={currency}
							variant={totals.expenseSavings >= 0 ? "positive" : "negative"}
							className="text-xs"
						/>
						{totals.expenseSavings >= 0 ? "less" : "more"}
					</span>
					<span aria-hidden="true">·</span>
					<span className="flex items-center gap-1">
						Earning
						<CurrencyAmount
							amount={Math.abs(totals.incomeGrowth)}
							currency={currency}
							variant={totals.incomeGrowth >= 0 ? "positive" : "negative"}
							className="text-xs"
						/>
						{totals.incomeGrowth >= 0 ? "more" : "less"}
					</span>
				</p>
			</div>

			{rows.length > 0 && (
				<>
					<div data-testid="savings-comparison-chart">
						<MeasuredChartContainer
							className="h-40 min-w-0"
							labelledBy={titleId}
							describedBy={listId}>
							{(size) => (
								<ResponsiveContainer
									width="100%"
									height="100%"
									debounce={80}
									initialDimension={size}>
									<BarChart
										data={rows}
										layout="vertical"
										margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
										<CartesianGrid strokeDasharray="3 3" className="stroke-border" />
										<XAxis type="number" tick={{ fontSize: 11 }} />
										<YAxis type="category" dataKey="title" width={96} tick={{ fontSize: 11 }} />
										<ReferenceLine x={0} className="stroke-border" />
										<Tooltip content={<SavingsTooltip currency={currency} />} />
										<Bar dataKey="savings" name="Savings" isAnimationActive={false}>
											{rows.map((item, index) => (
												<Cell
													key={`${item.categoryId ?? item.title}-${index}`}
													fill={item.savings > 0 ? SAVINGS_COLOR : INCREASE_COLOR}
												/>
											))}
										</Bar>
									</BarChart>
								</ResponsiveContainer>
							)}
						</MeasuredChartContainer>
					</div>

					<ul id={listId} className="mt-3 no-scrollbar max-h-56 space-y-2 overflow-y-auto pr-1">
						{rows.map((item, index) => (
							<li
								key={`${item.categoryId ?? item.title}-${index}`}
								data-testid="savings-row"
								data-category={item.title}
								data-savings={item.savings}
								className="flex items-center gap-2">
								{item.icon && (
									<span aria-hidden="true" className="shrink-0 text-sm">
										{item.icon}
									</span>
								)}
								<div className="min-w-0 flex-1">
									<p className="flex items-center gap-1.5">
										<span className="truncate text-xs font-medium" title={item.title}>
											{item.title}
										</span>
										{item.isNew && (
											<span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
												New
											</span>
										)}
										{item.isDropped && (
											<span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
												Stopped
											</span>
										)}
									</p>
									<p className="flex items-center gap-1 text-[10px] text-muted-foreground">
										<CurrencyAmount
											amount={item.previousAmount}
											currency={currency}
											className="text-[10px] font-normal"
										/>
										<span aria-hidden="true">→</span>
										<CurrencyAmount
											amount={item.currentAmount}
											currency={currency}
											className="text-[10px] font-normal"
										/>
									</p>
								</div>
								<span className="flex shrink-0 flex-col items-end">
									<CurrencyAmount
										amount={Math.abs(item.savings)}
										currency={currency}
										variant={item.savings >= 0 ? "positive" : "negative"}
										className="text-xs"
									/>
									<span className="text-[10px] text-muted-foreground">
										{formatChangeShare(item.changeShare)}
									</span>
								</span>
							</li>
						))}
					</ul>
				</>
			)}
		</div>
	);
}
