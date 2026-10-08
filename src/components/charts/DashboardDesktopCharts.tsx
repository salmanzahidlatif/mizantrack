"use client";

import { useMemo } from "react";
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Cell,
	Pie,
	PieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

import { MeasuredChartContainer } from "@/components/charts/MeasuredChartContainer";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { SkeletonChart } from "@/components/shared/SkeletonChart";
import { CARD_SURFACE } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type { AccountsAnalytics, AnalyticsMonthSummaryItem } from "@/lib/analytics/periodAnalytics";

const ACCOUNT_PALETTE = [
	"#6366f1",
	"#8b5cf6",
	"#ec4899",
	"#f97316",
	"#22c55e",
	"#14b8a6",
	"#3b82f6",
	"#eab308",
];

interface TrendChartProps {
	summaries?: AnalyticsMonthSummaryItem[];
	currency: string;
	isLoading?: boolean;
	className?: string;
}

interface AccountDistributionChartProps {
	analytics?: AccountsAnalytics;
	isLoading?: boolean;
	className?: string;
}

interface MoneyTooltipProps {
	active?: boolean;
	label?: string;
	payload?: Array<{
		name?: string;
		value?: number;
		color?: string;
		payload?: {
			currency?: string;
		};
	}>;
	currency: string;
}

interface AccountTooltipProps {
	active?: boolean;
	payload?: Array<{
		payload?: {
			title: string;
			balance: number;
			currency: string;
		};
	}>;
}

function ChartEmptyState({
	title,
	description,
	className,
}: {
	title: string;
	description: string;
	className?: string;
}) {
	return (
		<section
			className={cn(
				CARD_SURFACE,
				"flex min-h-56 flex-col items-center justify-center border-dashed p-4 text-center md:min-h-[320px] md:p-6",
				className
			)}>
			<h2 className="text-sm font-semibold">{title}</h2>
			<p className="mt-2 max-w-72 text-xs leading-5 text-muted-foreground">{description}</p>
		</section>
	);
}

function MoneyTooltip({ active, label, payload, currency }: MoneyTooltipProps) {
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
						<CurrencyAmount
							amount={item.value ?? 0}
							currency={item.payload?.currency ?? currency}
							className="text-xs tabular-nums"
						/>
					</div>
				))}
			</div>
		</div>
	);
}

function AccountTooltip({ active, payload }: AccountTooltipProps) {
	const item = payload?.[0]?.payload;
	if (!active || !item) return null;

	return (
		<div className="rounded-xl border border-border/70 bg-popover/95 p-3 text-xs shadow-[var(--shadow-card)] backdrop-blur">
			<p className="mb-1 font-semibold">{item.title}</p>
			<CurrencyAmount
				amount={item.balance}
				currency={item.currency}
				colorized
				showNegativeSign
				className="text-xs tabular-nums"
			/>
		</div>
	);
}

