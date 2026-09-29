"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AccountDrawer } from "@/components/accounts/AccountDrawer";
import { AccountList } from "@/components/accounts/AccountList";
import { accountSortOptions, type AccountSort } from "@/components/accounts/accountSort";
import { Button } from "@/components/ui/button";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useAccounts } from "@/hooks/useAccounts";
import { useHaptics } from "@/hooks/useHaptics";
import { useFilterStore } from "@/store/filter-store";
import { useUIStore } from "@/store/ui-store";

interface AccountsPageClientProps {
	userId: string;
}

export function AccountsPageClient({ userId }: AccountsPageClientProps) {
	const router = useRouter();
	const { activeCurrency, showArchivedAccounts, setShowArchivedAccounts, setAccountId } =
		useFilterStore();
	const [sortBy, setSortBy] = useState<AccountSort>("balance-desc");
	const openAddAccount = useUIStore((s) => s.openAddAccount);
	const haptics = useHaptics();

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

	// Respect active currency filter from global store
	const accounts = useAccounts(userId, {
		currency: activeCurrency || undefined,
		showArchived: showArchivedAccounts,
	});

	// Also fetch archived count to show/hide toggle
	const allAccounts = useAccounts(userId, {
		currency: activeCurrency || undefined,
		showArchived: true,
	});
	const hasArchived = allAccounts?.some((a) => a.isArchived) ?? false;

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h1 className="text-2xl font-bold">Accounts</h1>
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
						Add Account
					</Button>
				</div>
			</div>

			<AccountList
				accounts={accounts}
				showArchived={showArchivedAccounts}
				sortBy={sortBy}
				userId={userId}
				onSelectAccount={handleSelectAccount}
			/>
			<AccountDrawer userId={userId} />
		</div>
	);
}
