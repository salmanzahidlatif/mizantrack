"use client";

import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { DateRangePicker } from "@/components/shared/DateRangePicker";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useDbConfig } from "@/hooks/useDbConfig";
import { getDateRange } from "@/lib/dateRange";
import { exportToExcel, exportToHysabKytabSqliteDb } from "@/lib/export";

import type { DateRange } from "@/types";

interface ExportPanelProps {
	userId: string;
}

export function ExportPanel({ userId }: ExportPanelProps) {
	const config = useDbConfig(userId);
	const fiscalYearStartMonth = config?.fiscalYearStartMonth ?? 7;
	const enabledCurrencies =
		config?.enabledCurrencies ?? (config?.currency ? [config.currency] : ["PKR"]);
	const defaultCurrency = config?.currency ?? enabledCurrencies[0] ?? "PKR";

	const [open, setOpen] = useState(false);
	const [exporting, setExporting] = useState(false);
	const [range, setRange] = useState<DateRange>(() => getDateRange("all"));
	const [currency, setCurrency] = useState(defaultCurrency);
	const [includeArchivedAccounts, setIncludeArchivedAccounts] = useState(true);
	const [format, setFormat] = useState<"xlsx" | "hysab-kytab-db">("hysab-kytab-db");

	function handleOpen() {
		setRange(getDateRange("all"));
		setCurrency(config?.currency ?? enabledCurrencies[0] ?? "PKR");
		setIncludeArchivedAccounts(true);
		setFormat("hysab-kytab-db");
		setOpen(true);
	}

	async function handleDownload() {
		setExporting(true);
		try {
			if (format === "hysab-kytab-db") {
				await exportToHysabKytabSqliteDb(userId, range, {
					currency,
					includeArchivedAccounts,
				});
			} else {
				await exportToExcel(userId, range, { currency, includeArchivedAccounts });
			}
			setOpen(false);
		} catch {
			toast.error("Export failed. Please try again.");
		} finally {
			setExporting(false);
		}
	}

	return (
		<div className="space-y-3 rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
			<div>
				<h2 className="font-semibold">Export Data</h2>
				<p className="mt-0.5 text-sm text-muted-foreground">
					Download your data as a Hysab Kytab .db file or Excel workbook
				</p>
			</div>

			<Button variant="outline" onClick={handleOpen}>
				<Download className="mr-2 h-4 w-4" />
				Download Export
			</Button>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>Export Data</DialogTitle>
						<DialogDescription>
							Only one currency is exported at a time. Hysab Kytab .db exports keep transfer legs
							paired with mutual REFNO values and populate account currencies.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-2">
						<div className="space-y-1.5">
							<Label>Format</Label>
							<div className="flex flex-wrap gap-1.5">
								<button
									type="button"
									onClick={() => setFormat("hysab-kytab-db")}
									className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
										format === "hysab-kytab-db"
											? "border-primary bg-primary/10 text-primary"
											: "border-border text-muted-foreground hover:bg-muted/50"
									}`}>
									Hysab Kytab .db
								</button>
								<button
									type="button"
									onClick={() => setFormat("xlsx")}
									className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
										format === "xlsx"
											? "border-primary bg-primary/10 text-primary"
											: "border-border text-muted-foreground hover:bg-muted/50"
									}`}>
									Excel .xlsx
								</button>
							</div>
						</div>

						<div className="space-y-1.5">
							<Label>Currency</Label>
							<div className="flex flex-wrap gap-1.5">
								{enabledCurrencies.map((code) => (
									<button
										key={code}
										type="button"
										onClick={() => setCurrency(code)}
										className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
											currency === code
												? "border-primary bg-primary/10 text-primary"
												: "border-border text-muted-foreground hover:bg-muted/50"
										}`}>
										{code}
									</button>
								))}
							</div>
						</div>

						<div className="space-y-1.5">
							<Label>Date range</Label>
							<DateRangePicker
								standalone
								value={range}
								onChange={setRange}
								fiscalYearStartMonth={fiscalYearStartMonth}
							/>
						</div>

						<div className="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2.5">
							<div>
								<p className="text-sm font-medium">Include archived accounts</p>
								<p className="text-xs text-muted-foreground">Off exports active accounts only</p>
							</div>
							<Switch
								checked={includeArchivedAccounts}
								onCheckedChange={setIncludeArchivedAccounts}
							/>
						</div>
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
