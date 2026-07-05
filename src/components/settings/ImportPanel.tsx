"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { CurrencyPicker } from "@/components/shared/CurrencyPicker";
import { Button } from "@/components/ui/button";
import { useDbConfig } from "@/hooks/useDbConfig";
import { importHysabKytab } from "@/lib/import/hysabKytab";

interface ImportPanelProps {
	userId: string;
}

interface ImportResult {
	accounts: number;
	categories: number;
	transactions: number;
	transfersPaired: number;
	autoCreated: number;
	autoCreatedAccounts: string[];
}

export function ImportPanel({ userId }: ImportPanelProps) {
	const config = useDbConfig(userId);
	const enabledCurrencies = config?.enabledCurrencies ?? (config?.currency ? [config.currency] : ["PKR"]);
	const needsCurrencyPrompt = enabledCurrencies.length > 1;

	const fileRef = useRef<HTMLInputElement>(null);
	const [importing, setImporting] = useState(false);
	const [result, setResult] = useState<ImportResult | null>(null);
	const [pendingFile, setPendingFile] = useState<File | null>(null);
	const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false);
	const [selectedCurrency, setSelectedCurrency] = useState<string>("PKR");

	async function runImport(file: File, targetCurrency?: string) {
		setImporting(true);
		try {
			const res = await importHysabKytab(file, userId, targetCurrency);
			setResult(res);
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Import failed";
			toast.error(msg);
		} finally {
			setImporting(false);
			if (fileRef.current) fileRef.current.value = "";
			setPendingFile(null);
		}
	}

	async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;

		if (needsCurrencyPrompt) {
			setPendingFile(file);
			setSelectedCurrency(config?.currency ?? enabledCurrencies[0] ?? "PKR");
			setCurrencyPickerOpen(true);
		} else {
			await runImport(file);
		}
	}

	async function handleCurrencyConfirm(codes: string[]) {
		const currency = codes[0] ?? enabledCurrencies[0] ?? "PKR";
		setSelectedCurrency(currency);
		setCurrencyPickerOpen(false);
		if (pendingFile) await runImport(pendingFile, currency);
	}

	return (
		<div className="space-y-3 rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
			<div>
				<h2 className="font-semibold">Import Data</h2>
				<p className="mt-0.5 text-sm text-muted-foreground">
					Import your Hysab Kytab backup (.xlsx or .xls file)
				</p>
			</div>

			<div className="flex items-center gap-3">
				<Button variant="outline" disabled={importing} onClick={() => fileRef.current?.click()}>
					{importing ? (
						<>
							<Loader2 className="mr-2 h-4 w-4 animate-spin" />
							Importing…
						</>
					) : (
						<>
							<FileUp className="mr-2 h-4 w-4" />
							Choose HK File
						</>
					)}
				</Button>
				<span className="text-xs text-muted-foreground">.xlsx / .xls / .csv</span>
			</div>
			<p className="text-xs text-muted-foreground">
				Transaction dates are read from the sheet. If a date is missing or unreadable it defaults to 1 Jan 2000 so your recent history is unaffected.
			</p>

			{/* Hidden file input */}
			<input
				ref={fileRef}
				type="file"
				accept=".xlsx,.xls,.csv"
				className="hidden"
				onChange={(e) => {
					void handleFile(e);
				}}
			/>

			{/* Currency selector for multi-currency import */}
			<CurrencyPicker
				selected={selectedCurrency ? [selectedCurrency] : [enabledCurrencies[0] ?? "PKR"]}
				onChange={(codes) => { void handleCurrencyConfirm(codes); }}
				singleSelect
				open={currencyPickerOpen}
				onOpenChange={(v) => {
					if (!v) { setPendingFile(null); setCurrencyPickerOpen(false); }
				}}
			/>
		</div>
	);
}
