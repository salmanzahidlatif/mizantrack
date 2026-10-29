"use client";

import { format } from "date-fns";
import { CalendarIcon, Repeat } from "lucide-react";
import { useState } from "react";

import { FieldSwitch } from "@/components/shared/FieldSwitch";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	MAX_RECURRENCE_OCCURRENCES,
	RECURRENCE_FREQUENCIES,
	describeRecurrenceFrequency,
	generateRecurrenceDates,
} from "@/lib/recurrence";
import { cn } from "@/lib/utils";

import type { RecurrenceFrequency, RecurrenceRule } from "@/types";

export interface RecurrenceDraft {
	enabled: boolean;
	frequency: RecurrenceFrequency;
	interval: number;
	endMode: "count" | "until";
	count: number;
	until: Date | undefined;
}

export const DEFAULT_RECURRENCE_DRAFT: RecurrenceDraft = {
	enabled: false,
	frequency: "monthly",
	interval: 1,
	endMode: "count",
	count: 12,
	until: undefined,
};

const FREQUENCY_LABEL: Record<RecurrenceFrequency, string> = {
	daily: "Daily",
	weekly: "Weekly",
	monthly: "Monthly",
	yearly: "Yearly",
};

const INTERVAL_UNIT: Record<RecurrenceFrequency, string> = {
	daily: "day(s)",
	weekly: "week(s)",
	monthly: "month(s)",
	yearly: "year(s)",
};

/**
 * Turns the drawer's draft into the rule the action expands, or null when the draft is
 * off or still incomplete (an "until" end with no date picked yet).
 */
export function toRecurrenceRule(draft: RecurrenceDraft): RecurrenceRule | null {
	if (!draft.enabled) return null;

	const interval = Math.max(1, Math.floor(draft.interval || 1));
	if (draft.endMode === "until") {
		if (!draft.until) return null;
		return { frequency: draft.frequency, interval, endMode: "until", until: draft.until };
	}
	const count = Math.floor(draft.count || 0);
	if (count < 2) return null;
	return { frequency: draft.frequency, interval, endMode: "count", count };
}

interface RecurrenceFieldsProps {
	startDate: Date | undefined;
	value: RecurrenceDraft;
	onChange: (next: RecurrenceDraft) => void;
}

export function RecurrenceFields({ startDate, value, onChange }: RecurrenceFieldsProps) {
	const [untilPickerOpen, setUntilPickerOpen] = useState(false);

	const rule = toRecurrenceRule(value);
	const occurrences = rule && startDate ? generateRecurrenceDates(startDate, rule) : [];
	const lastOccurrence = occurrences.at(-1);

	function patch(next: Partial<RecurrenceDraft>) {
		onChange({ ...value, ...next });
	}

	return (
		<div className="space-y-3 rounded-lg border border-border p-3">
			<div className="flex items-center justify-between gap-3">
				<Label
					htmlFor="txn-repeat"
					className="flex items-center gap-2 text-sm font-medium text-foreground">
					<Repeat className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
					Repeat this transaction
				</Label>
				<FieldSwitch
					id="txn-repeat"
					label="Repeat this transaction"
					checked={value.enabled}
					onCheckedChange={(enabled) => patch({ enabled })}
				/>
			</div>

			{!value.enabled && (
				<p className="text-xs text-muted-foreground">
					Create the same transaction on a schedule — rent every month, a subscription every week.
				</p>
			)}

			{value.enabled && (
				<div className="space-y-3">
					<div className="space-y-1.5">
						<Label className="text-xs">Frequency</Label>
						<div className="grid grid-cols-4 gap-1.5">
							{RECURRENCE_FREQUENCIES.map((frequency) => (
								<button
									key={frequency}
									type="button"
									aria-pressed={value.frequency === frequency}
									onClick={() => patch({ frequency })}
									className={cn(
										"rounded-lg border py-2 text-xs font-medium transition-colors",
										value.frequency === frequency
											? "border-primary bg-primary text-primary-foreground"
											: "border-border hover:border-primary"
									)}>
									{FREQUENCY_LABEL[frequency]}
								</button>
							))}
						</div>
					</div>

					<div className="space-y-1.5">
						<Label htmlFor="txn-repeat-interval" className="text-xs">
							Every
						</Label>
						<div className="flex items-center gap-2">
							<Input
								id="txn-repeat-interval"
								type="number"
								min="1"
								max="99"
								step="1"
								inputMode="numeric"
								className="h-8 w-20 text-xs"
								value={value.interval}
								onChange={(event) => patch({ interval: Number(event.target.value) })}
							/>
							<span className="text-xs text-muted-foreground">
								{INTERVAL_UNIT[value.frequency]}
							</span>
						</div>
					</div>

					<div className="space-y-1.5">
						<Label className="text-xs">Ends</Label>
						<div className="grid grid-cols-2 gap-1.5">
							<button
								type="button"
								aria-pressed={value.endMode === "count"}
								onClick={() => patch({ endMode: "count" })}
								className={cn(
									"rounded-lg border py-2 text-xs font-medium transition-colors",
									value.endMode === "count"
										? "border-primary bg-primary text-primary-foreground"
										: "border-border hover:border-primary"
								)}>
								After a number
							</button>
							<button
								type="button"
								aria-pressed={value.endMode === "until"}
								onClick={() => patch({ endMode: "until" })}
								className={cn(
									"rounded-lg border py-2 text-xs font-medium transition-colors",
									value.endMode === "until"
										? "border-primary bg-primary text-primary-foreground"
										: "border-border hover:border-primary"
								)}>
								On a date
							</button>
						</div>
					</div>

					{value.endMode === "count" ? (
						<div className="space-y-1.5">
							<Label htmlFor="txn-repeat-count" className="text-xs">
								Number of transactions
							</Label>
							<Input
								id="txn-repeat-count"
								type="number"
								min="2"
								max={MAX_RECURRENCE_OCCURRENCES}
								step="1"
								inputMode="numeric"
								className="h-8 w-24 text-xs"
								value={value.count}
								onChange={(event) => patch({ count: Number(event.target.value) })}
							/>
						</div>
					) : (
						<div className="space-y-1.5">
							<Label className="text-xs">Repeat until</Label>
							<Popover open={untilPickerOpen} onOpenChange={setUntilPickerOpen}>
								<PopoverTrigger asChild>
									<Button
										type="button"
										variant="outline"
										className="h-8 w-full justify-start text-xs font-normal">
										<CalendarIcon className="mr-2 h-3.5 w-3.5" />
										{value.until ? format(value.until, "d MMMM yyyy") : "Pick an end date"}
									</Button>
								</PopoverTrigger>
								<PopoverContent className="w-auto p-0" align="start">
									<Calendar
										mode="single"
										selected={value.until}
										onSelect={(date) => {
											if (!date) return;
											patch({ until: date });
											setUntilPickerOpen(false);
										}}
									/>
								</PopoverContent>
							</Popover>
						</div>
					)}

					<p
						className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground"
						role="status">
						{occurrences.length > 0 && lastOccurrence ? (
							<>
								{describeRecurrenceFrequency(value.frequency, value.interval)} — creates{" "}
								<span className="font-semibold text-foreground">{occurrences.length}</span>{" "}
								transactions, ending {format(lastOccurrence, "d MMM yyyy")}.
								{occurrences.length === MAX_RECURRENCE_OCCURRENCES &&
									` Capped at ${MAX_RECURRENCE_OCCURRENCES}.`}
							</>
						) : (
							"Choose how the repeat ends to preview the schedule."
						)}
					</p>
				</div>
			)}
		</div>
	);
}
