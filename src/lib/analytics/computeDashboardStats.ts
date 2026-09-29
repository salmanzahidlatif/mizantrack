import { endOfMonth, format, startOfMonth, subMonths } from "date-fns";

import { db } from "@/lib/db/local";

import type { Account, DashboardStats, Transaction } from "@/types";

const TREND_MONTHS = 6;

// Firestore rejects empty-string field names (`setDoc` errors with
// "Document fields must not be empty"), so the "all currencies combined"
// bucket in `perCurrency` must use a non-empty sentinel key instead of "".
export const ALL_CURRENCIES_KEY = "ALL";

/**
 * Deep-removes any `undefined` values from an object/array (Firestore's
 * `setDoc` rejects fields with `undefined`, only `null` or omission is
 * allowed). Used to clean stale cached `DashboardStats` records that were
 * computed by an older version of `computeDashboardStats` before optional
 * fields were properly omitted.
 */
function stripUndefinedDeep<T>(value: T): T {
	if (Array.isArray(value)) {
		return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
	}

	if (value !== null && typeof value === "object") {
		const result: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
			if (val === undefined) continue;
			result[key] = stripUndefinedDeep(val);
		}
		return result as T;
	}

	return value;
}

/**
 * Normalizes a `DashboardStats` object so `perCurrency` never has an empty
 * string key. Older cached records (computed before `ALL_CURRENCIES_KEY` was
 * introduced) may still have `perCurrency[""]` — Firestore's `setDoc` throws
 * "Document fields must not be empty" if pushed as-is. Safe to call on any
 * `DashboardStats`, including already-normalized ones (no-op in that case).
 * Also strips any stray `undefined` values left over from older cached
 * records (Firestore rejects those too, with "Unsupported field value").
 */
export function sanitizeDashboardStats(stats: DashboardStats): DashboardStats {
	let result = stats;

	if (Object.prototype.hasOwnProperty.call(stats.perCurrency, "")) {
		const { "": allCurrencies, ...rest } = stats.perCurrency;
		result = allCurrencies
			? {
					...stats,
					perCurrency: {
						...rest,
						[ALL_CURRENCIES_KEY]: rest[ALL_CURRENCIES_KEY] ?? allCurrencies,
					},
				}
			: { ...stats, perCurrency: rest };
	}

	return stripUndefinedDeep(result);
}

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

function isKnownCrossCurrencyTransfer(
	transaction: Transaction,
	accountById: Map<string, Account>
): boolean {
	if (transaction.type !== "Transfer" || !transaction.toAccountId) return false;

	const sourceAccount = accountById.get(transaction.accountId);
	const destinationAccount = accountById.get(transaction.toAccountId);

	return Boolean(
		sourceAccount && destinationAccount && sourceAccount.currency !== destinationAccount.currency
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
			const isCrossCurrency = isKnownCrossCurrencyTransfer(transaction, accountById);
			if (sourceBalance !== undefined) {
				balances[transaction.accountId] = sourceBalance - transaction.amount;
			}

			if (transaction.toAccountId) {
				const destinationBalance = balances[transaction.toAccountId];
				if (destinationBalance !== undefined) {
					if (isCrossCurrency) {
						// `travelCurrency` is travel-spend display metadata, not a transfer FX
						// contract. Without a destination amount/rate, adding source-currency
						// `amount` would corrupt the destination currency's balance.
						continue;
					}
					balances[transaction.toAccountId] = destinationBalance + transaction.amount;
				}
			}
		}
	}

	const aggregates = new Map<string, AggregateState>();
	aggregates.set(ALL_CURRENCIES_KEY, createAggregateState(now, null));
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

			// Firestore's setDoc() rejects any field whose value is `undefined`
			// (it requires the key to be omitted entirely instead), so optional
			// fields must only be included when actually present.
			return {
				id: transaction.id,
				type: transaction.type,
				date: transaction.date,
				amount: transaction.amount,
				...(transaction.description !== undefined && { description: transaction.description }),
				...(transaction.place !== undefined && { place: transaction.place }),
				accountId: transaction.accountId,
				accountTitle: account?.title ?? "—",
				accountCurrency: account?.currency ?? "",
				...(transaction.toAccountId !== undefined && { toAccountId: transaction.toAccountId }),
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