export function CashFlowTrendChart({ summaries, currency, isLoading, className }: TrendChartProps) {
	const data = useMemo(
		() =>
			summaries?.map((item) => ({
				month: item.month,
				income: item.income,
				expense: item.expense,
				net: item.net,
				currency: item.currency,
			})),
		[summaries]
	);
	const latest = data?.at(-1);
	const hasData = data?.some((item) => item.income > 0 || item.expense > 0);

	if (isLoading || summaries === undefined) return <SkeletonChart height={320} />;
	if (!hasData) {
		return (
			<ChartEmptyState
				title="No cash-flow trend yet"
				description="Income and expense trends will appear once this currency has transactions in the selected window."
				className={className}
			/>
		);
	}

	return (
		<section
			className={cn(CARD_SURFACE, "overflow-hidden p-4 md:h-full md:p-5", className)}
			aria-labelledby="cash-flow-trend-title">
			<div className="mb-3 flex flex-wrap items-start justify-between gap-3 md:mb-4 md:gap-4">
				<div>
					<h2 id="cash-flow-trend-title" className="text-sm font-semibold">
						Income vs expense trend
					</h2>
					<p className="mt-1 text-xs text-muted-foreground">
						Last {data?.length ?? 0} months in the selected currency
					</p>
				</div>
				{latest && (
					<div className="grid grid-cols-3 gap-2 text-right text-[11px] md:gap-3 md:text-xs">
						<div>
							<p className="text-muted-foreground">Income</p>
							<CurrencyAmount
								amount={latest.income}
								currency={latest.currency}
								variant="positive"
								className="tabular-nums"
							/>
						</div>
						<div>
							<p className="text-muted-foreground">Expense</p>
							<CurrencyAmount
								amount={latest.expense}
								currency={latest.currency}
								variant="negative"
								className="tabular-nums"
							/>
						</div>
						<div>
							<p className="text-muted-foreground">Net</p>
							<CurrencyAmount
								amount={latest.net}
								currency={latest.currency}
								colorized
								showNegativeSign
								className="tabular-nums"
							/>
						</div>
					</div>
				)}
			</div>

			<div className="no-scrollbar overflow-x-auto">
				<MeasuredChartContainer
					className="h-56 min-w-[460px] md:h-72 md:min-w-0"
					labelledBy="cash-flow-trend-title"
					describedBy="cash-flow-trend-legend">
					{(size) => (
						<ResponsiveContainer width="100%" height="100%" debounce={80} initialDimension={size}>
							<BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
								<CartesianGrid strokeDasharray="3 3" className="stroke-border" />
								<XAxis dataKey="month" tick={{ fontSize: 10 }} />
								<YAxis hide />
								<Tooltip content={<MoneyTooltip currency={currency} />} />
								<Bar
									dataKey="income"
									name="Income"
									fill="#22c55e"
									radius={[5, 5, 0, 0]}
									isAnimationActive={false}
								/>
								<Bar
									dataKey="expense"
									name="Expense"
									fill="#ef4444"
									radius={[5, 5, 0, 0]}
									isAnimationActive={false}
								/>
							</BarChart>
						</ResponsiveContainer>
					)}
				</MeasuredChartContainer>
			</div>

			<div
				id="cash-flow-trend-legend"
				className="mt-3 flex flex-wrap gap-2 text-xs md:mt-4 md:gap-3">
				<span className="inline-flex items-center gap-2 rounded-full bg-muted px-2.5 py-1.5 md:px-3">
					<span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
					Income bars
				</span>
				<span className="inline-flex items-center gap-2 rounded-full bg-muted px-2.5 py-1.5 md:px-3">
					<span className="h-2.5 w-2.5 rounded-full bg-red-500" />
					Expense bars
				</span>
			</div>
		</section>
	);
}

export function SpendingTrendChart({ summaries, currency, isLoading, className }: TrendChartProps) {
	const data = useMemo(
		() =>
			summaries?.map((item) => ({
				month: item.month,
				expense: item.expense,
				currency: item.currency,
			})),
		[summaries]
	);
	const nonZeroExpenses = data?.filter((item) => item.expense > 0) ?? [];
	const highest = nonZeroExpenses.reduce<(typeof nonZeroExpenses)[number] | undefined>(
		(max, item) => (!max || item.expense > max.expense ? item : max),
		undefined
	);
	const average =
		nonZeroExpenses.length > 0
			? nonZeroExpenses.reduce((sum, item) => sum + item.expense, 0) / nonZeroExpenses.length
			: 0;

	if (isLoading || summaries === undefined) return <SkeletonChart height={260} />;
	if (!nonZeroExpenses.length) {
		return (
			<ChartEmptyState
				title="No spending trend yet"
				description="Monthly spending bars will appear here after expenses are recorded."
				className={className}
			/>
		);
	}

	return (
		<section
			className={cn(CARD_SURFACE, "overflow-hidden p-4 md:h-full md:p-5", className)}
			aria-labelledby="spending-trend-title">
			<div className="mb-3 md:mb-4">
				<h2 id="spending-trend-title" className="text-sm font-semibold">
					Spending trend
				</h2>
				<p className="mt-1 text-xs text-muted-foreground">
					Expense movement for the selected currency
				</p>
			</div>
			<div className="no-scrollbar overflow-x-auto">
				<MeasuredChartContainer
					className="h-40 min-w-[420px] md:h-48 md:min-w-0"
					labelledBy="spending-trend-title"
					describedBy="spending-trend-legend">
					{(size) => (
						<ResponsiveContainer width="100%" height="100%" debounce={80} initialDimension={size}>
							<AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
								<CartesianGrid strokeDasharray="3 3" className="stroke-border" />
								<XAxis dataKey="month" tick={{ fontSize: 10 }} />
								<YAxis hide />
								<Tooltip content={<MoneyTooltip currency={currency} />} />
								<Area
									type="monotone"
									dataKey="expense"
									name="Expense"
									stroke="#ef4444"
									fill="#ef4444"
									fillOpacity={0.18}
									isAnimationActive={false}
								/>
							</AreaChart>
						</ResponsiveContainer>
					)}
				</MeasuredChartContainer>
			</div>
			<div
				id="spending-trend-legend"
				className="mt-3 grid w-full grid-cols-[repeat(2,minmax(0,1fr))] gap-2 text-xs md:mt-4 md:gap-3">
				<div className="min-w-0 rounded-2xl bg-muted/45 p-2.5 md:p-3">
					<p className="text-muted-foreground">Highest month</p>
					<p className="mt-1 font-semibold">{highest?.month}</p>
					<CurrencyAmount
						amount={highest?.expense ?? 0}
						currency={highest?.currency ?? currency}
						variant="negative"
						className="tabular-nums"
					/>
				</div>
				<div className="min-w-0 rounded-2xl bg-muted/45 p-2.5 md:p-3">
					<p className="text-muted-foreground">Average active month</p>
					<CurrencyAmount
						amount={average}
						currency={currency}
						variant="negative"
						className="mt-1 block tabular-nums"
					/>
				</div>
			</div>
		</section>
	);
}

