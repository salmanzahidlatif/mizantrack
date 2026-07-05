"use client";

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
import { useFilterStore } from "@/store/filter-store";
import { useUIStore } from "@/store/ui-store";
import { useState } from "react";

interface AccountsPageClientProps {
	userId: string;
}

export function AccountsPageClient({ userId }: AccountsPageClientProps) {
	const { activeCurrency, showArchivedAccounts, setShowArchivedAccounts } = useFilterStore();
	const [sortBy, setSortBy] = useState<AccountSort>("balance-desc");
	const openAddAccount = useUIStore((s) => s.openAddAccount);

	// Respect active currency filter from global store
	const accounts = useAccounts(userId, {
		currency: activeCurrency || undefined,
		showArchived: showArchivedAccounts,
	});

	// Also fetch archived count to show/hide toggle
	const allAccounts = useAccounts(userId, { currency: activeCurrency || undefined, showArchived: true });
	const hasArchived = allAccounts?.some((a) => a.isArchived) ?? false;

	return (
		<div className="space-y-4">
			{/* Header */}
			<div className="flex items-center justify-between gap-2">
				<div>
					<h1 className="text-2xl font-bold">Accounts</h1>
					{accounts !== undefined && (
						<p className="text-sm text-muted-foreground">
							{accounts.filter((a) => !a.isArchived && !a.deletedAt).length} active
						</p>
					)}
				</div>
				<div className="flex items-center gap-2">
					<Select value={sortBy} onValueChange={(v) => setSortBy(v as AccountSort)}>
						<SelectTrigger className="h-8 w-44">
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
						<Button variant="outline" size="sm" onClick={() => setShowArchivedAccounts(!showArchivedAccounts)}>
							{showArchivedAccounts ? "Hide Archived" : "Show Archived"}
						</Button>
					)}
					<Button onClick={openAddAccount}>
						Add Account
					</Button>
				</div>
			</div>

			<AccountList accounts={accounts} showArchived={showArchivedAccounts} sortBy={sortBy} userId={userId} />
			<AccountDrawer userId={userId} />
		</div>
	);
}
