"use client";

import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useDbConfig } from "@/hooks/useDbConfig";
import { getDateRange } from "@/lib/dateRange";
import { exportToExcel } from "@/lib/export";

import type { DateRange } from "@/types";

interface ExportPanelProps {
	userId: string;
}

export function ExportPanel({ userId }: ExportPanelProps) {
	const config = useDbConfig(userId);
	const fiscalYearStartMonth = config?.fiscalYearStartMonth ?? 7;

	const [open, setOpen] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [range, setRange] = useState<DateRange>(() => getDateRange("month", fiscalYearStartMonth));

	function handleOpen() {
		setRange(getDateRange("month", fiscalYearStartMonth));
		setOpen(true);
	}

	async function handleDownload() {
		setExporting(true);
		try {
			await exportToExcel(userId, range);
			setOpen(false);
		} catch {
			toast.error("Export failed. Please try again.");
		} finally {
			setExporting(false);
		}
	}

	return (
		<div className="space-y-3 rounded-xl border border-border bg-card p-4">
			<div>
				<h2 className="font-semibold">Export Data</h2>
				<p className="mt-0.5 text-sm text-muted-foreground">
					Download your transactions as an Excel file
				</p>
			</div>

			<Button variant="outline" onClick={handleOpen}>
				<Download className="mr-2 h-4 w-4" />
				Download Export
			</Button>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>Export to Excel</DialogTitle>
					</DialogHeader>
					<div className="space-y-3 py-2">
						<p className="text-sm text-muted-foreground">Select date range:</p>
						<DateRangePicker
							standalone
							value={range}
							onChange={setRange}
							fiscalYearStartMonth={fiscalYearStartMonth}
						/>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setOpen(false)}>
							Cancel
						</Button>
						<Button
							onClick={() => {
								void handleDownload();
							}}
							disabled={exporting}>
							{exporting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
							Download
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
