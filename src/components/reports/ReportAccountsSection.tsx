"use client";

import { Check, Wallet } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { CARD_SURFACE } from "@/lib/motion";
import { setAccountIncluded } from "@/lib/reports/reportRepository";
import { cn } from "@/lib/utils";

import type { Account, ReportAccountBalance } from "@/types";

interface ReportAccountsSectionProps {
	userId: string;
	accounts: Account[];
	balances: ReportAccountBalance[];
}

interface CurrencyGroup {
	currency: string;
	accounts: Account[];
}

function groupAccountsByCurrency(accounts: Account[]): CurrencyGroup[] {
	const groups = new Map<string, Account[]>();

	for (const account of accounts) {
		const currency = normalizeCurrencyCode(account.currency) || "—";
		const existing = groups.get(currency);
		if (existing) existing.push(account);
		else groups.set(currency, [account]);
	}

	return [...groups.entries()]
		.map(([currency, groupAccounts]) => ({
			currency,
			accounts: groupAccounts.slice().sort((a, b) => a.title.localeCompare(b.title)),
		}))
		.sort((first, second) => first.currency.localeCompare(second.currency));
}

export function ReportAccountsSection({ userId, accounts, balances }: ReportAccountsSectionProps) {
	const balanceByAccountId = useMemo(
		() => new Map(balances.map((balance) => [balance.accountId, balance])),
		[balances]
	);
	const groups = useMemo(() => groupAccountsByCurrency(accounts), [accounts]);

	async function handleToggle(account: Account, included: boolean) {
		try {
			await setAccountIncluded(userId, account.id, !included);
			toast.success(
				included
					? `${account.title} removed from the report.`
					: `${account.title} added to the report.`
			);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not update the account.");
		}
	}

	return (
		<section
			className={cn(CARD_SURFACE, "space-y-4 p-4")}
			aria-labelledby="report-accounts-heading">
			<div>
				<h2 id="report-accounts-heading" className="text-sm font-semibold">
					Accounts
				</h2>
				<p className="text-xs text-muted-foreground">
					Pick the accounts to include. Included accounts show their closing balance at the end of
					the period.
				</p>
			</div>

			{accounts.length === 0 ? (
				<p className="py-6 text-center text-sm text-muted-foreground">
					No accounts yet. Add an account to build a report.
				</p>
			) : (
				groups.map((group) => {
					const includedTotal = group.accounts.reduce((total, account) => {
						const balance = balanceByAccountId.get(account.id);
						return balance ? total + balance.closingBalance : total;
					}, 0);
					const includedCount = group.accounts.filter((account) =>
						balanceByAccountId.has(account.id)
					).length;

					return (
						<div key={group.currency} className="space-y-2">
							<div className="flex items-center justify-between">
								<p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
									{group.currency}
								</p>
								{includedCount > 0 && (
									<CurrencyAmount
										amount={includedTotal}
										currency={group.currency}
										className="text-xs"
									/>
								)}
							</div>

							{group.accounts.map((account) => {
								const balance = balanceByAccountId.get(account.id);
								const included = balance !== undefined;

								return (
									<button
										key={account.id}
										type="button"
										aria-pressed={included}
										onClick={() => void handleToggle(account, included)}
										className={cn(
											"flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
											included
												? "border-primary bg-primary/5"
												: "border-border bg-card hover:bg-accent/50"
										)}>
										<span className="flex min-w-0 items-center gap-2">
											<span
												className={cn(
													"flex h-5 w-5 shrink-0 items-center justify-center rounded border-2",
													included ? "border-primary bg-primary" : "border-border"
												)}>
												{included && <Check className="h-3 w-3 text-primary-foreground" />}
											</span>
											<span className="truncate text-sm font-medium">{account.title}</span>
											{account.isArchived && (
												<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
													Archived
												</span>
											)}
										</span>
										{included ? (
											<CurrencyAmount
												amount={balance.closingBalance}
												currency={balance.currency}
												showNegativeSign
												className="text-sm"
											/>
										) : (
											<Wallet className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
										)}
									</button>
								);
							})}
						</div>
					);
				})
			)}

			{accounts.length > 0 && balances.length === 0 && (
				<p className="text-xs text-muted-foreground">
					No accounts selected yet — tap an account above to include it.
				</p>
			)}
		</section>
	);
}
