import {
	addMonths,
	endOfMonth,
	format,
	isAfter,
	isSameMonth,
	startOfMonth,
	subMonths,
} from "date-fns";

import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { ALL_CURRENCIES_KEY } from "@/lib/analytics/computeDashboardStats";

import type { DashboardStats } from "@/types";

export const DASHBOARD_MONTH_KEY_FORMAT = "yyyy-MM";
export const DASHBOARD_MONTH_LABEL_FORMAT = "MMMM yyyy";
export const DASHBOARD_MONTH_SHORT_FORMAT = "MMM yy";

export interface DashboardMonthRange {
	date: Date;
	key: string;
	label: string;
	shortLabel: string;
	from: number;
	to: number;
}

export interface MonthlyTotals {
	income: number;
	expense: number;
	hasData: boolean;
}

export interface CategoryBreakdownItem {
	id?: string;
	name: string;
	value: number;
	color?: string;
	month?: string;
}

type DashboardBucket = DashboardStats["perCurrency"][string] & {
	categoryBreakdown?: CategoryBreakdownItem[];
	categoryBreakdownByMonth?: Record<string, CategoryBreakdownItem[]>;
	expenseCategories?: CategoryBreakdownItem[];
	expenseCategoriesByMonth?: Record<string, CategoryBreakdownItem[]>;
};

export interface DashboardStatsQuery {
	month: string;
	from: number;
	to: number;
	currency?: string;
}

export function getDashboardMonthRange(date: Date): DashboardMonthRange {
	const month = startOfMonth(date);

	return {
		date: month,
		key: format(month, DASHBOARD_MONTH_KEY_FORMAT),
		label: format(month, DASHBOARD_MONTH_LABEL_FORMAT),
		shortLabel: format(month, DASHBOARD_MONTH_SHORT_FORMAT),
		from: month.getTime(),
		to: endOfMonth(month).getTime(),
	};
}

export function clampDashboardMonth(date: Date, max = new Date()) {
	const month = startOfMonth(date);
	const maxMonth = startOfMonth(max);

	return isAfter(month, maxMonth) ? maxMonth : month;
}

export function shiftDashboardMonth(date: Date, amount: number, max = new Date()) {
	return clampDashboardMonth(addMonths(startOfMonth(date), amount), max);
}

export function isCurrentDashboardMonth(date: Date, now = new Date()) {
	return isSameMonth(date, now);
}

export function getDashboardBucket(stats: DashboardStats | undefined, activeCurrency?: string) {
	if (!stats) return undefined;

	const currencyKey =
		normalizeCurrencyCode(activeCurrency) || ALL_CURRENCIES_KEY;

	return stats.perCurrency[currencyKey] as DashboardBucket | undefined;
}

export function getMonthlyTotals(
	stats: DashboardStats | undefined,
	activeCurrency: string | undefined,
	selectedMonth: Date
): MonthlyTotals | undefined {
	const bucket = getDashboardBucket(stats, activeCurrency);
	if (!bucket) return stats === undefined ? undefined : { income: 0, expense: 0, hasData: false };

	const month = getDashboardMonthRange(selectedMonth);
	const trendItem = bucket.trend.find((item) => item.month === month.shortLabel);

	if (trendItem) {
		return {
			income: trendItem.income,
			expense: trendItem.expense,
			hasData: trendItem.income > 0 || trendItem.expense > 0,
		};
	}

	if (isCurrentDashboardMonth(selectedMonth)) {
		return {
			income: bucket.monthIncome,
			expense: bucket.monthExpense,
			hasData: bucket.monthIncome > 0 || bucket.monthExpense > 0,
		};
	}

	return { income: 0, expense: 0, hasData: false };
}

export function getTrendWindow(
	stats: DashboardStats | undefined,
	activeCurrency: string | undefined,
	selectedMonth: Date,
	months: number
) {
	const bucket = getDashboardBucket(stats, activeCurrency);
	if (!bucket) return stats === undefined ? undefined : [];

	const byMonth = new Map(bucket.trend.map((item) => [item.month, item]));

	return Array.from({ length: months }, (_, index) => {
		const date = subMonths(startOfMonth(selectedMonth), months - 1 - index);
		const label = format(date, DASHBOARD_MONTH_SHORT_FORMAT);
		const existing = byMonth.get(label);

		return {
			month: label,
			income: existing?.income ?? 0,
			expense: existing?.expense ?? 0,
		};
	});
}

export function getCategoryBreakdown(
	stats: DashboardStats | undefined,
	activeCurrency: string | undefined,
	selectedMonth: Date
): CategoryBreakdownItem[] | undefined {
	const bucket = getDashboardBucket(stats, activeCurrency);
	if (!bucket) return undefined;

	const month = getDashboardMonthRange(selectedMonth);
	const byMonth = bucket.categoryBreakdownByMonth ?? bucket.expenseCategoriesByMonth;
	const monthData =
		byMonth?.[month.key] ?? byMonth?.[month.shortLabel] ?? byMonth?.[month.label] ?? undefined;
	if (monthData) return monthData;

	const flatData = bucket.categoryBreakdown ?? bucket.expenseCategories;
	if (!flatData) return undefined;

	const scopedData = flatData.filter(
		(item) =>
			!item.month ||
			item.month === month.key ||
			item.month === month.shortLabel ||
			item.month === month.label
	);

	return scopedData;
}