export function AccountDistributionChart({
	analytics,
	isLoading,
	className,
}: AccountDistributionChartProps) {
	const data = useMemo(
		() =>
			analytics?.accounts
				.filter((account) => !account.isArchived && account.balance > 0)
				.slice(0, 8)
				.map((account, index) => ({
					...account,
					title: account.title,
					value: account.balance,
					color: account.color ?? ACCOUNT_PALETTE[index % ACCOUNT_PALETTE.length],
				})),
		[analytics]
	);

	if (isLoading || analytics === undefined) return <SkeletonChart height={260} />;
	if (!data?.length) {
		return (
			<ChartEmptyState
				title="No positive account balances"
				description="Account distribution appears once this currency has an active account with a positive balance."
				className={className}
			/>
		);
	}

	return (
		<section
			className={cn(CARD_SURFACE, "flex flex-col overflow-hidden p-4 md:h-full md:p-5", className)}
			aria-labelledby="account-distribution-title"
			data-testid="account-distribution-chart">
			<div className="mb-3 flex items-start justify-between gap-3 md:mb-4">
				<div>
					<h2 id="account-distribution-title" className="text-sm font-semibold">
						Account distribution
					</h2>
					<p className="mt-1 text-xs text-muted-foreground">
						Positive balances in {analytics.currency}
					</p>
				</div>
				<CurrencyAmount
					amount={analytics.netWorth}
					currency={analytics.currency}
					colorized
					showNegativeSign
					className="text-sm tabular-nums"
				/>
			</div>
			<div className="grid min-h-0 grid-cols-[minmax(128px,0.9fr)_minmax(0,1.1fr)] items-center gap-4 md:flex-1">
				<MeasuredChartContainer
					className="h-36 md:h-44"
					labelledBy="account-distribution-title"
					describedBy="account-distribution-legend">
					{(size) => (
						<ResponsiveContainer width="100%" height="100%" debounce={80} initialDimension={size}>
							<PieChart>
								<Pie
									data={data}
									cx="50%"
									cy="50%"
									innerRadius="56%"
									outerRadius="84%"
									paddingAngle={2}
									dataKey="value"
									isAnimationActive={false}>
									{data.map((item) => (
										<Cell key={item.accountId} fill={item.color} />
									))}
								</Pie>
								<Tooltip content={<AccountTooltip />} />
							</PieChart>
						</ResponsiveContainer>
					)}
				</MeasuredChartContainer>
				<div
					id="account-distribution-legend"
					data-testid="account-distribution-legend"
					className="no-scrollbar max-h-36 space-y-2 overflow-y-auto overscroll-contain pr-1 pb-1 md:max-h-44">
					{data.map((account) => (
						<div
							key={account.accountId}
							className="flex min-h-9 items-center gap-2"
							data-testid="account-distribution-row">
							<span
								className="h-2.5 w-2.5 shrink-0 rounded-full"
								style={{ backgroundColor: account.color }}
							/>
							<div className="min-w-0 flex-1">
								<p className="truncate text-xs font-medium">{account.title}</p>
								<p className="text-[10px] text-muted-foreground">{account.currency}</p>
							</div>
							<span
								className="shrink-0 text-right"
								data-testid="account-distribution-amount"
								data-amount={account.balance}>
								<CurrencyAmount
									amount={account.balance}
									currency={account.currency}
									className="text-xs tabular-nums"
								/>
							</span>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
