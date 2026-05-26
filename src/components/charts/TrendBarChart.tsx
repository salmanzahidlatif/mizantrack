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

import { useMonthlySummary } from "@/hooks/useMonthlySummary";

interface TrendChartProps {
	userId: string;
	months?: number;
}

export function TrendChart({ userId, months = 6 }: TrendChartProps) {
	const data = useMonthlySummary(userId, months);

	if (data === undefined) {
		return <div className="h-56 w-full animate-pulse rounded-xl bg-muted" />;
	}

	return (
		<div className="rounded-xl border border-border bg-card p-4">
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
