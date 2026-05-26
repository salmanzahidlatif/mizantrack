"use client";

import { useMemo } from "react";
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { useCategories } from "@/hooks/useCategories";

import type { Transaction } from "@/types";

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
	transactions: Transaction[];
}

export function CategoryBreakdownChart({ userId, transactions }: CategoryBreakdownChartProps) {
	const categories = useCategories(userId);

	const chartData = useMemo(() => {
		if (!categories) return [];
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
	}, [transactions, categories]);

	if (chartData.length === 0) {
		return (
			<div className="flex h-48 items-center justify-center rounded-xl border border-border bg-card">
				<p className="text-sm text-muted-foreground">No expense data for this period</p>
			</div>
		);
	}

	const total = chartData.reduce((s, d) => s + d.value, 0);

	return (
		<div className="rounded-xl border border-border bg-card p-4">
			<p className="mb-3 text-sm font-semibold">Expenses by Category</p>
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
					<Tooltip
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						formatter={(value: any) => {
							const n = typeof value === "number" ? value : parseFloat(String(value ?? "0"));
							return [
								`${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} (${((n / total) * 100).toFixed(1)}%)`,
							];
						}}
					/>
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
							<span className="font-medium text-foreground">
								{item.value.toLocaleString("en-US", { maximumFractionDigits: 0 })}
							</span>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
