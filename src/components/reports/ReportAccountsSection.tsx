"use client";

import { Check, Wallet } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

import { reportListScrollClass } from "@/components/reports/reportScroll";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { currencyCodesMatch, normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { CARD_SURFACE } from "@/lib/motion";
import { setAccountIncluded } from "@/lib/reports/reportRepository";
import { cn } from "@/lib/utils";

import type { Account, ReportAccountBalance } from "@/types";

const SCROLL_AFTER_ACCOUNTS = 5;

interface ReportAccountsSectionProps {
	userId: string;
	accounts: Account[];
	balances: ReportAccountBalance[];
	/** The single currency the whole report is scoped to. */
	currency: string;
}

export function ReportAccountsSection({
	userId,
	accounts,
	balances,
	currency,
}: ReportAccountsSectionProps) {
	const reportCurrency = normalizeCurrencyCode(currency);

	const balanceByAccountId = useMemo(
		() => new Map(balances.map((balance) => [balance.accountId, balance])),
		[balances]
	);

	// Only accounts in the selected currency are offered: the report never mixes currencies,
	// so there is nothing left to group by and a flat, sorted list is enough.
	const visibleAccounts = useMemo(
		() =>
			accounts
				.filter(
					(account) => !reportCurrency || currencyCodesMatch(account.currency, reportCurrency)
				)
				.slice()
				.sort((first, second) => first.title.localeCompare(second.title)),
		[accounts, reportCurrency]
	);

	const includedAccounts = visibleAccounts.filter((account) => balanceByAccountId.has(account.id));
	const includedTotal = includedAccounts.reduce(
		(total, account) => total + (balanceByAccountId.get(account.id)?.closingBalance ?? 0),
		0
	);

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
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<h2 id="report-accounts-heading" className="text-sm font-semibold">
						Accounts
					</h2>
					<p className="text-xs text-muted-foreground">
						Pick the accounts to include. Only {reportCurrency || "your"} accounts can be included,
						and each shows its closing balance at the end of the period.
					</p>
				</div>
				<p className="text-xs text-muted-foreground" data-testid="report-accounts-summary">
					{includedAccounts.length} of {visibleAccounts.length} included
				</p>
			</div>

			{visibleAccounts.length === 0 ? (
				<p className="py-6 text-center text-sm text-muted-foreground">
					{reportCurrency
						? `No ${reportCurrency} accounts yet. Add one, or switch the report currency above.`
						: "No accounts yet. Add an account to build a report."}
				</p>
			) : (
				<>
					{includedAccounts.length > 0 && (
						<div className="flex items-center justify-between rounded-xl bg-muted/35 px-3 py-2">
							<span className="text-xs font-medium">Included total</span>
							<CurrencyAmount
								amount={includedTotal}
								currency={reportCurrency}
								showNegativeSign
								className="text-sm"
							/>
						</div>
					)}

					<div
						className={cn(
							"space-y-2",
							reportListScrollClass(visibleAccounts.length, SCROLL_AFTER_ACCOUNTS)
						)}>
						{visibleAccounts.map((account) => {
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
				</>
			)}

			{visibleAccounts.length > 0 && includedAccounts.length === 0 && (
				<p className="text-xs text-muted-foreground">
					No accounts selected yet — tap an account above to include it.
				</p>
			)}
		</section>
	);
}
