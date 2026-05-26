"use client";

import { MoreVertical, Pencil, Archive, ArchiveRestore, Trash2, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAccountBalance } from "@/hooks/useAccountBalance";
import { db } from "@/lib/db/local";
import { useUIStore } from "@/store/ui-store";

import type { Account } from "@/types";

// ─── AccountBalance ────────────────────────────────────────────────────────

function AccountBalance({ account }: { account: Account }) {
	const balance = useAccountBalance(account.id, account.userId);
	if (balance === undefined) return <span className="text-sm text-muted-foreground">…</span>;
	return <CurrencyAmount amount={balance} currency={account.currency} colorized />;
}

// ─── AccountCard ───────────────────────────────────────────────────────────

interface AccountCardProps {
	account: Account;
	onEdit: (id: string) => void;
}

function AccountCard({ account, onEdit }: AccountCardProps) {
	const [confirming, setConfirming] = useState(false);

	async function handleArchiveToggle() {
		await db.accounts.update(account.id, {
			isArchived: !account.isArchived,
			updatedAt: Date.now(),
		});
		toast.success(account.isArchived ? "Account restored" : "Account archived");
	}

	async function handleDelete() {
		if (!confirming) {
			setConfirming(true);
			return;
		}
		await db.accounts.update(account.id, {
			deletedAt: Date.now(),
			updatedAt: Date.now(),
		});
		toast.success("Account deleted");
		setConfirming(false);
	}

	return (
		<div
			className="relative rounded-xl border border-border bg-card p-4 transition-shadow hover:shadow-sm"
			style={{
				borderLeftColor: account.color ?? undefined,
				borderLeftWidth: account.color ? 3 : undefined,
			}}>
			{/* Header row */}
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						{account.icon && <span className="text-lg leading-none">{account.icon}</span>}
						<p className="truncate font-semibold">{account.title}</p>
					</div>
					<p className="mt-0.5 text-xs tracking-wide text-muted-foreground uppercase">
						{account.currency}
					</p>
				</div>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
							<MoreVertical className="h-4 w-4" />
							<span className="sr-only">Account options</span>
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={() => onEdit(account.id)}>
							<Pencil className="mr-2 h-4 w-4" />
							Edit
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => {
								void handleArchiveToggle();
							}}>
							{account.isArchived ? (
								<>
									<ArchiveRestore className="mr-2 h-4 w-4" />
									Restore
								</>
							) : (
								<>
									<Archive className="mr-2 h-4 w-4" />
									Archive
								</>
							)}
						</DropdownMenuItem>
						<DropdownMenuItem
							className="text-destructive focus:text-destructive"
							onClick={() => {
								void handleDelete();
							}}>
							<Trash2 className="mr-2 h-4 w-4" />
							{confirming ? "Tap again to confirm" : "Delete"}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			{/* Balance */}
			<div className="mt-3 text-xl font-bold">
				<AccountBalance account={account} />
			</div>

			{account.isArchived && (
				<span className="mt-2 inline-block rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
					Archived
				</span>
			)}
		</div>
	);
}

// ─── AccountList ──────────────────────────────────────────────────────────

interface AccountListProps {
	accounts: Account[] | undefined;
	showArchived: boolean;
}

export function AccountList({ accounts, showArchived }: AccountListProps) {
	const openEditAccount = useUIStore((s) => s.openEditAccount);
	const openAddAccount = useUIStore((s) => s.openAddAccount);

	if (accounts === undefined) {
		return (
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{Array.from({ length: 3 }).map((_, i) => (
					<SkeletonCard key={i} />
				))}
			</div>
		);
	}

	const visible = showArchived ? accounts : accounts.filter((a) => !a.isArchived);

	if (visible.length === 0) {
		return (
			<EmptyState
				title="No accounts yet"
				description="Create your first account to start tracking your finances."
				action={{ label: "Add Account", onClick: openAddAccount }}
			/>
		);
	}

	return (
		<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{visible.map((account) => (
				<AccountCard key={account.id} account={account} onEdit={openEditAccount} />
			))}
			{/* Add new card */}
			<button
				type="button"
				onClick={openAddAccount}
				className="flex min-h-[120px] items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-primary hover:text-primary">
				<Plus className="h-4 w-4" />
				Add Account
			</button>
		</div>
	);
}
