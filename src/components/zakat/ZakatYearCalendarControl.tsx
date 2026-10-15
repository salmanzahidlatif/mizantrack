"use client";

import { format } from "date-fns";
import { CalendarIcon, RotateCcw } from "lucide-react";
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
	onSelectIslamicYear: (islamicYear: number) => void;
}

/**
 * Lets the owner re-anchor a zakat year on the Ramaḍān date that was actually observed.
 *
 * Only the anchor is saved — the twelve months are always regenerated from it, so the
 * stored date and the displayed months can never disagree.
 */
export function ZakatYearCalendarControl({
	userId,
	years,
	definition,
	onSelectIslamicYear,
}: ZakatYearCalendarControlProps) {
	const [calendarOpen, setCalendarOpen] = useState(false);
	const [saving, setSaving] = useState(false);

	const ramadanStart = definition.months[0]!.startDate;
	const shabanEnd = definition.months[11]!.endDate;
	const isManual = definition.ramadanSource === "manual";

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
		<div className={cn(CARD_SURFACE, "space-y-3 p-4")}>
			<div className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<h3 className="text-sm font-medium">Zakat Year Calendar</h3>
					<p className="text-xs text-muted-foreground">
						{format(ramadanStart, "d MMM yyyy")} – {format(shabanEnd, "d MMM yyyy")}
					</p>
				</div>
				<Badge variant={SOURCE_VARIANTS[definition.ramadanSource]}>
					{SOURCE_LABELS[definition.ramadanSource]}
				</Badge>
			</div>

			<div className="grid gap-3 sm:grid-cols-2">
				<div className="space-y-1.5">
					<Label htmlFor="zakat-year-select">Zakat Year</Label>
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
				</div>

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
			</div>

			<p className="text-xs text-muted-foreground">
				{SOURCE_DESCRIPTIONS[definition.ramadanSource]} Month lengths always come from the Umm
				al-Qura calendar.
			</p>
		</div>
	);
}
