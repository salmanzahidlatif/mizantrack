"use client";

import { ArrowDown, ArrowUp, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { AccountDrawer } from "@/components/accounts/AccountDrawer";
import { AccountList } from "@/components/accounts/AccountList";
import { accountSortOptions, type AccountSort } from "@/components/accounts/accountSort";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useAccounts } from "@/hooks/useAccounts";
import { useAccountsAnalytics } from "@/hooks/useAccountsAnalytics";
import { useDbConfig } from "@/hooks/useDbConfig";
import { useHaptics } from "@/hooks/useHaptics";
import { CARD_SURFACE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useFilterStore } from "@/store/filter-store";
import { useUIStore } from "@/store/ui-store";

import type { AccountsAnalytics } from "@/lib/analytics/periodAnalytics";

interface AccountsPageClientProps {
	userId: string;
}

function SummaryAmountSkeleton({ className }: { className?: string }) {
	return <span className={cn("shimmer inline-block rounded-full bg-muted/70", className)} />;
}

function AccountsSummaryCard({
	analytics,
	currency,
}: {
	analytics: AccountsAnalytics | undefined;
	currency: string;
}) {
	return (
		<section
			aria-label="Accounts summary"
			className={cn(CARD_SURFACE, "fade-scale-in overflow-hidden p-4 sm:p-5")}>
			<div className="flex items-start justify-between gap-3">
				<div>
					<p className="text-xs font-bold tracking-[0.16em] text-muted-foreground uppercase">
						All Accounts
					</p>
					<h2 className="mt-2 text-sm font-medium text-muted-foreground">
						Net worth (as of today)
					</h2>
				</div>
				<span className="rounded-full border border-border/70 bg-background/70 px-2.5 py-1 text-xs font-bold tracking-[0.14em] text-muted-foreground uppercase">
					{currency}
				</span>
			</div>

			<div className="mt-3">
				{analytics ? (
					<CurrencyAmount
						amount={analytics.netWorth}
						currency={analytics.currency}
						colorized
						showNegativeSign
						className="text-3xl leading-10 sm:text-4xl"
					/>
				) : (
					<SummaryAmountSkeleton className="h-10 w-56" />
				)}
			</div>

			<div className="mt-5 grid grid-cols-2 gap-3">
				<div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/10 p-3">
					<div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
						<ArrowDown className="h-3.5 w-3.5" />
						<span>Inflow</span>
					</div>
					{analytics ? (
						<CurrencyAmount
							amount={analytics.inflow}
							currency={analytics.currency}
							variant="positive"
							className="max-w-full truncate text-base leading-6 sm:text-lg"
						/>
					) : (
						<SummaryAmountSkeleton className="h-6 w-28" />
					)}
				</div>

				<div className="rounded-2xl border border-red-500/15 bg-red-500/10 p-3">
					<div className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-300">
						<ArrowUp className="h-3.5 w-3.5" />
						<span>Outflow</span>
					</div>
					{analytics ? (
						<CurrencyAmount
							amount={analytics.outflow}
							currency={analytics.currency}
							variant="negative"
							className="max-w-full truncate text-base leading-6 sm:text-lg"
						/>
					) : (
						<SummaryAmountSkeleton className="h-6 w-28" />
					)}
				</div>
			</div>
		</section>
	);
}

export function AccountsPageClient({ userId }: AccountsPageClientProps) {
	const router = useRouter();
	const { activeCurrency, showArchivedAccounts, setShowArchivedAccounts, setAccountId } =
		useFilterStore();
	const [sortBy, setSortBy] = useState<AccountSort>("balance-desc");
	const openAddAccount = useUIStore((s) => s.openAddAccount);
	const haptics = useHaptics();
	const config = useDbConfig(userId);
	const resolvedCurrency = activeCurrency !== "" ? activeCurrency : (config?.currency ?? "PKR");
	const asOf = useMemo(() => new Date(), []);
	const analyticsQuery = useMemo(
		() => ({
			currency: resolvedCurrency,
			enabledCurrencies: config?.enabledCurrencies,
			asOf,
			period: { interval: "all-time" as const },
		}),
		[asOf, config?.enabledCurrencies, resolvedCurrency]
	);
	const analytics = useAccountsAnalytics(userId, analyticsQuery);

	function handleAddAccount() {
		haptics.light();
		openAddAccount();
	}

	function handleSelectAccount(accountId: string) {
		// Select this account in the shared filter store (other filters like period,
		// category, search stay as-is) and jump to Transactions to view its history.
		setAccountId(accountId);
		router.push("/transactions");
	}

	// Keep every account reachable; income/expense analytics remain scoped by currency.
	const accounts = useAccounts(userId, {
		showArchived: showArchivedAccounts,
	});

	// Also fetch archived count to show/hide toggle
	const allAccounts = useAccounts(userId, {
		showArchived: true,
	});
	const hasArchived = allAccounts?.some((a) => a.isArchived) ?? false;

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="hidden text-2xl font-bold md:block">Accounts</h1>
					{accounts !== undefined && (
						<p className="text-sm text-muted-foreground">
							{accounts.filter((a) => !a.isArchived && !a.deletedAt).length} active
						</p>
					)}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Select value={sortBy} onValueChange={(v) => setSortBy(v as AccountSort)}>
						<SelectTrigger className="h-8 w-36 sm:w-44">
							<SelectValue placeholder="Sort by" />
						</SelectTrigger>
						<SelectContent>
							{accountSortOptions.map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{hasArchived && (
						<Button
							variant="outline"
							size="sm"
							onClick={() => setShowArchivedAccounts(!showArchivedAccounts)}>
							{showArchivedAccounts ? "Hide Archived" : "Show Archived"}
						</Button>
					)}
					<Button size="sm" onClick={handleAddAccount}>
						<Plus className="mr-1.5 h-4 w-4" />
						Add
					</Button>
				</div>
			</div>

			<AccountsSummaryCard analytics={analytics} currency={resolvedCurrency} />

			<AccountList
				accounts={accounts}
				analytics={analytics}
				showArchived={showArchivedAccounts}
				sortBy={sortBy}
				userId={userId}
				onSelectAccount={handleSelectAccount}
			/>
			<AccountDrawer userId={userId} />
		</div>
	);
}
