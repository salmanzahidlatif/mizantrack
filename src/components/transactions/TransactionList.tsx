"use client";

import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import { format } from "date-fns";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

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
	/** Resolved currency of the screen, so rows can drop a symbol that is already stated. */
	screenCurrency?: string;
	/** Turns every row into a checkbox target so several can be edited at once. */
	selectionMode?: boolean;
	selectedIds?: Set<string>;
	onToggleSelect?: (id: string) => void;
}

export function TransactionList({
	transactions,
	accounts,
	categories,
	screenCurrency,
	selectionMode = false,
	selectedIds,
	onToggleSelect,
}: TransactionListProps) {
	const openAddTransaction = useUIStore((s) => s.openAddTransaction);
	const parentRef = useRef<HTMLDivElement>(null);

	// Group into date headers + rows once per data change, not on every render. This runs
	// a date `format()` for every transaction in the filtered set, so keeping it out of the
	// render path matters as the history grows. Hoisted above the early returns to respect
	// the rules of hooks.
	const items = useMemo(() => (transactions ? buildItems(transactions) : []), [transactions]);

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

	return (
		<VirtualList
			parentRef={parentRef}
			items={items}
			accounts={accounts}
			categories={categories}
			screenCurrency={screenCurrency}
			selectionMode={selectionMode}
			selectedIds={selectedIds}
			onToggleSelect={onToggleSelect}
		/>
	);
}

interface VirtualListProps {
	parentRef: RefObject<HTMLDivElement | null>;
	items: ListItem[];
	accounts: Account[];
	categories: Category[];
	screenCurrency?: string;
	selectionMode: boolean;
	selectedIds: Set<string> | undefined;
	onToggleSelect: ((id: string) => void) | undefined;
}

function VirtualList({
	parentRef,
	items,
	accounts,
	categories,
	screenCurrency,
	selectionMode,
	selectedIds,
	onToggleSelect,
}: VirtualListProps) {
	const activeStickyIndexRef = useRef<number | null>(null);
	// Row entrance stagger plays once, on first mount — not again on every filter, search or
	// month change, which made the whole list "fly in" repeatedly and feel busy. After the
	// initial reveal window rows appear instantly (including those scrolled into view).
	const [entered, setEntered] = useState(false);
	useEffect(() => {
		const timer = window.setTimeout(() => setEntered(true), 700);
		return () => window.clearTimeout(timer);
	}, []);
	// Size the list's own scroll so it ends exactly at the bottom of the page's scroll
	// area instead of a hardcoded guess. The old `calc(100dvh - 200px)` under-counted the
	// mobile header (title, month strip, two filter rows, search), so the list ran past the
	// viewport and the whole page scrolled on top of the list — a double scroll. Measuring
	// the real top and the scroller's padding (which carries the safe-area + bottom nav)
	// keeps the page itself from overflowing.
	const [maxHeight, setMaxHeight] = useState<number>();
	useEffect(() => {
		const el = parentRef.current;
		if (!el) return;

		const scroller = el.closest("main");
		const measure = () => {
			const top = el.getBoundingClientRect().top;
			const bottom = scroller
				? scroller.getBoundingClientRect().bottom -
					(parseFloat(getComputedStyle(scroller).paddingBottom) || 0)
				: window.innerHeight - 96;
			setMaxHeight(Math.max(260, Math.round(bottom - top - 8)));
		};

		measure();
		const raf = requestAnimationFrame(measure);
		window.addEventListener("resize", measure);
		return () => {
			window.removeEventListener("resize", measure);
			cancelAnimationFrame(raf);
		};
	}, [parentRef, selectionMode]);
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
			className={cn(CARD_SURFACE, "no-scrollbar overflow-auto fade-in")}
			style={{ maxHeight: maxHeight ? `${maxHeight}px` : "calc(100dvh - 220px)" }}>
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
								<div
									className={entered ? undefined : LIST_ROW}
									style={entered ? undefined : staggerDelay(Math.min(virtualRow.index, 10), 28)}>
									<TransactionRow
										transaction={item.transaction}
										accounts={accounts}
										categories={categories}
										screenCurrency={screenCurrency}
										selectionMode={selectionMode}
										selected={selectedIds?.has(item.transaction.id) ?? false}
										onToggleSelect={onToggleSelect}
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
