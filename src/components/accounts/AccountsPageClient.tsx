"use client";

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
import { useUIStore } from "@/store/ui-store";

interface AccountsPageClientProps {
	userId: string;
}

export function AccountsPageClient({ userId }: AccountsPageClientProps) {
	const accounts = useAccounts(userId);
	const [showArchived, setShowArchived] = useState(false);
	const [sortBy, setSortBy] = useState<AccountSort>("balance-desc");
	const openAddAccount = useUIStore((s) => s.openAddAccount);

	const hasArchived = accounts?.some((a) => a.isArchived) ?? false;

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
						<Button variant="outline" size="sm" onClick={() => setShowArchived((v) => !v)}>
							{showArchived ? "Hide Archived" : "Show Archived"}
						</Button>
					)}
					<Button size="sm" onClick={openAddAccount}>
						Add Account
					</Button>
				</div>
			</div>

			<AccountList accounts={accounts} showArchived={showArchived} sortBy={sortBy} userId={userId} />
			<AccountDrawer userId={userId} />
		</div>
	);
}
