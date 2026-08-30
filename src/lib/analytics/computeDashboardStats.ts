import { endOfMonth, format, startOfMonth, subMonths } from "date-fns";

import { db } from "@/lib/db/local";

import type { Account, DashboardStats, Transaction } from "@/types";

const TREND_MONTHS = 6;

type TrendItem = DashboardStats["perCurrency"][string]["trend"][number];

interface AggregateState {
	accountIds: Set<string> | null;
	summary: DashboardStats["perCurrency"][string];
	trendMap: Map<string, TrendItem>;
}

function createAggregateState(now: Date, accountIds: Set<string> | null): AggregateState {
	const trend: TrendItem[] = [];
	const trendMap = new Map<string, TrendItem>();

	for (let i = TREND_MONTHS - 1; i >= 0; i--) {
		const label = format(subMonths(now, i), "MMM yy");
		const bucket: TrendItem = { month: label, income: 0, expense: 0 };
		trend.push(bucket);
		trendMap.set(label, bucket);
	}

	return {
		accountIds,
		summary: {
			monthIncome: 0,
			monthExpense: 0,
			trend,
		},
		trendMap,
	};
}

function matchesCurrency(transaction: Transaction, accountIds: Set<string> | null): boolean {
	if (!accountIds) return true;

	return (
		accountIds.has(transaction.accountId) ||
		(Boolean(transaction.toAccountId) && accountIds.has(transaction.toAccountId!))
	);
}

export async function computeDashboardStats(userId: string): Promise<DashboardStats> {
	const [accounts, transactions] = await Promise.all([
		db.accounts
			.where("userId")
			.equals(userId)
			.filter((account) => !account.deletedAt)
			.toArray(),
		db.transactions
			.where("userId")
			.equals(userId)
			.filter((transaction) => !transaction.deletedAt)
			.toArray(),
	]);

	const now = new Date();
	const nowMs = Date.now();
	const monthStart = startOfMonth(now).getTime();
	const monthEnd = endOfMonth(now).getTime();
	const trendStart = startOfMonth(subMonths(now, TREND_MONTHS - 1)).getTime();

	const balances: Record<string, number> = {};
	const accountById = new Map<string, Account>();
	const currencyAccountIds = new Map<string, Set<string>>();

	for (const account of accounts) {
		accountById.set(account.id, account);
		balances[account.id] = account.openingBalance;

		if (!currencyAccountIds.has(account.currency)) {
			currencyAccountIds.set(account.currency, new Set());
		}
		currencyAccountIds.get(account.currency)!.add(account.id);
	}

	for (const transaction of transactions) {
		const sourceBalance = balances[transaction.accountId];

		if (transaction.type === "Income" && sourceBalance !== undefined) {
			balances[transaction.accountId] = sourceBalance + transaction.amount;
		} else if (transaction.type === "Expense" && sourceBalance !== undefined) {
			balances[transaction.accountId] = sourceBalance - transaction.amount;
		} else if (transaction.type === "Transfer") {
			if (sourceBalance !== undefined) {
				balances[transaction.accountId] = sourceBalance - transaction.amount;
			}

			if (transaction.toAccountId) {
				const destinationBalance = balances[transaction.toAccountId];
				if (destinationBalance !== undefined) {
					balances[transaction.toAccountId] = destinationBalance + transaction.amount;
				}
			}
		}
	}

	const aggregates = new Map<string, AggregateState>();
	aggregates.set("", createAggregateState(now, null));
	for (const [currency, accountIds] of currencyAccountIds.entries()) {
		aggregates.set(currency, createAggregateState(now, accountIds));
	}

	for (const transaction of transactions) {
		for (const state of aggregates.values()) {
			if (!matchesCurrency(transaction, state.accountIds)) continue;

			if (transaction.date >= monthStart && transaction.date <= monthEnd) {
				if (transaction.type === "Income") {
					state.summary.monthIncome += transaction.amount;
				} else if (transaction.type === "Expense") {
					state.summary.monthExpense += transaction.amount;
				}
			}

			if (transaction.date < trendStart || transaction.date > nowMs) continue;

			const bucket = state.trendMap.get(format(new Date(transaction.date), "MMM yy"));
			if (!bucket) continue;

			if (transaction.type === "Income") {
				bucket.income += transaction.amount;
			} else if (transaction.type === "Expense") {
				bucket.expense += transaction.amount;
			}
		}
	}

	const recent = [...transactions]
		.sort((a, b) => b.date - a.date)
		.slice(0, 20)
		.map((transaction) => {
			const account = accountById.get(transaction.accountId);

			return {
				id: transaction.id,
				type: transaction.type,
				date: transaction.date,
				amount: transaction.amount,
				description: transaction.description,
				place: transaction.place,
				accountId: transaction.accountId,
				accountTitle: account?.title ?? "—",
				accountCurrency: account?.currency ?? "",
				toAccountId: transaction.toAccountId,
			};
		});

	const perCurrency = Object.fromEntries(
		[...aggregates.entries()].map(([currency, state]) => [currency, state.summary])
	) as DashboardStats["perCurrency"];

	return {
		id: userId,
		updatedAt: Date.now(),
		balances,
		perCurrency,
		recent,
	};
}
