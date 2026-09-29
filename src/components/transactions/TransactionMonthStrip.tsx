"use client";

import { useEffect, useMemo, useRef } from "react";

import {
	getLocalTimeZoneOffsetMinutes,
	getMonthRange,
	getMonthRangeOffset,
	getMonthStripRanges,
	type MonthRange,
} from "@/lib/dateRange";
import { cn } from "@/lib/utils";

interface TransactionMonthStripProps {
	selectedMonth: MonthRange;
	onSelectMonth: (month: MonthRange) => void;
	now?: Date;
	timeZoneOffsetMinutes?: number;
	months?: number;
}

export function getTransactionMonthStripRanges(
	selectedMonth: MonthRange,
	now = new Date(),
	timeZoneOffsetMinutes = getLocalTimeZoneOffsetMinutes(now),
	months = 7
): MonthRange[] {
	const currentMonth = getMonthRange(now, { timeZoneOffsetMinutes });
	const baseRanges = getMonthStripRanges(selectedMonth.date, {
		months,
		timeZoneOffsetMinutes,
	});
	const lastSelectableIndex = baseRanges.findLastIndex(
		(month) => month.fromMs <= currentMonth.fromMs
	);

	if (lastSelectableIndex === -1) {
		return getMonthStripRanges(currentMonth.date, { months, timeZoneOffsetMinutes }).filter(
			(month) => month.fromMs <= currentMonth.fromMs
		);
	}

	if (lastSelectableIndex === baseRanges.length - 1) {
		return baseRanges;
	}

	const shiftLeftBy = baseRanges.length - 1 - lastSelectableIndex;
	const adjustedAnchor = getMonthRangeOffset(selectedMonth.date, -shiftLeftBy, {
		timeZoneOffsetMinutes,
	});

	return getMonthStripRanges(adjustedAnchor.date, { months, timeZoneOffsetMinutes }).filter(
		(month) => month.fromMs <= currentMonth.fromMs
	);
}

export function TransactionMonthStrip({
	selectedMonth,
	onSelectMonth,
	now,
	timeZoneOffsetMinutes,
	months = 7,
}: TransactionMonthStripProps) {
	const currentNow = now ?? new Date();
	const offsetMinutes = timeZoneOffsetMinutes ?? getLocalTimeZoneOffsetMinutes(currentNow);
	const selectedRef = useRef<HTMLButtonElement | null>(null);
	const currentMonth = useMemo(
		() => getMonthRange(currentNow, { timeZoneOffsetMinutes: offsetMinutes }),
		[currentNow, offsetMinutes]
	);
	const monthRanges = useMemo(
		() => getTransactionMonthStripRanges(selectedMonth, currentNow, offsetMinutes, months),
		[selectedMonth, currentNow, offsetMinutes, months]
	);

	useEffect(() => {
		selectedRef.current?.scrollIntoView({
			behavior: "smooth",
			block: "nearest",
			inline: "center",
		});
	}, [selectedMonth.key]);

	return (
		<section className="space-y-1" aria-label="Transaction month filter">
			<div
				data-swipe-navigation-ignore
				className="-mx-1 no-scrollbar flex gap-2 overflow-x-auto px-1 py-1"
				aria-label="Browse transaction months">
				{monthRanges.map((month) => {
					const selected = month.key === selectedMonth.key;
					const isFuture = month.fromMs > currentMonth.fromMs;

					return (
						<button
							key={month.key}
							ref={selected ? selectedRef : undefined}
							type="button"
							aria-label={`${selected ? "Selected month, " : "Select "}${month.label}`}
							aria-current={selected ? "date" : undefined}
							aria-pressed={selected}
							disabled={isFuture}
							onClick={() => {
								if (!isFuture) onSelectMonth(month);
							}}
							className={cn(
								"shrink-0 rounded-full border px-4 py-2 text-sm font-medium transition-[border-color,background-color,color,opacity]",
								selected
									? "border-primary bg-primary text-primary-foreground shadow-sm"
									: "border-border/70 bg-card/60 text-muted-foreground opacity-70 hover:border-primary/50 hover:text-foreground hover:opacity-100",
								isFuture && "cursor-not-allowed opacity-35"
							)}>
							{month.label}
						</button>
					);
				})}
			</div>
		</section>
	);
}
