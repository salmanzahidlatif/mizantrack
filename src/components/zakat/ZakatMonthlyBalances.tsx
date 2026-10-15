"use client";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { formatZakatMonthRange } from "@/lib/zakatEngine";

import type { ZakatBasis, ZakatYearGrid } from "@/lib/zakatEngine";

interface ZakatMonthlyBalancesProps {
	/** The engine's own grid for the selected year. Undefined while balances load. */
	grid?: ZakatYearGrid;
	/**
	 * The single currency this year is expressed in. One zakat result per currency:
	 * nothing here is converted and no exchange rate is applied (decision 5).
	 */
	currency: string;
	/** Which monthly TOTAL feeds the calculation, so the grid can highlight it. */
	basis: ZakatBasis;
}

export function ZakatMonthlyBalances({ grid, currency, basis }: ZakatMonthlyBalancesProps) {
	if (!grid) {
		return (
			<div className="rounded-lg border bg-card p-8 text-center">
				<p className="text-sm text-muted-foreground">Loading monthly balances...</p>
			</div>
		);
	}

	const { months } = grid.year;
	// Every included account contributes its month-end balance as it stands — a negative
	// asset genuinely reduces wealth, so nothing is dropped for having the "wrong" sign,
	// and a closed account still counts for the years it was open. The signs themselves
	// come from `normalizeZakatAccountBalance` inside the engine.
	const basisAmount = basis === "minimum" ? grid.minimum : grid.maximum;

	return (
		<div className="space-y-3">
			<div className="flex items-start justify-between">
				<div>
					<h3 className="text-sm font-medium">Monthly Balance Progression</h3>
					<p className="text-xs text-muted-foreground">
						Account balances at the end of each Islamic month, in {currency}
					</p>
				</div>
				<div className="flex gap-2">
					<div className="rounded-lg border bg-accent/50 px-3 py-2 text-right">
						<p className="text-xs text-muted-foreground">MINIMUM</p>
						<p className="text-lg font-bold tabular-nums">
							<CurrencyAmount
								amount={grid.minimum}
								currency={currency}
								showNegativeSign
								className="text-lg font-bold"
							/>
						</p>
					</div>
					<div className="rounded-lg border bg-accent/50 px-3 py-2 text-right">
						<p className="text-xs text-muted-foreground">MAXIMUM</p>
						<p className="text-lg font-bold tabular-nums">
							<CurrencyAmount
								amount={grid.maximum}
								currency={currency}
								showNegativeSign
								className="text-lg font-bold"
							/>
						</p>
					</div>
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
							{months.map((month) => (
								<th
									key={`${month.month}-${month.islamicYear}`}
									className="min-w-[110px] px-2 py-2 text-right font-medium tabular-nums">
									<div className="text-xs">{month.month}</div>
									<div className="text-[10px] font-normal text-muted-foreground">
										{formatZakatMonthRange(month)}
									</div>
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{grid.accounts.map((account) => (
							<tr key={account.accountId} className="border-t hover:bg-accent/30">
								<td className="sticky left-0 z-10 bg-card px-3 py-2 font-medium hover:bg-accent/30">
									<div className="flex items-center gap-1.5">
										<span>{account.accountTitle}</span>
										<span className="text-xs text-muted-foreground">{account.currency}</span>
										{account.accountType === "liability" && (
											<span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
												Liability
											</span>
										)}
										{account.isArchived && (
											<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
												Closed
											</span>
										)}
									</div>
								</td>
								{months.map((month, index) => {
									const balance = account.balances[index] ?? 0;

									return (
										<td
											key={`${month.month}-${month.islamicYear}`}
											className={`px-2 py-2 text-right tabular-nums ${
												balance < 0 ? "text-destructive" : ""
											}`}>
											<CurrencyAmount
												amount={balance}
												currency={account.currency}
												showNegativeSign
												className="font-normal tracking-normal"
											/>
										</td>
									);
								})}
							</tr>
						))}

						{/* TOTAL ROW */}
						<tr className="border-t-2 border-primary/20 bg-primary/5 font-bold">
							<td className="sticky left-0 z-10 bg-primary/5 px-3 py-2">TOTAL ({currency})</td>
							{months.map((month, index) => {
								const total = grid.monthlyTotals[index] ?? 0;
								const isBasisMonth = total === basisAmount;

								return (
									<td
										key={`${month.month}-${month.islamicYear}`}
										className={`px-2 py-2 text-right tabular-nums ${
											isBasisMonth ? "bg-primary/20 text-primary" : ""
										}`}>
										<CurrencyAmount
											amount={total}
											currency={currency}
											showNegativeSign
											className="font-bold tracking-normal"
										/>
									</td>
								);
							})}
						</tr>
					</tbody>
				</table>
			</div>

			<p className="text-xs text-muted-foreground">
				💡 <strong>Note:</strong> Zakat is calculated on the{" "}
				<strong>{basis === "minimum" ? "minimum" : "maximum"}</strong> monthly total of the lunar
				year. The highlighted column is the one feeding the calculation.
			</p>
		</div>
	);
}
