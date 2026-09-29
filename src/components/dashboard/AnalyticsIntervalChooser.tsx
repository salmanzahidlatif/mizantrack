"use client";

import { Check } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useHaptics } from "@/hooks/useHaptics";
import { cn } from "@/lib/utils";

import type { AnalyticsInterval } from "@/lib/dateRange";

export const ANALYTICS_INTERVAL_OPTIONS = [
	{ value: "monthly", label: "Monthly" },
	{ value: "quarterly", label: "Quarterly" },
	{ value: "half-yearly", label: "Half yearly" },
	{ value: "yearly", label: "Yearly" },
	{ value: "all-time", label: "All Time" },
] as const satisfies ReadonlyArray<{ value: AnalyticsInterval; label: string }>;

interface AnalyticsIntervalChooserProps {
	open: boolean;
	value: AnalyticsInterval;
	onOpenChange: (open: boolean) => void;
	onApply: (value: AnalyticsInterval) => void;
}

export function getIntervalLabel(interval: AnalyticsInterval) {
	return ANALYTICS_INTERVAL_OPTIONS.find((option) => option.value === interval)?.label ?? "Monthly";
}

export function AnalyticsIntervalChooser({
	open,
	value,
	onOpenChange,
	onApply,
}: AnalyticsIntervalChooserProps) {
	const [draft, setDraft] = useState<AnalyticsInterval>(value);
	const haptics = useHaptics();

	useEffect(() => {
		if (open) setDraft(value);
	}, [open, value]);

	function handleApply() {
		onApply(draft);
		haptics.selection();
		onOpenChange(false);
	}

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-sm">
				<DialogHeader>
					<DialogTitle>Choose Interval</DialogTitle>
					<DialogDescription>
						Selected interval: <span className="font-medium">{getIntervalLabel(draft)}</span>
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-2 py-1" role="radiogroup" aria-label="Analytics interval">
					{ANALYTICS_INTERVAL_OPTIONS.map((option) => {
						const selected = draft === option.value;

						return (
							<label
								key={option.value}
								className={cn(
									"press flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-3 transition-colors",
									selected
										? "border-primary/60 bg-primary/10 text-foreground"
										: "border-border/70 bg-card hover:bg-muted/45"
								)}>
								<input
									type="radio"
									name="analytics-interval"
									value={option.value}
									checked={selected}
									onChange={() => {
										setDraft(option.value);
										haptics.light();
									}}
									className="h-4 w-4 accent-primary"
								/>
								<span className="flex-1 text-sm font-medium">{option.label}</span>
								{selected && <Check className="h-4 w-4 text-primary" aria-hidden="true" />}
							</label>
						);
					})}
				</div>

				<DialogFooter>
					<Button onClick={handleApply} className="w-full">
						APPLY
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
