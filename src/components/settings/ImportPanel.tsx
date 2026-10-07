"use client";

import { AlertTriangle, CheckCircle2, FileUp, Loader2 } from "lucide-react";
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
import {
	HYSAB_KYTAB_RECLASSIFY_RESOLUTION,
	commitHysabKytabSqliteImport,
	isHysabKytabSqliteFile,
	prepareHysabKytabSqliteImport,
} from "@/lib/import/hysabKytabSqlite";

import type {
	HysabKytabSqliteImportPlan,
	HysabKytabVerificationReport,
} from "@/lib/import/hysabKytabSqlite";

interface ImportPanelProps {
	userId: string;
}

interface ImportResult {
	accounts: number;
	categories: number;
	transactions: number;
	transfersPaired: number;
	budgets?: number;
	unmatchedTransferAdjustments?: number;
	unresolvedTransfersResolved?: number;
	autoCreated: number;
	autoCreatedAccounts: string[];
	verification?: HysabKytabVerificationReport;
}

// Only surface the quota note once an import is large enough to consume a
// meaningful chunk of the 20,000-write free tier in a single follow-up sync.
const IMPORT_SYNC_QUOTA_NOTE_THRESHOLD = 2_000;

function formatCount(value: number): string {
	return new Intl.NumberFormat("en-US").format(value);
}

