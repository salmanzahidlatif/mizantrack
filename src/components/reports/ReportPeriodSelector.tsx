"use client";

import { format } from "date-fns";
import { CalendarRange } from "lucide-react";

import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CARD_SURFACE } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type { FiscalReportRange } from "@/hooks/useFiscalReport";
import type { FiscalYearOption } from "@/lib/reports/reportFiscalYears";
import type { DateRange } from "@/types";

export type ReportPeriodMode = "fiscal-year" | "custom";

interface ReportPeriodSelectorProps {
	options: FiscalYearOption[];
	selectedKey: string;
	onSelectFiscalYear: (key: string) => void;
	mode: ReportPeriodMode;
	onModeChange: (mode: ReportPeriodMode) => void;
	customRange?: DateRange;
	onCustomRangeChange: (range: DateRange) => void;
	fiscalYearStartMonth: number;
	range?: FiscalReportRange;
}

export function ReportPeriodSelector({
	options,
	selectedKey,
	onSelectFiscalYear,
	mode,
	onModeChange,
	customRange,
	onCustomRangeChange,
	fiscalYearStartMonth,
	range,
}: ReportPeriodSelectorProps) {
	const isCustom = mode === "custom";

	return (
		<section className={cn(CARD_SURFACE, "space-y-4 p-4")} aria-labelledby="report-period-heading">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h2 id="report-period-heading" className="text-sm font-semibold">
						Report period
					</h2>
					<p className="text-xs text-muted-foreground">
						Everything below is recalculated for this period.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Label htmlFor="report-custom-range" className="text-xs text-muted-foreground">
						Custom range
					</Label>
					<Switch
						id="report-custom-range"
						size="sm"
						checked={isCustom}
						onCheckedChange={(checked) => onModeChange(checked ? "custom" : "fiscal-year")}
					/>
				</div>
			</div>

			{isCustom ? (
				<DateRangePicker
					standalone
					value={customRange}
					onChange={onCustomRangeChange}
					fiscalYearStartMonth={fiscalYearStartMonth}
				/>
			) : (
				<div className="space-y-1.5">
					<Label className="text-xs">Fiscal year</Label>
					<Select value={selectedKey} onValueChange={onSelectFiscalYear}>
						<SelectTrigger className="w-full sm:w-56">
							<SelectValue placeholder="Select a fiscal year" />
						</SelectTrigger>
						<SelectContent>
							{options.map((option) => (
								<SelectItem key={option.key} value={option.key}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			)}

			{range && (
				<p className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<CalendarRange className="h-3.5 w-3.5" aria-hidden="true" />
					<span data-testid="report-resolved-range">
						{format(range.fromMs, "d MMM yyyy")} – {format(range.toMs, "d MMM yyyy")}
					</span>
				</p>
			)}
		</section>
	);
}
