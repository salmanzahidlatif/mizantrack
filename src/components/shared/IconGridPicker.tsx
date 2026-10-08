"use client";

import { Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHaptics } from "@/hooks/useHaptics";
import { PRESS_SCALE, TAPPABLE } from "@/lib/motion";
import { cn } from "@/lib/utils";

export interface IconGridPickerItem {
	id: string;
	title: string;
	icon: string;
	color?: string;
	badge?: string;
}

export interface IconGridPickerProps {
	items: IconGridPickerItem[];
	value: string | undefined;
	onChange: (id: string) => void;
	label?: string;
	emptyMessage?: string;
	className?: string;
	id?: string;
	searchPlaceholder?: string;
	searchThreshold?: number;
	disabled?: boolean;
	"aria-invalid"?: boolean;
}

const DEFAULT_SEARCH_THRESHOLD = 12;

function getItemLabel(item: IconGridPickerItem): string {
	return item.badge ? `${item.title} (${item.badge})` : item.title;
}

function matchesSearch(item: IconGridPickerItem, query: string): boolean {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return true;

	return [item.title, item.badge, item.id]
		.filter((value): value is string => Boolean(value))
		.some((value) => value.toLowerCase().includes(normalizedQuery));
}

export function IconGridPicker({
	items,
	value,
	onChange,
	label,
	emptyMessage = "No items available.",
	className,
	id,
	searchPlaceholder,
	searchThreshold = DEFAULT_SEARCH_THRESHOLD,
	disabled = false,
	"aria-invalid": ariaInvalid,
}: IconGridPickerProps) {
	const generatedId = useId();
	const pickerId = id ?? generatedId;
	const labelId = `${pickerId}-label`;
	const searchId = `${pickerId}-search`;
	const [query, setQuery] = useState("");
	const scrollerRef = useRef<HTMLDivElement | null>(null);
	const radioRefs = useRef<Array<HTMLButtonElement | null>>([]);
	const scrollResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const isUserScrollingRef = useRef(false);
	const haptics = useHaptics();
	const shouldShowSearch = items.length > searchThreshold;
	const visibleItems = useMemo(
		() => items.filter((item) => matchesSearch(item, query)),
		[items, query]
	);
	const selectedVisibleIndex = visibleItems.findIndex((item) => item.id === value);
	const firstFocusableIndex = selectedVisibleIndex >= 0 ? selectedVisibleIndex : 0;

	useEffect(() => {
		radioRefs.current.length = visibleItems.length;
	}, [visibleItems.length]);

	useEffect(() => {
		if (selectedVisibleIndex < 0 || isUserScrollingRef.current) return;

		const scroller = scrollerRef.current;
		const selectedRadio = radioRefs.current[selectedVisibleIndex];
		if (!scroller || !selectedRadio || scroller.scrollWidth <= scroller.clientWidth) return;

		selectedRadio.scrollIntoView({
			block: "nearest",
			inline: "nearest",
		});
	}, [selectedVisibleIndex, value]);

	useEffect(
		() => () => {
			if (scrollResetTimerRef.current) {
				clearTimeout(scrollResetTimerRef.current);
			}
		},
		[]
	);

	function chooseItem(idToSelect: string) {
		if (disabled) return;
		if (idToSelect !== value) {
			haptics.selection();
			onChange(idToSelect);
		}
	}

	function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
		if (visibleItems.length === 0) return;

		let nextIndex: number | null = null;
		switch (event.key) {
			case "ArrowRight":
			case "ArrowDown":
				nextIndex = (index + 1) % visibleItems.length;
				break;
			case "ArrowLeft":
			case "ArrowUp":
				nextIndex = (index - 1 + visibleItems.length) % visibleItems.length;
				break;
			case "Home":
				nextIndex = 0;
				break;
			case "End":
				nextIndex = visibleItems.length - 1;
				break;
			default:
				return;
		}

		event.preventDefault();
		const nextItem = visibleItems[nextIndex];
		if (!nextItem) return;
		radioRefs.current[nextIndex]?.focus();
		chooseItem(nextItem.id);
	}

	function handleScroll() {
		isUserScrollingRef.current = true;
		if (scrollResetTimerRef.current) {
			clearTimeout(scrollResetTimerRef.current);
		}
		scrollResetTimerRef.current = setTimeout(() => {
			isUserScrollingRef.current = false;
		}, 150);
	}

	return (
		<div className={cn("space-y-2", className)}>
			{label && (
				<Label id={labelId} className="text-sm font-medium">
					{label}
				</Label>
			)}

			{shouldShowSearch && (
				<div className="relative">
					<Label htmlFor={searchId} className="sr-only">
						Search {label ?? "items"}
					</Label>
					<Search
						className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground/70"
						aria-hidden="true"
					/>
					<Input
						id={searchId}
						type="search"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={searchPlaceholder ?? `Search ${label?.toLowerCase() ?? "items"}`}
						className="h-10 pl-9 text-sm"
						disabled={disabled}
					/>
				</div>
			)}

			<div
				ref={scrollerRef}
				data-slot="icon-grid-picker-scroll"
				data-orientation="horizontal"
				className={cn(
					"no-scrollbar overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-2xl border border-border/60 bg-background/45 p-2 [-webkit-overflow-scrolling:touch]"
				)}
				onScroll={handleScroll}>
				{items.length === 0 ? (
					<p className="px-3 py-4 text-sm text-muted-foreground">{emptyMessage}</p>
				) : visibleItems.length === 0 ? (
					<p className="px-3 py-4 text-sm text-muted-foreground">No matching items.</p>
				) : (
					<div
						role="radiogroup"
						aria-labelledby={label ? labelId : undefined}
						aria-label={label ? undefined : "Choose an item"}
						aria-invalid={ariaInvalid ? true : undefined}
						className="flex w-max min-w-full flex-nowrap gap-2">
						{visibleItems.map((item, index) => {
							const selected = item.id === value;
							const itemLabel = getItemLabel(item);

							return (
								<button
									key={item.id}
									ref={(node) => {
										radioRefs.current[index] = node;
									}}
									type="button"
									role="radio"
									aria-checked={selected}
									aria-label={itemLabel}
									title={itemLabel}
									disabled={disabled}
									tabIndex={disabled ? -1 : index === firstFocusableIndex ? 0 : -1}
									data-state={selected ? "checked" : "unchecked"}
									onClick={() => chooseItem(item.id)}
									onKeyDown={(event) => handleKeyDown(event, index)}
									className={cn(
										"group flex min-h-20 w-20 flex-none flex-col items-center rounded-2xl border px-1.5 py-2 text-center transition-[background-color,border-color,box-shadow,transform] duration-[var(--dur-fast)] ease-[var(--ease-spring)] outline-none focus-visible:ring-3 focus-visible:ring-ring/35 disabled:pointer-events-none disabled:opacity-45",
										selected
											? "border-primary bg-primary/10 shadow-sm ring-2 ring-primary/35"
											: "border-transparent hover:border-border hover:bg-muted/45",
										PRESS_SCALE,
										TAPPABLE
									)}>
									<span
										aria-hidden="true"
										className={cn(
											"mb-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xl ring-1 transition-[background-color,color,box-shadow,transform] duration-[var(--dur-fast)] ease-[var(--ease-spring)] group-active:scale-95",
											selected
												? "bg-primary text-primary-foreground shadow-sm ring-primary/45"
												: "bg-muted/70 ring-border/70"
										)}
										style={
											!selected && item.color
												? { backgroundColor: `${item.color}20`, color: item.color }
												: undefined
										}>
										{item.icon}
									</span>
									<span className="line-clamp-2 min-h-7 text-[10px] leading-[0.875rem] font-medium text-foreground">
										{item.title}
									</span>
									{item.badge && (
										<span className="mt-0.5 max-w-full truncate rounded-full bg-muted px-1.5 py-0.5 text-[9px] leading-3 font-semibold tracking-wide text-muted-foreground uppercase">
											{item.badge}
										</span>
									)}
								</button>
							);
						})}
					</div>
				)}
			</div>
		</div>
	);
}