function formatMoney(value: number): string {
	return new Intl.NumberFormat("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(value);
}

function defaultTransferResolutions(plan: HysabKytabSqliteImportPlan): Record<string, string> {
	return Object.fromEntries(
		plan.unresolvedTransfers.map((transfer) => [
			transfer.voucherId,
			HYSAB_KYTAB_RECLASSIFY_RESOLUTION,
		])
	);
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
	const [pendingSqlitePlan, setPendingSqlitePlan] = useState<HysabKytabSqliteImportPlan | null>(
		null
	);
	const [transferResolutions, setTransferResolutions] = useState<Record<string, string>>({});
	const totalImportedRecords = result
		? result.accounts + result.categories + result.transactions + (result.budgets ?? 0)
		: 0;
	const showQuotaNote = totalImportedRecords >= IMPORT_SYNC_QUOTA_NOTE_THRESHOLD;
	const quotaPercent = Math.min(
		100,
		Math.round((totalImportedRecords / FIRESTORE_FREE_TIER_DAILY_WRITE_LIMIT) * 100)
	);

	async function runImport(file: File, targetCurrency?: string) {
		setImporting(true);
		try {
			if (isHysabKytabSqliteFile(file)) {
				const currency = targetCurrency ?? config?.currency ?? enabledCurrencies[0] ?? "PKR";
				const plan = await prepareHysabKytabSqliteImport(file, userId, currency);
				if (plan.unresolvedTransfers.length > 0) {
					setPendingSqlitePlan(plan);
					setTransferResolutions(defaultTransferResolutions(plan));
					toast.warning("Resolve the listed transfer records before import continues.");
					return;
				}
				const res = await commitHysabKytabSqliteImport(plan);
				setResult(res);
			} else {
				const res = await importHysabKytab(file, userId, targetCurrency);
				setResult(res);
			}
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

	async function finishSqliteImportWithFallback() {
		if (!pendingSqlitePlan) return;
		setImporting(true);
		try {
			const res = await commitHysabKytabSqliteImport(pendingSqlitePlan, {
				useFallbackForAll: true,
			});
			setResult(res);
			setPendingSqlitePlan(null);
			setTransferResolutions({});
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Import failed";
			toast.error(msg);
		} finally {
			setImporting(false);
		}
	}

	async function finishSqliteImportAsIncomeExpense() {
		if (!pendingSqlitePlan) return;
		setImporting(true);
		try {
			const res = await commitHysabKytabSqliteImport(pendingSqlitePlan, {
				useReclassificationForAll: true,
			});
			setResult(res);
			setPendingSqlitePlan(null);
			setTransferResolutions({});
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Import failed";
			toast.error(msg);
		} finally {
			setImporting(false);
		}
	}

	async function finishSqliteImportWithSelections() {
		if (!pendingSqlitePlan) return;
		const missing = pendingSqlitePlan.unresolvedTransfers.filter(
			(transfer) => !transferResolutions[transfer.voucherId]
		);
		if (missing.length > 0) {
			toast.error("Choose an account for every unresolved transfer.");
			return;
		}

		setImporting(true);
		try {
			const res = await commitHysabKytabSqliteImport(pendingSqlitePlan, {
				byVoucherId: transferResolutions,
			});
			setResult(res);
			setPendingSqlitePlan(null);
			setTransferResolutions({});
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Import failed";
			toast.error(msg);
		} finally {
			setImporting(false);
		}
	}

	return (
		<div className="space-y-3 rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
			<div>
				<h2 className="font-semibold">Import Data</h2>
				<p className="mt-0.5 text-sm text-muted-foreground">
					Import your Hysab Kytab backup (.db, .xlsx, or .xls file)
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
				<span className="text-xs text-muted-foreground">.db / .xlsx / .xls files</span>
			</div>
			<p className="text-xs text-muted-foreground">
				SQLite .db backups are merged by source ID, stamped with the selected currency, and
				reconciled before the result is shown.
			</p>

			{/* Hidden file input */}
			<input
				ref={fileRef}
				type="file"
				accept=".db,.sqlite,.sqlite3,.xlsx,.xls"
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

			<Dialog open={!!pendingSqlitePlan} onOpenChange={() => setPendingSqlitePlan(null)}>
				<DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
					<DialogHeader>
						<DialogTitle>Resolve transfer counterparties</DialogTitle>
						<DialogDescription>
							Nothing has been written yet. Choose where each unmatched Hysab Kytab transfer should
							balance before import continues.
						</DialogDescription>
					</DialogHeader>
					{pendingSqlitePlan && (
						<div className="space-y-4 py-2">
							<div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
								<div className="flex items-start gap-2">
									<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
									<p>
										Found {pendingSqlitePlan.unresolvedTransfers.length} transfer leg
										{pendingSqlitePlan.unresolvedTransfers.length === 1 ? "" : "s"} with no usable
										counterpart. You can assign all to an archived{" "}
										<span className="font-medium">{pendingSqlitePlan.fallbackAccount.title}</span>{" "}
										account, or choose accounts individually.
									</p>
								</div>
							</div>

							<div className="space-y-3">
								{pendingSqlitePlan.unresolvedTransfers.map((transfer) => (
									<div
										key={transfer.voucherId}
										className="space-y-2 rounded-lg border border-border p-3 text-sm">
										<div className="flex flex-wrap items-start justify-between gap-3">
											<div>
												<p className="font-medium">
													{transfer.dateLabel} · {formatMoney(transfer.amount)}{" "}
													{pendingSqlitePlan.currency}
												</p>
												<p className="text-muted-foreground">
													{transfer.direction === "missing-destination"
														? "Source"
														: "Receiving account"}
													: {transfer.accountTitle}
												</p>
												{transfer.description ? (
													<p className="text-muted-foreground">
														Description: {transfer.description}
													</p>
												) : null}
												<p className="text-amber-700 dark:text-amber-300">
													Why it needs review: {transfer.reason}
												</p>
											</div>
											<span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
												Voucher {transfer.voucherId}
											</span>
										</div>
										<label className="block space-y-1">
											<span className="text-xs text-muted-foreground">
												{transfer.direction === "missing-destination"
													? "Destination account"
													: "Source account"}
											</span>
											<select
												className="min-h-11 w-full rounded-xl border border-input bg-background px-3 text-sm"
												value={
													transferResolutions[transfer.voucherId] ??
													HYSAB_KYTAB_RECLASSIFY_RESOLUTION
												}
												onChange={(event) =>
													setTransferResolutions((current) => ({
														...current,
														[transfer.voucherId]: event.target.value,
													}))
												}>
												<option value={HYSAB_KYTAB_RECLASSIFY_RESOLUTION}>
													Import as {transfer.signedAmount >= 0 ? "Income" : "Expense"} (default)
												</option>
												{pendingSqlitePlan.accountChoices
													.filter((account) => account.id !== transfer.accountId)
													.map((account) => (
														<option key={account.id} value={account.id}>
															{account.title}
															{account.fallback ? " (create archived fallback)" : ""}
															{account.isArchived && !account.fallback ? " (archived)" : ""}
														</option>
													))}
											</select>
										</label>
									</div>
								))}
							</div>

							<div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
								<Button
									onClick={() => void finishSqliteImportAsIncomeExpense()}
									disabled={importing}>
									{importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
									Import all as income/expense
								</Button>
								<Button onClick={() => void finishSqliteImportWithFallback()} disabled={importing}>
									{importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
									Assign all to fallback
								</Button>
								<Button
									variant="outline"
									onClick={() => void finishSqliteImportWithSelections()}
									disabled={importing}>
									Import with selected accounts
								</Button>
								<Button
									variant="ghost"
									onClick={() => setPendingSqlitePlan(null)}
									disabled={importing}>
									Cancel
								</Button>
							</div>
						</div>
					)}
				</DialogContent>
			</Dialog>

			{/* Import result dialog */}
			<Dialog open={!!result} onOpenChange={() => setResult(null)}>
				<DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
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
									...(result.budgets !== undefined
										? [{ label: "Budgets imported", value: result.budgets }]
										: []),
									...(result.unresolvedTransfersResolved
										? [
												{
													label: "Unresolved transfers resolved",
													value: result.unresolvedTransfersResolved,
												},
											]
										: []),
									...(result.unmatchedTransferAdjustments
										? [
												{
													label: "Unmatched transfers imported as adjustments",
													value: result.unmatchedTransferAdjustments,
												},
											]
										: []),
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
								Re-importing the same file is safe — database imports merge by source ID.
							</p>
							{result.verification && (
								<div className="space-y-2 rounded-lg border border-border p-3 text-sm">
									<div className="flex items-center gap-2 font-medium">
										{result.verification.passed ? (
											<CheckCircle2 className="h-4 w-4 text-emerald-600" />
										) : (
											<AlertTriangle className="h-4 w-4 text-destructive" />
										)}
										Verification {result.verification.passed ? "passed" : "needs review"}
									</div>
									<div className="space-y-1">
										{result.verification.checks.map((check) => (
											<div key={check.label} className="flex justify-between gap-3 text-xs">
												<span className="text-muted-foreground">{check.label}</span>
												<span className={check.passed ? "text-emerald-700" : "text-destructive"}>
													{formatMoney(check.actual)} / {formatMoney(check.expected)}
												</span>
											</div>
										))}
									</div>
									{result.verification.sourceTransferLegNet !== 0 ? (
										<p className="text-xs text-amber-600 dark:text-amber-400">
											Source transfer legs net to{" "}
											{formatMoney(result.verification.sourceTransferLegNet)} because{" "}
											{result.verification.sourceTransferAnomalies.length} leg
											{result.verification.sourceTransferAnomalies.length === 1 ? "" : "s"} had no
											counterpart. The imported transfers now net to{" "}
											{formatMoney(result.verification.importedTransferNet)} after your resolution.
										</p>
									) : null}
									{result.verification.reclassificationSummary ? (
										<p className="text-xs text-amber-600 dark:text-amber-400">
											{result.verification.reclassificationSummary}
										</p>
									) : null}
									{result.verification.expectedNetWorthDifferenceReason ? (
										<p className="text-xs text-amber-600 dark:text-amber-400">
											{result.verification.expectedNetWorthDifferenceReason}
										</p>
									) : null}
								</div>
							)}
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
