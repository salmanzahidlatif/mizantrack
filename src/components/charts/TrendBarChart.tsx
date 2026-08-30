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

import { SkeletonChart } from "@/components/shared/SkeletonChart";
import { useMonthlySummary } from "@/hooks/useMonthlySummary";
import { useFilterStore } from "@/store/filter-store";

import type { DashboardStats } from "@/types";

interface TrendChartProps {
	userId?: string;
	months?: number;
	stats?: DashboardStats;
}

export function TrendChart({ userId, months = 6, stats }: TrendChartProps) {
	const { activeCurrency } = useFilterStore();
	const liveData = useMonthlySummary(userId ?? "", months, activeCurrency || undefined);
	const data = stats?.perCurrency[activeCurrency || ""]?.trend ?? liveData;

	if (data === undefined) {
		return <SkeletonChart height={224} />;
	}

	return (
		<div className="rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
			<p className="mb-3 text-sm font-semibold">Income vs Expenses ({months}M)</p>
			<ResponsiveContainer width="100%" height={200}>
				<BarChart data={data} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
					<CartesianGrid strokeDasharray="3 3" className="stroke-border" />
					<XAxis dataKey="month" tick={{ fontSize: 11 }} />
					<YAxis tick={{ fontSize: 11 }} />
					<Tooltip
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						formatter={(value: any) =>
							String(
								typeof value === "number"
									? value.toLocaleString("en-US", { maximumFractionDigits: 0 })
									: (value ?? "")
							)
						}
					/>
					<Legend wrapperStyle={{ fontSize: 12 }} />
					<Bar dataKey="income" name="Income" fill="#22c55e" radius={[3, 3, 0, 0]} />
					<Bar dataKey="expense" name="Expense" fill="#ef4444" radius={[3, 3, 0, 0]} />
				</BarChart>
			</ResponsiveContainer>
		</div>
	);
}
