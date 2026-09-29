"use client";

import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { format } from "date-fns";
import { useCallback, useMemo, useRef, type RefObject } from "react";

import { EmptyState } from "@/components/shared/EmptyState";
import { SkeletonTransactionRow } from "@/components/shared/SkeletonTransactionRow";
import { TransactionRow } from "@/components/transactions/TransactionRow";
import { CARD_SURFACE, FROSTED_HEADER, LIST_ROW, staggerDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui-store";

import type { Account, Category, Transaction } from "@/types";
import type { Range } from "@tanstack/react-virtual";

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
	/** Full account list for row label/currency resolution; filters stay upstream. */
	accounts: Account[];
	categories: Category[];
}

export function TransactionList({ transactions, accounts, categories }: TransactionListProps) {
	const openAddTransaction = useUIStore((s) => s.openAddTransaction);
	const parentRef = useRef<HTMLDivElement>(null);

	if (transactions === undefined) {
		return (
			<div className={cn(CARD_SURFACE, "overflow-hidden")}>
				<SkeletonTransactionRow count={6} />
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
	parentRef: RefObject<HTMLDivElement | null>;
	items: ListItem[];
	accounts: Account[];
	categories: Category[];
}

function VirtualList({ parentRef, items, accounts, categories }: VirtualListProps) {
	const activeStickyIndexRef = useRef<number | null>(null);
	const stickyIndexes = useMemo(
		() =>
			items.reduce<number[]>((indexes, item, index) => {
				if (item.kind === "header") indexes.push(index);
				return indexes;
			}, []),
		[items]
	);
	const rangeExtractor = useCallback(
		(range: Range) => {
			let activeStickyIndex: number | null = null;

			for (let i = stickyIndexes.length - 1; i >= 0; i -= 1) {
				const stickyIndex = stickyIndexes[i];
				if (stickyIndex === undefined) continue;
				if (stickyIndex <= range.startIndex) {
					activeStickyIndex = stickyIndex;
					break;
				}
			}

			activeStickyIndexRef.current = activeStickyIndex;

			if (activeStickyIndex === null) {
				return defaultRangeExtractor(range);
			}

			return Array.from(new Set([activeStickyIndex, ...defaultRangeExtractor(range)])).sort(
				(a, b) => a - b
			);
		},
		[stickyIndexes]
	);
	const virtualizer = useVirtualizer({
		count: items.length,
		getScrollElement: () => parentRef.current,
		estimateSize: (index) => {
			const item = items[index];
			return item?.kind === "header" ? 44 : 76;
		},
		overscan: 10,
		rangeExtractor,
	});

	return (
		<div
			ref={parentRef}
			className={cn(CARD_SURFACE, "no-scrollbar overflow-auto")}
			style={{ maxHeight: "calc(100dvh - 200px)" }}>
			<div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
				{virtualizer.getVirtualItems().map((virtualRow) => {
					const item = items[virtualRow.index];
					if (!item) return null;
					const isActiveSticky =
						item.kind === "header" && activeStickyIndexRef.current === virtualRow.index;
					return (
						<div
							key={item.key}
							data-index={virtualRow.index}
							ref={virtualizer.measureElement}
							style={{
								position: isActiveSticky ? "sticky" : "absolute",
								top: 0,
								left: isActiveSticky ? undefined : 0,
								width: "100%",
								zIndex: isActiveSticky ? 30 : item.kind === "header" ? 20 : 0,
								transform: isActiveSticky ? undefined : `translateY(${virtualRow.start}px)`,
							}}>
							{item.kind === "header" ? (
								<div className={cn(FROSTED_HEADER, "flex min-h-11 items-center px-4 py-2.5")}>
									<p className="text-xs font-bold tracking-[0.16em] text-muted-foreground uppercase">
										{item.label}
									</p>
								</div>
							) : (
								<div className={LIST_ROW} style={staggerDelay(Math.min(virtualRow.index, 10), 28)}>
									<TransactionRow
										transaction={item.transaction}
										accounts={accounts}
										categories={categories}
									/>
									<div className="pointer-events-none absolute right-4 bottom-0 left-[72px] border-b border-border/55" />
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
