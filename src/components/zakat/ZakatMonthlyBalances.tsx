"use client";

import { endOfDay } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";

import { db } from "@/lib/db/local";
import { getZakatYearMonths } from "@/lib/islamicCalendar";
import { ISLAMIC_MONTHS, type Account, type IslamicMonth } from "@/types";

interface ZakatMonthlyBalancesProps {
	userId: string;
	zakatYear: string; // e.g., "1446-1447"
	accounts: Account[];
	zakatableIds: Set<string>;
	referenceCurrency: string;
	exchangeRates: Record<string, number>;
}

export function ZakatMonthlyBalances({
	userId,
	zakatYear,
	accounts,
	zakatableIds,
	referenceCurrency,
	exchangeRates,
}: ZakatMonthlyBalancesProps) {
	const allTransactions = useLiveQuery(
		() =>
			db.transactions
				.where("userId")
				.equals(userId)
				.filter((t) => !t.deletedAt)
				.toArray(),
		[userId]
	);

	// Get the 12 Islamic months for this zakat year
	const monthsData = useMemo(() => getZakatYearMonths(zakatYear), [zakatYear]);

	// Calculate balances for each account at the end of each Islamic month
	const monthlyBalances = useMemo(() => {
		if (!allTransactions || !accounts) return null;

		const balances = new Map<string, Map<IslamicMonth, number>>();

		// Initialize maps for each account
		for (const account of accounts) {
			if (!zakatableIds.has(account.id)) continue;
			balances.set(account.id, new Map());
		}

		// Calculate balance at end of each month
		for (const { month, endDate } of monthsData) {
			const asOf = endOfDay(endDate).getTime();

			for (const account of accounts) {
				if (!zakatableIds.has(account.id)) continue;

				let balance = account.openingBalance;

				// Apply all transactions up to this date
				for (const t of allTransactions) {
					if (t.date > asOf) continue;

					if (t.accountId === account.id) {
						if (t.type === "Income") balance += t.amount;
						else if (t.type === "Expense") balance -= t.amount;
						else if (t.type === "Transfer") balance -= t.amount;
					} else if (t.toAccountId === account.id && t.type === "Transfer") {
						balance += t.amount;
					}
				}

				balances.get(account.id)?.set(month, balance);
			}
		}

		return balances;
	}, [accounts, allTransactions, monthsData, zakatableIds]);

	// Calculate totals for each month (in reference currency)
	const monthlyTotals = useMemo(() => {
		if (!monthlyBalances || !accounts) return new Map<IslamicMonth, number>();

		const totals = new Map<IslamicMonth, number>();

		for (const month of ISLAMIC_MONTHS) {
			let total = 0;

			for (const account of accounts) {
				if (!zakatableIds.has(account.id)) continue;

				const balance = monthlyBalances.get(account.id)?.get(month) ?? 0;

				// Handle liabilities (negative balances that reduce zakat)
				const isLiability = account.accountType === "liability";
				const adjustedBalance = isLiability ? -Math.abs(balance) : balance;

				// Skip if balance is negative for assets or positive for liabilities
				if ((isLiability && adjustedBalance > 0) || (!isLiability && adjustedBalance < 0)) continue;

				// Convert to reference currency
				const rate =
					account.currency === referenceCurrency ? 1 : (exchangeRates[account.currency] ?? 1);
				total += adjustedBalance * rate;
			}

			totals.set(month, total);
		}

		return totals;
	}, [monthlyBalances, accounts, zakatableIds, referenceCurrency, exchangeRates]);

	// Find minimum total (this is what zakat is calculated on)
	const minimumTotal = useMemo(() => {
		const totals = Array.from(monthlyTotals.values());
		return totals.length > 0 ? Math.min(...totals) : 0;
	}, [monthlyTotals]);

	if (!monthlyBalances) {
		return (
			<div className="rounded-lg border bg-card p-8 text-center">
				<p className="text-sm text-muted-foreground">Loading monthly balances...</p>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			<div className="flex items-start justify-between">
				<div>
					<h3 className="text-sm font-medium">Monthly Balance Progression</h3>
					<p className="text-xs text-muted-foreground">
						Account balances at the end of each Islamic month
					</p>
				</div>
				<div className="rounded-lg border bg-accent/50 px-3 py-2 text-right">
					<p className="text-xs text-muted-foreground">Minimum Zakatable Wealth</p>
					<p className="text-lg font-bold tabular-nums">
						{minimumTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })} {referenceCurrency}
					</p>
				</div>
			</div>

			{/* Scrollable table */}
			<div className="overflow-x-auto rounded-lg border">
				<table className="w-full text-sm">
					<thead className="bg-muted/50">
						<tr>
							<th className="sticky left-0 z-10 bg-muted/50 px-3 py-2 text-left font-medium">
								Account
							</th>
							{ISLAMIC_MONTHS.map((month) => (
								<th
									key={month}
									className="min-w-[100px] px-2 py-2 text-right font-medium tabular-nums">
									<div className="text-xs">{month}</div>
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{accounts
							.filter((a) => zakatableIds.has(a.id))
							.map((account) => {
								const accountBalances = monthlyBalances.get(account.id);
								if (!accountBalances) return null;

								const isLiability = account.accountType === "liability";

								return (
									<tr key={account.id} className="border-t hover:bg-accent/30">
										<td className="sticky left-0 z-10 bg-card px-3 py-2 font-medium hover:bg-accent/30">
											<div className="flex items-center gap-1.5">
												<span>{account.title}</span>
												<span className="text-xs text-muted-foreground">{account.currency}</span>
												{isLiability && (
													<span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
														Liability
													</span>
												)}
											</div>
										</td>
										{ISLAMIC_MONTHS.map((month) => {
											const balance = accountBalances.get(month) ?? 0;
											const displayBalance = isLiability ? -Math.abs(balance) : balance;

											return (
												<td
													key={month}
													className={`px-2 py-2 text-right tabular-nums ${
														displayBalance < 0 ? "text-destructive" : ""
													}`}>
													{displayBalance.toLocaleString("en-US", { maximumFractionDigits: 0 })}
												</td>
											);
										})}
									</tr>
								);
							})}

						{/* TOTAL ROW */}
						<tr className="border-t-2 border-primary/20 bg-primary/5 font-bold">
							<td className="sticky left-0 z-10 bg-primary/5 px-3 py-2">
								TOTAL ({referenceCurrency})
							</td>
							{ISLAMIC_MONTHS.map((month) => {
								const total = monthlyTotals.get(month) ?? 0;
								const isMinimum = total === minimumTotal && minimumTotal > 0;

								return (
									<td
										key={month}
										className={`px-2 py-2 text-right tabular-nums ${
											isMinimum ? "bg-primary/20 text-primary" : ""
										}`}>
										{total.toLocaleString("en-US", { minimumFractionDigits: 2 })}
									</td>
								);
							})}
						</tr>
					</tbody>
				</table>
			</div>

			<p className="text-xs text-muted-foreground">
				💡 <strong>Note:</strong> Zakat is calculated on the <strong>minimum</strong> wealth held
				for the full lunar year. The highlighted column shows the lowest total.
			</p>
		</div>
	);
}
