"use client";

import { Archive, ArchiveRestore, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type CSSProperties } from "react";
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
import { useHaptics } from "@/hooks/useHaptics";
import { deleteAccount, setAccountArchived } from "@/lib/actions/accounts";
import { CARD_SURFACE, LIST_ROW, PRESS_SCALE, TAPPABLE, staggerDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui-store";

import type { AccountSort } from "@/components/accounts/accountSort";
import type { AccountsAnalytics } from "@/lib/analytics/periodAnalytics";
import type { Account } from "@/types";

// ─── AccountBalance ────────────────────────────────────────────────────────

function AccountBalance({ balance, currency }: { balance: number | undefined; currency: string }) {
	if (balance === undefined) {
		return <span className="shimmer inline-block h-7 w-32 rounded-full bg-muted/70" />;
	}

	return (
		<CurrencyAmount
			amount={balance}
			currency={currency}
			colorized
			showNegativeSign
			className="text-base leading-6 sm:text-lg"
		/>
	);
}

// ─── AccountRow ────────────────────────────────────────────────────────────

interface AccountRowProps {
	account: Account;
	balance: number | undefined;
	onEdit: (id: string) => void;
	onSelect: (id: string) => void;
	className?: string;
	style?: CSSProperties;
}

function AccountRow({ account, balance, onEdit, onSelect, className, style }: AccountRowProps) {
	const [confirming, setConfirming] = useState(false);
	const haptics = useHaptics();
	const icon = account.icon ?? "💼";

	function handleSelect() {
		haptics.selection();
		onSelect(account.id);
	}

	async function handleArchiveToggle() {
		await setAccountArchived(account, !account.isArchived);
		toast.success(account.isArchived ? "Account restored" : "Account archived");
	}

	async function handleDelete() {
		if (!confirming) {
			setConfirming(true);
			return;
		}
		await deleteAccount(account);
		toast.success("Account deleted");
		setConfirming(false);
	}

	return (
		<div
			className={cn(
				CARD_SURFACE,
				"relative flex min-h-20 overflow-hidden transition-shadow duration-200 hover:shadow-[var(--shadow-sheet)]",
				account.isArchived && "bg-card/80",
				className
			)}
			style={{
				...style,
				borderLeftColor: account.color ?? undefined,
				borderLeftWidth: account.color ? 4 : undefined,
			}}>
			<div
				className="pointer-events-none absolute -top-10 -right-10 h-28 w-28 rounded-full opacity-15 blur-2xl"
				style={{ backgroundColor: account.color ?? "var(--primary)" }}
			/>
			<button
				type="button"
				onClick={handleSelect}
				className={cn(
					"relative flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-2xl py-3 pr-2 pl-3 text-left text-card-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
					PRESS_SCALE,
					TAPPABLE
				)}>
				<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-muted text-lg leading-none shadow-sm">
					{icon}
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-base font-semibold tracking-tight">
						{account.title}
					</span>
					{account.isArchived ? (
						<span className="mt-0.5 block text-xs font-semibold text-amber-600 dark:text-amber-400">
							(Archived)
						</span>
					) : (
						<span className="mt-0.5 block truncate text-xs text-muted-foreground">
							{account.accountType === "liability" ? "Liability" : account.currency}
						</span>
					)}
				</span>
				<span className="ml-2 flex shrink-0 flex-col items-end">
					<AccountBalance balance={balance} currency={account.currency} />
					{balance === 0 && (
						<span className="mt-0.5 text-[11px] font-medium text-muted-foreground">
							zero balance
						</span>
					)}
				</span>
			</button>

			<div
				className="relative z-10 flex items-center pr-2"
				onPointerDown={(event) => event.stopPropagation()}
				onClick={(event) => event.stopPropagation()}>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-9 w-9 shrink-0 rounded-full"
							aria-label={`Account options for ${account.title}`}
							onPointerDown={(event) => event.stopPropagation()}
							onClick={(event) => {
								event.preventDefault();
								event.stopPropagation();
							}}>
							<MoreVertical className="h-4 w-4" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent
						align="end"
						onPointerDown={(event) => event.stopPropagation()}
						onClick={(event) => event.stopPropagation()}>
						<DropdownMenuItem
							onSelect={(event) => {
								event.stopPropagation();
								onEdit(account.id);
							}}>
							<Pencil className="mr-2 h-4 w-4" />
							Edit
						</DropdownMenuItem>
						<DropdownMenuItem
							onSelect={(event) => {
								event.stopPropagation();
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
							onSelect={(event) => {
								event.stopPropagation();
								void handleDelete();
							}}>
							<Trash2 className="mr-2 h-4 w-4" />
							{confirming ? "Tap again to confirm" : "Delete"}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
		</div>
	);
}

// ─── AccountList ──────────────────────────────────────────────────────────

interface AccountListProps {
	accounts: Account[] | undefined;
	unscopedAccounts?: Account[] | undefined;
	analytics?: AccountsAnalytics | undefined;
	showArchived: boolean;
	sortBy: AccountSort;
	userId: string;
	activeCurrency?: string;
	onSelectAccount: (id: string) => void;
}

function getBalance(account: Account, balanceByAccountId: Map<string, number>) {
	return balanceByAccountId.get(account.id) ?? account.openingBalance;
}

function compareBalancePriority(
	accountA: Account,
	accountB: Account,
	balanceA: number,
	balanceB: number
) {
	const zeroA = balanceA === 0 ? 1 : 0;
	const zeroB = balanceB === 0 ? 1 : 0;
	if (zeroA !== zeroB) return zeroA - zeroB;

	const archivedA = accountA.isArchived ? 1 : 0;
	const archivedB = accountB.isArchived ? 1 : 0;
	return archivedA - archivedB;
}

export function AccountList({
	accounts,
	unscopedAccounts = [],
	analytics,
	showArchived,
	sortBy,
	userId: _userId,
	activeCurrency,
	onSelectAccount,
}: AccountListProps) {
	const openEditAccount = useUIStore((s) => s.openEditAccount);
	const openAddAccount = useUIStore((s) => s.openAddAccount);
	const haptics = useHaptics();

	const balanceByAccountId = useMemo(() => {
		return new Map(
			[
				...(analytics?.accounts ?? []),
				...(analytics?.unscopedAccounts ?? []),
				...(analytics?.allAccounts ?? []),
			].map((account) => [account.accountId, account.balance])
		);
	}, [analytics]);
	const hasCurrentBalances = analytics !== undefined;

	function handleEditAccount(accountId: string) {
		haptics.light();
		openEditAccount(accountId);
	}

	function handleAddAccount() {
		haptics.light();
		openAddAccount();
	}

	if (accounts === undefined) {
		return (
			<div className="space-y-2">
				{Array.from({ length: 5 }).map((_, i) => (
					<SkeletonCard key={i} rows={1} className="min-h-20" />
				))}
			</div>
		);
	}

	function sortAccounts(items: Account[]) {
		return [...items].sort((a, b) => {
			const balanceA = getBalance(a, balanceByAccountId);
			const balanceB = getBalance(b, balanceByAccountId);

			switch (sortBy) {
				case "balance-asc": {
					const priority = compareBalancePriority(a, b, balanceA, balanceB);
					if (priority !== 0) return priority;
					return balanceA - balanceB || a.title.localeCompare(b.title);
				}
				case "title-asc":
					return a.title.localeCompare(b.title);
				case "updated-desc":
					return b.updatedAt - a.updatedAt || a.title.localeCompare(b.title);
				case "balance-desc":
				default: {
					const priority = compareBalancePriority(a, b, balanceA, balanceB);
					if (priority !== 0) return priority;
					return balanceB - balanceA || a.title.localeCompare(b.title);
				}
			}
		});
	}

	const visible = showArchived ? accounts : accounts.filter((a) => !a.isArchived);
	const visibleUnscoped = showArchived
		? unscopedAccounts
		: unscopedAccounts.filter((a) => !a.isArchived);
	const sortedAccounts = sortAccounts(visible);
	const sortedUnscopedAccounts = sortAccounts(visibleUnscoped);

	if (sortedAccounts.length === 0 && sortedUnscopedAccounts.length === 0) {
		return (
			<EmptyState
				title="No accounts yet"
				description="Create your first account to start tracking your finances."
				action={{ label: "Add Account", onClick: handleAddAccount }}
			/>
		);
	}

	const sections = [
		{
			key: "selected",
			label: activeCurrency ? `${activeCurrency} Accounts` : undefined,
			accounts: sortedAccounts,
		},
		{
			key: "unscoped",
			label: "Other / Unknown currency",
			accounts: sortedUnscopedAccounts,
		},
	].filter((section) => section.accounts.length > 0);

	let rowIndex = 0;

	return (
		<div className="space-y-4">
			{sections.map((section) => (
				<section key={section.key} className="space-y-2" aria-label={section.label}>
					{section.label && (sections.length > 1 || section.key === "unscoped") && (
						<div className="flex items-center justify-between px-1">
							<h2 className="text-xs font-bold tracking-[0.16em] text-muted-foreground uppercase">
								{section.label}
							</h2>
							{section.key === "unscoped" && (
								<span className="text-[11px] text-muted-foreground">
									not included in {activeCurrency ?? "selected-currency"} totals
								</span>
							)}
						</div>
					)}
					{section.accounts.map((account) => {
						const index = rowIndex++;

						return (
							<AccountRow
								key={account.id}
								account={account}
								balance={hasCurrentBalances ? balanceByAccountId.get(account.id) : undefined}
								onEdit={handleEditAccount}
								onSelect={onSelectAccount}
								className={LIST_ROW}
								style={staggerDelay(index, 35)}
							/>
						);
					})}
				</section>
			))}
			<button
				type="button"
				onClick={handleAddAccount}
				className={cn(
					CARD_SURFACE,
					"flex min-h-20 w-full items-center justify-center gap-2 border-dashed text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary",
					PRESS_SCALE,
					TAPPABLE,
					LIST_ROW
				)}
				style={staggerDelay(rowIndex, 35)}>
				<Plus className="h-4 w-4" />
				Add Account
			</button>
		</div>
	);
}
