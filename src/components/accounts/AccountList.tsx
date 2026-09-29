"use client";

import { useLiveQuery } from "dexie-react-hooks";
import {
	Archive,
	ArchiveRestore,
	ChevronRight,
	MoreVertical,
	Pencil,
	Plus,
	Trash2,
} from "lucide-react";
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
import { scheduleAnalyticsRecompute } from "@/lib/analytics/scheduleRecompute";
import { getCurrencyByCode } from "@/lib/currencies";
import { db } from "@/lib/db/local";
import { CARD_SURFACE, LIST_ROW, PRESS_SCALE, TAPPABLE, staggerDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui-store";

import type { AccountSort } from "@/components/accounts/accountSort";
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
			className="text-2xl leading-8"
		/>
	);
}

// ─── AccountCard ───────────────────────────────────────────────────────────

interface AccountCardProps {
	account: Account;
	balance: number | undefined;
	onEdit: (id: string) => void;
	onSelect: (id: string) => void;
	className?: string;
	style?: CSSProperties;
}

function AccountCard({ account, balance, onEdit, onSelect, className, style }: AccountCardProps) {
	const [confirming, setConfirming] = useState(false);
	const haptics = useHaptics();
	const currency = getCurrencyByCode(account.currency);
	const icon = account.icon ?? "💼";

	function handleSelect() {
		haptics.selection();
		onSelect(account.id);
	}

	async function handleArchiveToggle() {
		await db.accounts.update(account.id, {
			isArchived: !account.isArchived,
			updatedAt: Date.now(),
		});
		scheduleAnalyticsRecompute(account.userId);
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
		scheduleAnalyticsRecompute(account.userId);
		toast.success("Account deleted");
		setConfirming(false);
	}

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={handleSelect}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					handleSelect();
				}
			}}
			className={cn(
				CARD_SURFACE,
				"relative min-h-36 cursor-pointer overflow-hidden p-4 transition-shadow duration-200 hover:shadow-[var(--shadow-sheet)]",
				account.isArchived && "opacity-70",
				PRESS_SCALE,
				TAPPABLE,
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
			<div className="flex items-start justify-between gap-2">
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted text-lg leading-none shadow-sm">
							{icon}
						</span>
						<div className="min-w-0">
							<p className="truncate text-base font-semibold tracking-tight">{account.title}</p>
							<p className="mt-0.5 truncate text-xs text-muted-foreground">
								{account.accountType === "liability" ? "Liability account" : "Active balance"}
							</p>
						</div>
					</div>
				</div>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant="ghost"
							size="icon"
							className="h-7 w-7 shrink-0"
							onClick={(e) => e.stopPropagation()}>
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

			<div className="mt-5">
				<div className="mb-1.5 flex items-center gap-2">
					<span className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/70 px-2 py-1 text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">
						{currency?.flag && <span className="text-xs tracking-normal">{currency.flag}</span>}
						{account.currency}
					</span>
					{account.isArchived && (
						<span className="rounded-full bg-muted px-2 py-1 text-[11px] font-semibold text-muted-foreground">
							Archived
						</span>
					)}
				</div>
				<AccountBalance balance={balance} currency={account.currency} />
			</div>

			<ChevronRight className="absolute right-4 bottom-4 h-4 w-4 text-muted-foreground/45" />
		</div>
	);
}

// ─── AccountList ──────────────────────────────────────────────────────────

interface AccountListProps {
	accounts: Account[] | undefined;
	showArchived: boolean;
	sortBy: AccountSort;
	userId: string;
	onSelectAccount: (id: string) => void;
}

export function AccountList({
	accounts,
	showArchived,
	sortBy,
	userId,
	onSelectAccount,
}: AccountListProps) {
	const openEditAccount = useUIStore((s) => s.openEditAccount);
	const openAddAccount = useUIStore((s) => s.openAddAccount);
	const haptics = useHaptics();
	const transactions = useLiveQuery(
		() =>
			db.transactions
				.where("userId")
				.equals(userId)
				.filter((t) => !t.deletedAt)
				.toArray(),
		[userId]
	);

	const balanceByAccountId = useMemo(() => {
		const map = new Map<string, number>();
		if (!accounts) return map;

		for (const account of accounts) {
			map.set(account.id, account.openingBalance);
		}

		if (!transactions) return map;

		for (const t of transactions) {
			if (t.type === "Income") {
				map.set(t.accountId, (map.get(t.accountId) ?? 0) + t.amount);
			} else if (t.type === "Expense") {
				map.set(t.accountId, (map.get(t.accountId) ?? 0) - t.amount);
			} else if (t.type === "Transfer") {
				map.set(t.accountId, (map.get(t.accountId) ?? 0) - t.amount);
				if (t.toAccountId) {
					map.set(t.toAccountId, (map.get(t.toAccountId) ?? 0) + t.amount);
				}
			}
		}

		return map;
	}, [accounts, transactions]);

	const hasCurrentBalances = transactions !== undefined;

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
			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{Array.from({ length: 3 }).map((_, i) => (
					<SkeletonCard key={i} rows={2} className="min-h-36" />
				))}
			</div>
		);
	}

	const visible = showArchived ? accounts : accounts.filter((a) => !a.isArchived);
	const sortedAccounts = [...visible].sort((a, b) => {
		const balanceA = hasCurrentBalances
			? (balanceByAccountId.get(a.id) ?? a.openingBalance)
			: a.openingBalance;
		const balanceB = hasCurrentBalances
			? (balanceByAccountId.get(b.id) ?? b.openingBalance)
			: b.openingBalance;

		switch (sortBy) {
			case "balance-asc":
				return balanceA - balanceB || a.title.localeCompare(b.title);
			case "title-asc":
				return a.title.localeCompare(b.title);
			case "updated-desc":
				return b.updatedAt - a.updatedAt || a.title.localeCompare(b.title);
			case "balance-desc":
			default:
				return balanceB - balanceA || a.title.localeCompare(b.title);
		}
	});

	if (sortedAccounts.length === 0) {
		return (
			<EmptyState
				title="No accounts yet"
				description="Create your first account to start tracking your finances."
				action={{ label: "Add Account", onClick: handleAddAccount }}
			/>
		);
	}

	return (
		<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
			{sortedAccounts.map((account, index) => (
				<AccountCard
					key={account.id}
					account={account}
					balance={hasCurrentBalances ? balanceByAccountId.get(account.id) : undefined}
					onEdit={handleEditAccount}
					onSelect={onSelectAccount}
					className={LIST_ROW}
					style={staggerDelay(index, 35)}
				/>
			))}
			<button
				type="button"
				onClick={handleAddAccount}
				className={cn(
					CARD_SURFACE,
					"flex min-h-36 items-center justify-center gap-2 border-dashed text-sm font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary",
					PRESS_SCALE,
					TAPPABLE,
					LIST_ROW
				)}
				style={staggerDelay(sortedAccounts.length, 35)}>
				<Plus className="h-4 w-4" />
				Add Account
			</button>
		</div>
	);
}
