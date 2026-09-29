"use client";

import { useMemo } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import {
	getCategoryBreakdown,
	getDashboardMonthRange,
	type CategoryBreakdownItem,
} from "@/components/dashboard/monthData";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { SkeletonChart } from "@/components/shared/SkeletonChart";
import { useCategories } from "@/hooks/useCategories";
import { useFilterStore } from "@/store/filter-store";

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

interface CategoryBreakdownChartProps {
	userId: string;
	transactions?: Transaction[];
	stats?: DashboardStats;
	selectedMonth?: Date;
	currency?: string;
	isLoading?: boolean;
}

interface CategoryTooltipProps {
	active?: boolean;
	payload?: Array<{
		payload?: CategoryBreakdownItem;
		value?: number;
	}>;
	total: number;
	currency: string;
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

export function CategoryBreakdownChart({
	userId,
	transactions,
	stats,
	selectedMonth = new Date(),
	currency,
	isLoading,
}: CategoryBreakdownChartProps) {
	const { activeCurrency } = useFilterStore();
	const categories = useCategories(userId);
	const selectedCurrency = activeCurrency.length > 0 ? activeCurrency : undefined;
	const displayCurrency = selectedCurrency ?? currency ?? "PKR";
	const selectedMonthRange = getDashboardMonthRange(selectedMonth);

	const statsChartData = useMemo(
		() => getCategoryBreakdown(stats, selectedCurrency, selectedMonth),
		[selectedCurrency, selectedMonth, stats]
	);

	const transactionChartData = useMemo<CategoryBreakdownItem[] | undefined>(() => {
		if (statsChartData !== undefined) return undefined;
		if (!transactions || !categories) return undefined;

		const map = new Map<string, number>();
		for (const t of transactions) {
			if (t.type !== "Expense") continue;
			const key = t.categoryId ?? "__uncategorized__";
			map.set(key, (map.get(key) ?? 0) + t.amount);
		}
		return Array.from(map.entries())
			.map(([catId, total]) => ({
				name:
					catId === "__uncategorized__"
						? "Uncategorized"
						: (categories.find((c) => c.id === catId)?.title ?? "Unknown"),
				value: total,
			}))
			.sort((a, b) => b.value - a.value);
	}, [transactions, categories, statsChartData]);

	const chartData = statsChartData ?? transactionChartData;
	const isResolvingTransactions = Boolean(
		transactions && statsChartData === undefined && !categories
	);

	if (isLoading || (!stats && !transactions) || isResolvingTransactions) {
		return <SkeletonChart height={280} />;
	}

	if (!chartData?.length) {
		return (
			<div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-card p-6 text-center shadow-[var(--shadow-card)]">
				<p className="text-sm font-semibold">No category spending for {selectedMonthRange.label}</p>
				<p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground">
					Expense categories will appear here when this month has spending.
				</p>
			</div>
		);
	}

	const total = chartData.reduce((s, d) => s + d.value, 0);

	return (
		<div className="rounded-xl border border-border bg-card p-4">
			<p className="mb-3 text-sm font-semibold">
				Expenses by Category · {selectedMonthRange.label}
			</p>
			<ResponsiveContainer width="100%" height={240}>
				<PieChart>
					<Pie
						data={chartData}
						cx="50%"
						cy="50%"
						innerRadius={60}
						outerRadius={90}
						paddingAngle={2}
						dataKey="value">
						{chartData.map((_, index) => (
							<Cell key={index} fill={PALETTE[index % PALETTE.length]} />
						))}
					</Pie>
					<Tooltip content={<CategoryTooltip total={total} currency={displayCurrency} />} />
					<Legend wrapperStyle={{ fontSize: 12 }} />
				</PieChart>
			</ResponsiveContainer>

			{/* Breakdown table */}
			<div className="mt-2 divide-y divide-border">
				{chartData.map((item, index) => (
					<div key={item.name} className="flex items-center justify-between py-1.5">
						<div className="flex items-center gap-2">
							<span
								className="h-2.5 w-2.5 shrink-0 rounded-full"
								style={{ backgroundColor: PALETTE[index % PALETTE.length] }}
							/>
							<span className="text-xs">{item.name}</span>
						</div>
						<div className="flex items-center gap-3 text-xs text-muted-foreground">
							<span>{((item.value / total) * 100).toFixed(1)}%</span>
							<CurrencyAmount
								amount={item.value}
								currency={displayCurrency}
								className="text-xs text-foreground"
							/>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
