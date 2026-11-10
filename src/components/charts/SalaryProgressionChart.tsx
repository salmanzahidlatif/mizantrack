"use client";

import { useId, useMemo } from "react";
import {
	Area,
	AreaChart,
	CartesianGrid,
	ReferenceDot,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { MeasuredChartContainer } from "@/components/charts/MeasuredChartContainer";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { SkeletonChart } from "@/components/shared/SkeletonChart";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { CARD_SURFACE } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type {
	SalaryProgressionAnalytics,
	SalaryProgressionInterval,
	SalaryProgressionPoint,
} from "@/lib/analytics/salaryProgression";
import type { ReactNode } from "react";

const INCOME_COLOR = "#22c55e";
const EMPTY_VALUE = "—";

export const SALARY_WINDOW_OPTIONS: readonly { value: number; label: string }[] = [
	{ value: 0, label: "All time" },
	{ value: 1, label: "Last 1 year" },
	{ value: 3, label: "Last 3 years" },
	{ value: 5, label: "Last 5 years" },
	{ value: 10, label: "Last 10 years" },
];

export const SALARY_INTERVAL_OPTIONS: readonly {
	value: SalaryProgressionInterval;
	label: string;
}[] = [
	{ value: "monthly", label: "Monthly" },
	{ value: "quarterly", label: "Quarterly" },
	{ value: "yearly", label: "Yearly" },
];

export interface SalaryProgressionChartProps {
	data?: SalaryProgressionAnalytics;
	isLoading?: boolean;
	currency: string;
	interval: SalaryProgressionInterval;
	onIntervalChange: (interval: SalaryProgressionInterval) => void;
	/** Trailing window in years. 0 = all time. */
	years: number;
	onYearsChange: (years: number) => void;
	/**
	 * Optional id → title map for the detected salary categories. The component only
	 * receives ids, so when this is omitted it falls back to showing the count.
	 */
	categoryLabels?: Record<string, string>;
	className?: string;
}

interface SalaryTooltipProps {
	active?: boolean;
	payload?: Array<{ payload?: SalaryProgressionPoint }>;
	currency: string;
}

interface SalaryChartRow extends SalaryProgressionPoint {
	/** Run-rate of completed buckets only. */
	solidAverage: number | null;
	/** Run-rate of the in-progress tail, drawn dashed. */
	partialAverage: number | null;
}

function formatShare(share: number | null | undefined, signed = false): string {
	if (share === null || share === undefined || !Number.isFinite(share)) return EMPTY_VALUE;

	const percent = share * 100;
	const sign = signed && percent > 0 ? "+" : "";
	return `${sign}${percent.toFixed(1)}%`;
}

function getShareToneClass(share: number | null | undefined): string {
	if (share === null || share === undefined || !Number.isFinite(share) || share === 0) {
		return "text-foreground";
	}
	return share > 0 ? "text-income" : "text-expense";
}

function SalaryTooltip({ active, payload, currency }: SalaryTooltipProps) {
	const point = payload?.[0]?.payload;
	if (!active || !point) return null;

	return (
		<div className="rounded-xl border border-border/70 bg-popover/95 p-3 text-xs shadow-[var(--shadow-card)] backdrop-blur">
			<p className="mb-2 flex items-center gap-2 font-semibold">
				{point.label}
				{point.isHike && (
					<span className="rounded-full bg-income/15 px-2 py-0.5 text-[10px] font-medium text-income">
						Raise
					</span>
				)}
				{point.isPartial && (
					<span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
						In progress
					</span>
				)}
			</p>
			<div className="space-y-1.5">
				<div className="flex items-center justify-between gap-4">
					<span className="text-muted-foreground">Monthly run-rate</span>
					<CurrencyAmount amount={point.average} currency={currency} className="text-xs" />
				</div>
				<div className="flex items-center justify-between gap-4">
					<span className="text-muted-foreground">Total</span>
					<CurrencyAmount amount={point.total} currency={currency} className="text-xs" />
				</div>
				<div className="flex items-center justify-between gap-4">
					<span className="text-muted-foreground">Months counted</span>
					<span className="font-medium tabular-nums">{point.monthsCovered}</span>
				</div>
				<div className="flex items-center justify-between gap-4">
					<span className="text-muted-foreground">Transactions</span>
					<span className="font-medium tabular-nums">{point.transactionCount}</span>
				</div>
				<div className="flex items-center justify-between gap-4">
					<span className="text-muted-foreground">Run-rate growth</span>
					<span
						className={cn("font-medium tabular-nums", getShareToneClass(point.averageGrowthShare))}>
						{formatShare(point.averageGrowthShare, true)}
					</span>
				</div>
			</div>
			{point.isPartial && (
				<p className="mt-2 text-[10px] text-muted-foreground">This period is still in progress.</p>
			)}
		</div>
	);
}

function SummaryTile({
	label,
	children,
	testId,
}: {
	label: string;
	children: ReactNode;
	testId?: string;
}) {
	return (
		<div className="min-w-0">
			<p className="text-[11px] text-muted-foreground">{label}</p>
			<span data-testid={testId} className="mt-0.5 block text-sm">
				{children}
			</span>
		</div>
	);
}

export function SalaryProgressionChart({
	data,
	isLoading,
	currency,
	interval,
	onIntervalChange,
	years,
	onYearsChange,
	categoryLabels,
	className,
}: SalaryProgressionChartProps) {
	const baseId = useId();
	const titleId = `${baseId}-title`;
	const summaryId = `${baseId}-summary`;

	const points = useMemo(() => data?.points ?? [], [data]);
	const chartRows = useMemo<SalaryChartRow[]>(
		() =>
			points.map((point, index) => ({
				...point,
				// The solid series stops at the last complete bucket; the dashed one carries the
				// in-progress tail so a partial period is never mistaken for a finished one.
				solidAverage: point.isPartial ? null : point.average,
				partialAverage:
					point.isPartial || points[index + 1]?.isPartial === true ? point.average : null,
			})),
		[points]
	);
	const hasPartial = useMemo(() => points.some((point) => point.isPartial), [points]);
	const detectedNote = useMemo(() => {
		const ids = data?.usedCategoryIds ?? [];
		if (ids.length === 0) return null;

		const names = ids
			.map((id) => categoryLabels?.[id]?.trim())
			.filter((name): name is string => Boolean(name));
		if (names.length === ids.length) return `Based on: ${names.join(", ")}`;

		return `Based on ${ids.length} salary ${ids.length === 1 ? "category" : "categories"}`;
	}, [data, categoryLabels]);
	const pointsByKey = useMemo(() => new Map(points.map((point) => [point.key, point])), [points]);
	const hikeMarkers = useMemo(() => {
		const hikes = data?.hikes ?? [];
		return hikes
			.map((hike) => ({ hike, point: pointsByKey.get(hike.key) }))
			.filter((entry): entry is { hike: (typeof hikes)[number]; point: SalaryProgressionPoint } =>
				Boolean(entry.point)
			);
	}, [data, pointsByKey]);
	const recentHikes = useMemo(() => [...(data?.hikes ?? [])].reverse(), [data]);

	if (isLoading || !data) {
		return <SkeletonChart className={cn("md:h-full", className)} chartClassName="h-32 md:h-36" />;
	}

	const hasSalary = points.some((point) => point.total !== 0);

	const header = (
		<div className="mb-3 flex flex-wrap items-start justify-between gap-3">
			<p id={titleId} className="text-sm font-semibold">
				Salary Progression
			</p>
			<div className="flex flex-wrap items-center gap-2">
				<Select
					value={interval}
					onValueChange={(value) => onIntervalChange(value as SalaryProgressionInterval)}>
					<SelectTrigger size="sm" aria-label="Salary interval">
						<SelectValue placeholder="Interval" />
					</SelectTrigger>
					<SelectContent>
						{SALARY_INTERVAL_OPTIONS.map((option) => (
							<SelectItem key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Select value={String(years)} onValueChange={(value) => onYearsChange(Number(value))}>
					<SelectTrigger size="sm" aria-label="Salary window">
						<SelectValue placeholder="Window" />
					</SelectTrigger>
					<SelectContent>
						{SALARY_WINDOW_OPTIONS.map((option) => (
							<SelectItem key={option.value} value={String(option.value)}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
		</div>
	);

	if (!hasSalary) {
		return (
			<div className={cn(CARD_SURFACE, "overflow-hidden p-4 md:h-full", className)}>
				{header}
				<div className="flex min-h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card p-4 text-center shadow-[var(--shadow-card)] md:min-h-56 md:p-6">
					<p className="text-sm font-semibold">No salary history yet</p>
					<p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground">
						Income transactions will appear here once you add them.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className={cn(CARD_SURFACE, "overflow-hidden p-4 md:h-full", className)}>
			{header}

			<div id={summaryId} className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
				<SummaryTile label="Latest" testId="salary-latest-average">
					<CurrencyAmount
						amount={data.latestAverage}
						currency={currency}
						className="text-sm"
						variant="positive"
					/>
				</SummaryTile>
				<SummaryTile label="Growth" testId="salary-overall-growth">
					<span
						className={cn(
							"font-semibold tabular-nums",
							getShareToneClass(data.overallGrowthShare)
						)}>
						{formatShare(data.overallGrowthShare, true)}
					</span>
				</SummaryTile>
				<SummaryTile label="CAGR" testId="salary-cagr">
					<span className="font-semibold tabular-nums">{formatShare(data.cagr)}</span>
				</SummaryTile>
				<SummaryTile label="Total earned" testId="salary-total-earned">
					<CurrencyAmount amount={data.totalEarned} currency={currency} className="text-sm" />
				</SummaryTile>
			</div>

			{data.usedFallbackAllIncome && (
				<p data-testid="salary-fallback-note" className="mb-3 text-[11px] text-muted-foreground">
					Showing all income — no salary category detected.
				</p>
			)}

			{detectedNote && (
				<p
					data-testid="salary-detected-categories"
					className="mb-3 text-[11px] text-muted-foreground">
					{detectedNote}
				</p>
			)}

			{hasPartial && (
				<p data-testid="salary-partial-note" className="mb-3 text-[11px] text-muted-foreground">
					The dashed segment is the current period, still in progress.
				</p>
			)}

			<div data-testid="salary-progression-chart">
				<MeasuredChartContainer
					className="h-44 min-w-0 md:h-52"
					labelledBy={titleId}
					describedBy={summaryId}>
					{(size) => (
						<ResponsiveContainer width="100%" height="100%" debounce={80} initialDimension={size}>
							<AreaChart data={chartRows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
								<CartesianGrid strokeDasharray="3 3" className="stroke-border" />
								<XAxis
									dataKey="label"
									tick={{ fontSize: 10 }}
									interval="preserveStartEnd"
									minTickGap={16}
								/>
								<YAxis tick={{ fontSize: 10 }} width={56} />
								<Tooltip content={<SalaryTooltip currency={currency} />} />
								<Area
									type="monotone"
									dataKey="solidAverage"
									name="Monthly run-rate"
									stroke={INCOME_COLOR}
									fill={INCOME_COLOR}
									fillOpacity={0.18}
									strokeWidth={2}
									connectNulls={false}
									isAnimationActive={false}
								/>
								<Area
									type="monotone"
									dataKey="partialAverage"
									name="Monthly run-rate (in progress)"
									stroke={INCOME_COLOR}
									strokeDasharray="4 3"
									fill={INCOME_COLOR}
									fillOpacity={0.07}
									strokeWidth={2}
									connectNulls={false}
									isAnimationActive={false}
								/>
								{hikeMarkers.map(({ hike, point }) => (
									<ReferenceDot
										key={hike.key}
										x={point.label}
										y={point.average}
										r={4}
										fill={INCOME_COLOR}
										stroke="var(--background)"
										strokeWidth={2}
										ifOverflow="extendDomain"
									/>
								))}
							</AreaChart>
						</ResponsiveContainer>
					)}
				</MeasuredChartContainer>
			</div>

			{recentHikes.length > 0 && (
				<div className="mt-3">
					<p className="mb-1.5 text-[11px] font-medium text-muted-foreground">Raises</p>
					<div className="no-scrollbar max-h-40 space-y-1.5 overflow-y-auto pr-1">
						{recentHikes.map((hike) => (
							<div
								key={hike.key}
								data-testid="salary-hike-row"
								data-share={hike.share}
								className="flex items-center justify-between gap-3 text-xs">
								<span className="shrink-0 font-medium">{hike.label}</span>
								<span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
									<CurrencyAmount
										amount={hike.fromAverage}
										currency={currency}
										className="text-[11px]"
									/>
									<span aria-hidden="true">→</span>
									<CurrencyAmount
										amount={hike.toAverage}
										currency={currency}
										className="text-[11px]"
									/>
								</span>
								<span className="shrink-0 font-semibold text-income tabular-nums">
									{formatShare(hike.share, true)}
								</span>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
