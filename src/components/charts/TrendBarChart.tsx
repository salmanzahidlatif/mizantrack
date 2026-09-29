"use client";

import {
	Bar,
	BarChart,
	CartesianGrid,
	Legend,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { getDashboardMonthRange, getTrendWindow } from "@/components/dashboard/monthData";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { SkeletonChart } from "@/components/shared/SkeletonChart";
import { useAnalyticsMonthSummaries } from "@/hooks/useAnalyticsMonthSummaries";
import { useFilterStore } from "@/store/filter-store";

import type { DashboardStats } from "@/types";

interface TrendChartProps {
	userId?: string;
	months?: number;
	stats?: DashboardStats;
	selectedMonth?: Date;
	currency?: string;
}

interface TrendTooltipProps {
	active?: boolean;
	label?: string;
	payload?: Array<{
		name?: string;
		value?: number;
		color?: string;
	}>;
	currency: string;
}

function TrendTooltip({ active, label, payload, currency }: TrendTooltipProps) {
	if (!active || !payload?.length) return null;

	return (
		<div className="rounded-xl border border-border/70 bg-popover/95 p-3 text-xs shadow-[var(--shadow-card)] backdrop-blur">
			<p className="mb-2 font-semibold">{label}</p>
			<div className="space-y-1.5">
				{payload.map((item) => (
					<div key={item.name} className="flex items-center justify-between gap-4">
						<span className="flex items-center gap-1.5 text-muted-foreground">
							<span
								className="h-2 w-2 rounded-full"
								style={{ backgroundColor: item.color ?? "currentColor" }}
							/>
							{item.name}
						</span>
						<CurrencyAmount amount={item.value ?? 0} currency={currency} className="text-xs" />
					</div>
				))}
			</div>
		</div>
	);
}

export function TrendChart({
	userId,
	months = 6,
	stats,
	selectedMonth = new Date(),
	currency,
}: TrendChartProps) {
	const { activeCurrency } = useFilterStore();
	const selectedCurrency = activeCurrency.length > 0 ? activeCurrency : undefined;
	const displayCurrency = selectedCurrency ?? currency ?? "PKR";
	const selectedMonthRange = getDashboardMonthRange(selectedMonth);
	const liveData = useAnalyticsMonthSummaries(
		userId ?? "",
		displayCurrency
			? {
					currency: displayCurrency,
					months,
					anchorDate: selectedMonth,
					mode: "ending",
				}
			: undefined
	)?.map((item) => ({
		month: item.month,
		income: item.income,
		expense: item.expense,
	}));
	const data =
		stats !== undefined ? getTrendWindow(stats, selectedCurrency, selectedMonth, months) : liveData;

	if (data === undefined) {
		return <SkeletonChart height={224} />;
	}

	const hasData = data.some((item) => item.income > 0 || item.expense > 0);

	if (!hasData) {
		return (
			<div className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-card p-6 text-center shadow-[var(--shadow-card)]">
				<p className="text-sm font-semibold">No trend data for {selectedMonthRange.label}</p>
				<p className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground">
					Income and expenses will appear here once this month has activity.
				</p>
			</div>
		);
	}

	return (
		<div className="rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
			<p className="mb-3 text-sm font-semibold">
				Income vs Expenses through {selectedMonthRange.label}
			</p>
			<ResponsiveContainer width="100%" height={200}>
				<BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
					<CartesianGrid strokeDasharray="3 3" className="stroke-border" />
					<XAxis dataKey="month" tick={{ fontSize: 11 }} />
					<YAxis tick={{ fontSize: 11 }} />
					<Tooltip content={<TrendTooltip currency={displayCurrency} />} />
					<Legend wrapperStyle={{ fontSize: 12 }} />
					<Bar dataKey="income" name="Income" fill="#22c55e" radius={[3, 3, 0, 0]} />
					<Bar dataKey="expense" name="Expense" fill="#ef4444" radius={[3, 3, 0, 0]} />
				</BarChart>
			</ResponsiveContainer>
		</div>
	);
}
