"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { format } from "date-fns";
import { useRef } from "react";

import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { TransactionRow } from "@/components/transactions/TransactionRow";
import { useUIStore } from "@/store/ui-store";

import type { Account, Category, Transaction } from "@/types";

type ListItem =
	| { kind: "header"; label: string; key: string }
	| { kind: "row"; transaction: Transaction; key: string };

function buildItems(transactions: Transaction[]): ListItem[] {
	const items: ListItem[] = [];
	let lastDate = "";

	for (const txn of transactions) {
		const dateKey = format(new Date(txn.date), "yyyy-MM-dd");
		const dateLabel = format(new Date(txn.date), "EEEE, d MMM yyyy");

		if (dateKey !== lastDate) {
			lastDate = dateKey;
			items.push({ kind: "header", label: dateLabel, key: `header-${dateKey}` });
		}
		items.push({ kind: "row", transaction: txn, key: txn.id });
	}
	return items;
}

interface TransactionListProps {
	transactions: Transaction[] | undefined;
	accounts: Account[];
	categories: Category[];
}

export function TransactionList({ transactions, accounts, categories }: TransactionListProps) {
	const openAddTransaction = useUIStore((s) => s.openAddTransaction);
	const parentRef = useRef<HTMLDivElement>(null);

	if (transactions === undefined) {
		return (
			<div className="space-y-2">
				{Array.from({ length: 5 }).map((_, i) => (
					<SkeletonCard key={i} rows={2} />
				))}
			</div>
		);
	}

	if (transactions.length === 0) {
		return (
			<EmptyState
				title="No transactions"
				description="Tap the + button to record your first transaction."
				action={{ label: "Add Transaction", onClick: openAddTransaction }}
			/>
		);
	}

	const items = buildItems(transactions);

	return (
		<VirtualList parentRef={parentRef} items={items} accounts={accounts} categories={categories} />
	);
}

interface VirtualListProps {
	parentRef: React.RefObject<HTMLDivElement | null>;
	items: ListItem[];
	accounts: Account[];
	categories: Category[];
}

function VirtualList({ parentRef, items, accounts, categories }: VirtualListProps) {
	const virtualizer = useVirtualizer({
		count: items.length,
		getScrollElement: () => parentRef.current,
		estimateSize: (index) => {
			const item = items[index];
			return item?.kind === "header" ? 36 : 64;
		},
		overscan: 10,
	});

	return (
		<div
			ref={parentRef}
			className="overflow-auto rounded-xl border border-border bg-card"
			style={{ maxHeight: "calc(100dvh - 200px)" }}>
			<div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
				{virtualizer.getVirtualItems().map((virtualRow) => {
					const item = items[virtualRow.index];
					if (!item) return null;
					return (
						<div
							key={item.key}
							data-index={virtualRow.index}
							ref={virtualizer.measureElement}
							style={{
								position: "absolute",
								top: 0,
								left: 0,
								width: "100%",
								transform: `translateY(${virtualRow.start}px)`,
							}}>
							{item.kind === "header" ? (
								<div className="sticky top-0 z-10 bg-muted/80 px-4 py-1.5 backdrop-blur-sm">
									<p className="text-xs font-semibold text-muted-foreground">{item.label}</p>
								</div>
							) : (
								<>
									<TransactionRow
										transaction={item.transaction}
										accounts={accounts}
										categories={categories}
									/>
									<div className="mx-4 border-b border-border/50 last:border-0" />
								</>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
