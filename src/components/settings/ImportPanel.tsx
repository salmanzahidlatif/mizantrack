"use client";

import { FileUp, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { CurrencyPicker } from "@/components/shared/CurrencyPicker";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { useDbConfig } from "@/hooks/useDbConfig";
import { FIRESTORE_FREE_TIER_DAILY_WRITE_LIMIT } from "@/lib/db/sync";
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

// Only surface the quota note once an import is large enough to consume a
// meaningful chunk of the 20,000-write free tier in a single follow-up sync.
const IMPORT_SYNC_QUOTA_NOTE_THRESHOLD = 2_000;

function formatCount(value: number): string {
	return new Intl.NumberFormat("en-US").format(value);
}

export function ImportPanel({ userId }: ImportPanelProps) {
	const config = useDbConfig(userId);
	const enabledCurrencies =
		config?.enabledCurrencies ?? (config?.currency ? [config.currency] : ["PKR"]);
	const needsCurrencyPrompt = enabledCurrencies.length > 1;

	const fileRef = useRef<HTMLInputElement>(null);
	const [importing, setImporting] = useState(false);
	const [result, setResult] = useState<ImportResult | null>(null);
	const [pendingFile, setPendingFile] = useState<File | null>(null);
	const [currencyPickerOpen, setCurrencyPickerOpen] = useState(false);
	const [selectedCurrency, setSelectedCurrency] = useState<string>("PKR");
	const totalImportedRecords = result
		? result.accounts + result.categories + result.transactions
		: 0;
	const showQuotaNote = totalImportedRecords >= IMPORT_SYNC_QUOTA_NOTE_THRESHOLD;
	const quotaPercent = Math.min(
		100,
		Math.round((totalImportedRecords / FIRESTORE_FREE_TIER_DAILY_WRITE_LIMIT) * 100)
	);

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
				<span className="text-xs text-muted-foreground">.xlsx / .xls files</span>
			</div>
			<p className="text-xs text-muted-foreground">
				Transaction dates are read from the sheet. If a date is missing or unreadable it defaults to
				1 Jan 2000 so your recent history is unaffected.
			</p>

			{/* Hidden file input */}
			<input
				ref={fileRef}
				type="file"
				accept=".xlsx,.xls"
				className="hidden"
				onChange={(e) => {
					void handleFile(e);
				}}
			/>

			{/* Currency selector for multi-currency import */}
			<CurrencyPicker
				selected={selectedCurrency ? [selectedCurrency] : [enabledCurrencies[0] ?? "PKR"]}
				onChange={(codes) => {
					void handleCurrencyConfirm(codes);
				}}
				singleSelect
				open={currencyPickerOpen}
				onOpenChange={(v) => {
					if (!v) {
						setPendingFile(null);
						setCurrencyPickerOpen(false);
					}
				}}
			/>

			{/* Import result dialog */}
			<Dialog open={!!result} onOpenChange={() => setResult(null)}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>Import Complete</DialogTitle>
						<DialogDescription>Your Hysab Kytab data has been imported.</DialogDescription>
					</DialogHeader>
					{result && (
						<div className="space-y-3 py-2">
							<div className="divide-y divide-border rounded-lg border border-border">
								{[
									{ label: "Accounts imported", value: result.accounts },
									{ label: "Categories imported", value: result.categories },
									{ label: "Transactions imported", value: result.transactions },
									{ label: "Transfers paired", value: result.transfersPaired },
									...(result.autoCreated > 0
										? [{ label: "Accounts auto-created", value: result.autoCreated }]
										: []),
								].map(({ label, value }) => (
									<div key={label} className="flex justify-between px-4 py-2 text-sm">
										<span className="text-muted-foreground">{label}</span>
										<span className="font-medium">{value}</span>
									</div>
								))}
							</div>
							<p className="text-xs text-muted-foreground">
								Re-importing the same file is safe — transactions are deduplicated by row.
							</p>
							{showQuotaNote && (
								<p className="text-xs text-muted-foreground">
									This import created {formatCount(totalImportedRecords)} records. Your next sync
									will push up to {formatCount(totalImportedRecords)} documents to Firebase —
									that&apos;s about {quotaPercent}% of the daily{" "}
									{formatCount(FIRESTORE_FREE_TIER_DAILY_WRITE_LIMIT)}-write free-tier limit. If
									it&apos;s a lot, syncing may take more than one day; that&apos;s expected and
									safe.
								</p>
							)}
							{result.autoCreatedAccounts?.length > 0 && (
								<p className="text-xs text-amber-600 dark:text-amber-400">
									Auto-created (archived): {result.autoCreatedAccounts.join(", ")}
								</p>
							)}
						</div>
					)}
				</DialogContent>
			</Dialog>
		</div>
	);
}
