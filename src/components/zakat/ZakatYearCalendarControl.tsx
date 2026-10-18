"use client";

import { format } from "date-fns";
import {
	CalendarIcon,
	ChevronLeft,
	ChevronRight,
	RotateCcw,
	SlidersHorizontal,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { CARD_SURFACE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { clearZakatYearOverride, saveZakatYearOverride } from "@/lib/zakatYearRepository";

import type { ZakatYearDefinition } from "@/lib/zakatCalendar";
import type { ZakatYearSource } from "@/types";

const SOURCE_LABELS: Record<ZakatYearSource, string> = {
	announced: "Announced",
	computed: "Computed",
	manual: "Manual",
};

const SOURCE_DESCRIPTIONS: Record<ZakatYearSource, string> = {
	announced: "Sighted and announced by the Ruet-e-Hilal committee in Pakistan.",
	computed: "Estimated as the Umm al-Qura date plus one day, pending an announcement.",
	manual: "Set by you. The twelve months are recalculated from this date.",
};

const SOURCE_VARIANTS: Record<ZakatYearSource, "default" | "secondary" | "outline"> = {
	announced: "default",
	computed: "outline",
	manual: "secondary",
};

interface ZakatYearCalendarControlProps {
	userId: string;
	years: ZakatYearDefinition[];
	definition: ZakatYearDefinition;
	/** The single currency the whole page is scoped to. Never converted, never combined. */
	currency?: string;
	onSelectIslamicYear: (islamicYear: number) => void;
}

/**
 * The zakat year the whole page answers for, and the Ramaḍān date it is anchored on.
 *
 * The year scopes every tab — the calculator, the month grid, the payments and the
 * history trail — so it is chosen ONCE, above the tab bar, instead of being repeated
 * inside the two tabs that happened to show it and missing from the two that did not.
 *
 * Only the anchor is saved — the twelve months are always regenerated from it, so the
 * stored date and the displayed months can never disagree.
 *
 * On a phone the card would otherwise fill the screen before the tabs even start, so the
 * date picker and the sighting note fold away behind "Adjust"; the year dropdown and its
 * step arrows stay on screen, because changing the year is the one thing this control
 * exists for.
 */
export function ZakatYearCalendarControl({
	userId,
	years,
	definition,
	currency,
	onSelectIslamicYear,
}: ZakatYearCalendarControlProps) {
	const [calendarOpen, setCalendarOpen] = useState(false);
	const [saving, setSaving] = useState(false);
	const [detailsOpen, setDetailsOpen] = useState(false);

	const ramadanStart = definition.months[0]!.startDate;
	const shabanEnd = definition.months[11]!.endDate;
	const isManual = definition.ramadanSource === "manual";

	// Oldest first, so "previous" and "next" step the way the years run.
	const ordered = [...years].sort((left, right) => left.islamicYear - right.islamicYear);
	const index = ordered.findIndex((year) => year.islamicYear === definition.islamicYear);
	const previousYear = index > 0 ? ordered[index - 1] : undefined;
	const nextYear = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : undefined;

	async function handleSelectRamadanStart(date: Date) {
		setCalendarOpen(false);
		setSaving(true);
		try {
			await saveZakatYearOverride({
				userId,
				islamicYear: definition.islamicYear,
				ramadanStart: date,
			});
			toast.success(
				`Ramaḍān ${definition.islamicYear} now starts ${format(date, "d MMM yyyy")}. All 12 months recalculated.`
			);
		} catch (error) {
			console.error("Failed to save the Ramaḍān start date", error);
			toast.error("Could not save the Ramaḍān start date.");
		} finally {
			setSaving(false);
		}
	}

	async function handleReset() {
		setSaving(true);
		try {
			await clearZakatYearOverride(userId, definition.islamicYear);
			toast.success(`Ramaḍān ${definition.islamicYear} reset to the default date.`);
		} catch (error) {
			console.error("Failed to reset the Ramaḍān start date", error);
			toast.error("Could not reset the Ramaḍān start date.");
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className={cn(CARD_SURFACE, "space-y-2 p-3 sm:space-y-3 sm:p-4")}>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<h3 className="text-sm font-medium">Zakat Year Calendar</h3>
					<p className="text-xs text-muted-foreground">
						{format(ramadanStart, "d MMM yyyy")} – {format(shabanEnd, "d MMM yyyy")}
					</p>
				</div>
				<div className="flex items-center gap-2">
					{currency && <Badge variant="secondary">{currency}</Badge>}
					<Badge variant={SOURCE_VARIANTS[definition.ramadanSource]}>
						{SOURCE_LABELS[definition.ramadanSource]}
					</Badge>
				</div>
			</div>

			<div className="space-y-1.5">
				<Label htmlFor="zakat-year-select">Zakat Year</Label>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="icon"
						className="shrink-0"
						disabled={!previousYear}
						aria-label="Previous zakat year"
						onClick={() => previousYear && onSelectIslamicYear(previousYear.islamicYear)}>
						<ChevronLeft className="h-4 w-4" />
					</Button>
					<Select
						value={String(definition.islamicYear)}
						onValueChange={(value) => onSelectIslamicYear(Number(value))}>
						<SelectTrigger id="zakat-year-select" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{years.map((year) => (
								<SelectItem key={year.islamicYear} value={String(year.islamicYear)}>
									{year.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Button
						variant="outline"
						size="icon"
						className="shrink-0"
						disabled={!nextYear}
						aria-label="Next zakat year"
						onClick={() => nextYear && onSelectIslamicYear(nextYear.islamicYear)}>
						<ChevronRight className="h-4 w-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="shrink-0 sm:hidden"
						aria-expanded={detailsOpen}
						aria-label="Adjust the Ramaḍān date"
						onClick={() => setDetailsOpen(!detailsOpen)}>
						<SlidersHorizontal className="h-4 w-4" />
					</Button>
				</div>
				<p className="text-xs text-muted-foreground">
					Every tab below — calculator, monthly view, history and payments — answers for this year.
				</p>
			</div>

			<div className={cn("space-y-2 sm:block", detailsOpen ? "block" : "hidden")}>
				<div className="space-y-1.5">
					<Label>1 Ramaḍān {definition.islamicYear}</Label>
					<div className="flex items-center gap-2">
						<Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
							<PopoverTrigger asChild>
								<Button
									variant="outline"
									disabled={saving}
									className="w-full justify-start font-normal">
									<CalendarIcon className="mr-2 h-4 w-4" />
									{format(ramadanStart, "d MMMM yyyy")}
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-auto p-0" align="start">
								<Calendar
									mode="single"
									selected={ramadanStart}
									defaultMonth={ramadanStart}
									onSelect={(date) => {
										if (date) void handleSelectRamadanStart(date);
									}}
								/>
							</PopoverContent>
						</Popover>
						{isManual && (
							<Button
								variant="ghost"
								size="icon"
								disabled={saving}
								aria-label="Reset to default date"
								onClick={() => void handleReset()}>
								<RotateCcw className="h-4 w-4" />
							</Button>
						)}
					</div>
				</div>

				<p className="text-xs text-muted-foreground">
					{SOURCE_DESCRIPTIONS[definition.ramadanSource]} Month lengths always come from the Umm
					al-Qura calendar.
				</p>
			</div>
		</div>
	);
}
