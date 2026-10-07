"use client";

import { useMemo, type ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import {
	getCategoryBreakdown,
	getDashboardMonthRange,
	type CategoryBreakdownItem as LegacyCategoryBreakdownItem,
} from "@/components/dashboard/monthData";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { SkeletonChart } from "@/components/shared/SkeletonChart";
import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { CARD_SURFACE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useFilterStore } from "@/store/filter-store";

import type { CategoryBreakdownItem as AnalyticsCategoryBreakdownItem } from "@/lib/analytics/periodAnalytics";
import type { DashboardStats, Transaction } from "@/types";

const PALETTE = [
	"#6366f1",
	"#8b5cf6",
	"#ec4899",
	"#f97316",
	"#22c55e",
	"#14b8a6",
	"#3b82f6",
	"#eab308",
	"#ef4444",
	"#a855f7",
];

type ChartCategoryItem = {
	id?: string | null;
	name: string;
	value: number;
	color?: string;
	icon?: string;
	share?: number;
};

interface CategoryBreakdownChartProps {
	userId: string;
	transactions?: Transaction[];
	stats?: DashboardStats;
	selectedMonth?: Date;
	currency?: string;
	isLoading?: boolean;
	breakdown?: AnalyticsCategoryBreakdownItem[];
	total?: number;
	title?: string;
	periodLabel?: string;
	emptyTitle?: string;
	emptyDescription?: string;
	action?: ReactNode;
	legendMaxHeightClassName?: string;
	className?: string;
}

interface CategoryTooltipProps {
	active?: boolean;
	payload?: Array<{
		payload?: ChartCategoryItem;
		value?: number;
	}>;
	total: number;
	currency: string;
}

function getSliceColor(item: ChartCategoryItem, index: number) {
	return item.color ?? PALETTE[index % PALETTE.length];
}

function CategoryTooltip({ active, payload, total, currency }: CategoryTooltipProps) {
	const item = payload?.[0]?.payload;
	if (!active || !item) return null;

	return (
		<div className="rounded-xl border border-border/70 bg-popover/95 p-3 text-xs shadow-[var(--shadow-card)] backdrop-blur">
			<p className="mb-1 font-semibold">{item.name}</p>
			<div className="flex items-center gap-3">
				<CurrencyAmount amount={item.value} currency={currency} className="text-xs" />
				<span className="text-muted-foreground">
					{total > 0 ? `${((item.value / total) * 100).toFixed(1)}%` : "0.0%"}
				</span>
			</div>
		</div>
	);
}

function mapAnalyticsBreakdown(
	breakdown: AnalyticsCategoryBreakdownItem[] | undefined
): ChartCategoryItem[] | undefined {
	return breakdown?.map((item) => ({
		id: item.categoryId,
		name: item.title,
		value: item.amount,
		color: item.color,
		icon: item.icon,
		share: item.share,
	}));
}

function mapLegacyBreakdown(
	breakdown: LegacyCategoryBreakdownItem[] | undefined
): ChartCategoryItem[] | undefined {
	return breakdown?.map((item) => ({
		id: item.id ?? item.name,
		name: item.name,
		value: item.value,
		color: item.color,
	}));
}

export function CategoryBreakdownChart({
	userId,
	stats,
	selectedMonth = new Date(),
	currency,
	isLoading,
	breakdown,
	total,
	title,
	periodLabel,
	emptyTitle,
	emptyDescription,
	action,
	legendMaxHeightClassName = "max-h-44",
	className,
}: CategoryBreakdownChartProps) {
	const { activeCurrency } = useFilterStore();
	void userId;
	const selectedCurrency = normalizeCurrencyCode(activeCurrency);
	const displayCurrency = selectedCurrency || normalizeCurrencyCode(currency) || "PKR";
	const selectedMonthRange = getDashboardMonthRange(selectedMonth);

	const analyticsChartData = useMemo(() => mapAnalyticsBreakdown(breakdown), [breakdown]);
	const statsChartData = useMemo(
		() => mapLegacyBreakdown(getCategoryBreakdown(stats, selectedCurrency, selectedMonth)),
		[selectedCurrency, selectedMonth, stats]
	);

	const chartData = analyticsChartData ?? statsChartData;

	if (isLoading || (!breakdown && !stats)) {
		return <SkeletonChart height={280} />;
	}

	const visibleChartData = (chartData ?? []).filter((item) => item.value > 0);
	const computedTotal = total ?? visibleChartData.reduce((sum, item) => sum + item.value, 0);
	const cardTitle = title ?? `Expenses by Category · ${selectedMonthRange.label}`;
	const describedById = `category-breakdown-${cardTitle.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;

	if (!visibleChartData.length || computedTotal <= 0) {
		return (
			<div
				className={cn(
					"flex min-h-56 flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card p-6 text-center shadow-[var(--shadow-card)]",
					className
				)}>
				<p className="text-sm font-semibold">
					{emptyTitle ?? `No category spending for ${periodLabel ?? selectedMonthRange.label}`}
				</p>
				<p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground">
					{emptyDescription ?? "Expense categories will appear here when this period has spending."}
				</p>
				{action && <div className="mt-4">{action}</div>}
			</div>
		);
	}

	return (
		<div className={cn(CARD_SURFACE, "overflow-hidden p-4", className)}>
			<div className="mb-3 flex items-start justify-between gap-3">
				<div>
					<p id={describedById} className="text-sm font-semibold">
						{cardTitle}
					</p>
					{periodLabel && <p className="mt-0.5 text-xs text-muted-foreground">{periodLabel}</p>}
					<span data-testid="category-breakdown-total">
						<CurrencyAmount
							amount={computedTotal}
							currency={displayCurrency}
							className="mt-2 block text-2xl leading-8"
						/>
					</span>
				</div>
				{action}
			</div>

			<div className="grid grid-cols-[minmax(112px,0.9fr)_minmax(0,1.1fr)] items-center gap-3">
				<div
					className="h-36 min-w-0"
					role="img"
					aria-labelledby={describedById}
					aria-describedby={`${describedById}-legend`}>
					<ResponsiveContainer width="100%" height="100%">
						<PieChart>
							<Pie
								data={visibleChartData}
								cx="50%"
								cy="50%"
								innerRadius="58%"
								outerRadius="84%"
								paddingAngle={2}
								dataKey="value"
								isAnimationActive={false}>
								{visibleChartData.map((item, index) => (
									<Cell
										key={`${item.id ?? item.name}-${index}`}
										fill={getSliceColor(item, index)}
									/>
								))}
							</Pie>
							<Tooltip
								content={<CategoryTooltip total={computedTotal} currency={displayCurrency} />}
							/>
						</PieChart>
					</ResponsiveContainer>
				</div>

				<div
					id={`${describedById}-legend`}
					className={cn("no-scrollbar space-y-2 overflow-y-auto pr-1", legendMaxHeightClassName)}>
					{visibleChartData.map((item, index) => (
						<div key={`${item.id ?? item.name}-${index}`} className="flex items-center gap-2">
							<span
								className="h-2.5 w-2.5 shrink-0 rounded-full"
								style={{ backgroundColor: getSliceColor(item, index) }}
							/>
							<div className="min-w-0 flex-1">
								<p className="truncate text-xs font-medium">{item.name}</p>
								<p className="text-[10px] text-muted-foreground">
									{computedTotal > 0
										? `${((item.value / computedTotal) * 100).toFixed(1)}%`
										: "0.0%"}
								</p>
							</div>
							<span data-amount={item.value} data-testid="donut-legend-amount">
								<CurrencyAmount
									amount={item.value}
									currency={displayCurrency}
									className="text-xs"
								/>
							</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
