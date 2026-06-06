"use client";

import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getDateRange } from "@/lib/dateRange";
import { useFilterStore } from "@/store/filter-store";

import type { DateRange, FilterPeriod } from "@/types";

const PRESETS: { value: FilterPeriod; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "today", label: "Today" },
	{ value: "week", label: "Week" },
	{ value: "month", label: "Month" },
	{ value: "quarter", label: "Quarter" },
	{ value: "half-year", label: "Half Year" },
	{ value: "year", label: "Year" },
	{ value: "fiscal-year", label: "Fiscal Year" },
	{ value: "custom", label: "Custom" },
];

interface DateRangePickerProps {
	/** When true, uses local state instead of the filter store (e.g. export dialog). */
	standalone?: boolean;
	value?: DateRange;
	onChange?: (range: DateRange) => void;
	fiscalYearStartMonth?: number;
}

export function DateRangePicker({
	standalone = false,
	value,
	onChange,
	fiscalYearStartMonth = 7,
}: DateRangePickerProps) {
	const store = useFilterStore();
	const [localPeriod, setLocalPeriod] = useState<FilterPeriod>("month");
	const [calendarOpen, setCalendarOpen] = useState(false);

	// Standalone mode uses local state; otherwise sync with filter store
	const activePeriod = standalone ? localPeriod : store.period;
	const activeRange = standalone
		? (value ?? getDateRange(localPeriod, fiscalYearStartMonth))
		: getDateRange(store.period, fiscalYearStartMonth, store.customRange ?? undefined);

	function selectPreset(period: FilterPeriod) {
		if (standalone) {
			setLocalPeriod(period);
			if (period !== "custom") {
				const range = getDateRange(period, fiscalYearStartMonth);
				onChange?.(range);
			}
		} else {
			store.setPeriod(period);
		}
		if (period !== "custom") setCalendarOpen(false);
		else setCalendarOpen(true);
	}

	function handleCustomRange(range: { from?: Date; to?: Date } | undefined) {
		if (!range?.from || !range.to) return;
		const dr: DateRange = { from: range.from, to: range.to };
		if (standalone) {
			onChange?.(dr);
			setCalendarOpen(false);
		} else {
			store.setCustomRange(dr);
			setCalendarOpen(false);
		}
	}

	const rangeLabel =
		activePeriod === "custom" && activeRange
			? `${format(activeRange.from, "d MMM")} – ${format(activeRange.to, "d MMM yy")}`
			: null;

	return (
		<div className="flex flex-wrap items-center gap-1.5">
			{PRESETS.map((preset) => (
				<Button
					key={preset.value}
					size="sm"
					variant={activePeriod === preset.value ? "default" : "outline"}
					className="h-7 px-2.5 text-xs"
					onClick={() => selectPreset(preset.value)}>
					{preset.value === "custom" && rangeLabel ? rangeLabel : preset.label}
				</Button>
			))}

			{/* Custom calendar popover */}
			{activePeriod === "custom" && (
				<Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
					<PopoverTrigger asChild>
						<Button variant="outline" size="sm" className="h-7 px-2.5 text-xs">
							<CalendarIcon className="mr-1 h-3.5 w-3.5" />
							Pick dates
						</Button>
					</PopoverTrigger>
					<PopoverContent className="w-auto p-0" align="start">
						<Calendar
							mode="range"
							selected={activeRange ? { from: activeRange.from, to: activeRange.to } : undefined}
							onSelect={handleCustomRange}
							numberOfMonths={2}
						/>
					</PopoverContent>
				</Popover>
			)}
		</div>
	);
}
