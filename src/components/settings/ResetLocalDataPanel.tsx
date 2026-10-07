"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useDbConfig } from "@/hooks/useDbConfig";
import { getCurrencyByCode } from "@/lib/currencies";
import {
	getResetLocalFinancialDataPreview,
	resetLocalFinancialData,
	resetLocalFinancialDataForCurrency,
	type ResetLocalDataPreview,
} from "@/lib/db/reset";

interface ResetLocalDataPanelProps {
	userId: string;
}

type ResetMode = "all" | "currency";

const FULL_CONFIRM_PHRASE = "RESET";

function formatCount(value: number): string {
	return new Intl.NumberFormat("en-US").format(value);
}

function formatCurrencyLabel(code: string): string {
	const entry = getCurrencyByCode(code);
	return `${entry?.flag ? `${entry.flag} ` : ""}${code}`;
}

function CountRow({ label, value }: { label: string; value: number }) {
	return (
		<div className="flex justify-between gap-3 px-3 py-2 text-sm">
			<span className="text-muted-foreground">{label}</span>
			<span className="font-medium">{formatCount(value)}</span>
		</div>
	);
}

function ResetPreviewSummary({
	preview,
	syncEnabled,
}: {
	preview: ResetLocalDataPreview;
	syncEnabled: boolean;
}) {
	const isCurrencyReset = preview.scope === "currency";

	return (
		<div className="space-y-3">
			<div className="divide-y divide-border rounded-lg border border-border">
				<CountRow label="Accounts removed" value={preview.accountsDeleted} />
				<CountRow label="Transactions removed" value={preview.transactionsDeleted} />
				<CountRow label="Categories removed" value={preview.categoriesDeleted} />
				<CountRow label="Budgets removed" value={preview.budgetsDeleted} />
				<CountRow label="Dashboard cache cleared" value={preview.dashboardStatsCleared} />
				{preview.categoriesReseeded > 0 ? (
					<CountRow label="Default categories restored" value={preview.categoriesReseeded} />
				) : null}
			</div>

			{isCurrencyReset ? (
				<div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
					<p>
						Kept: {formatCount(preview.sharedCategoriesKept)} shared/untagged categories,{" "}
						{formatCount(preview.otherCurrencyCategoriesKept)} categories tagged for other
						currencies, all Zakat records, app settings, and accounts whose currency is blank,
						unknown, or not enabled.
					</p>
					{preview.budgetsDeleted > 0 ? (
						<p>
							Budgets removed: {formatCount(preview.budgetsDeletedByExplicitCurrency)} with explicit{" "}
							{preview.currency} currency and{" "}
							{formatCount(preview.budgetsDeletedByCategoryCurrency)} derived from{" "}
							{preview.currency}-tagged categories.
						</p>
					) : null}
					{preview.transactionsDeletedCrossCurrencyTransfers > 0 ? (
						<p className="text-amber-700 dark:text-amber-300">
							{formatCount(preview.transactionsDeletedCrossCurrencyTransfers)} cross-currency
							transfer record
							{preview.transactionsDeletedCrossCurrencyTransfers === 1 ? "" : "s"} will be removed
							locally because one leg belongs to {preview.currency}. Keeping it would leave a
							transaction pointing at a removed account.
						</p>
					) : null}
					{preview.accountsKeptBlankCurrency +
						preview.accountsKeptUnknownCurrency +
						preview.accountsKeptNonEnabledCurrency >
					0 ? (
						<p>
							Safety hold: kept {formatCount(preview.accountsKeptBlankCurrency)} blank-currency,{" "}
							{formatCount(preview.accountsKeptUnknownCurrency)} unknown-currency, and{" "}
							{formatCount(preview.accountsKeptNonEnabledCurrency)} non-enabled-currency accounts.
						</p>
					) : null}
				</div>
			) : null}

			<p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
				This affects local IndexedDB only.{" "}
				{syncEnabled
					? "Sync cursors are reset so remote records are re-downloaded on the next sync; no deletedAt tombstones are created or pushed."
					: "Cloud Sync is off, so records that exist only on this device cannot be recovered afterwards."}
			</p>
		</div>
	);
}

export function ResetLocalDataPanel({ userId }: ResetLocalDataPanelProps) {
	const config = useDbConfig(userId);
	const syncEnabled = config?.enabled ?? false;
	const enabledCurrencies =
		config?.enabledCurrencies && config.enabledCurrencies.length > 0
			? config.enabledCurrencies
			: config?.currency
				? [config.currency]
				: [];

	const [open, setOpen] = useState(false);
	const [mode, setMode] = useState<ResetMode>("all");
	const [selectedCurrency, setSelectedCurrency] = useState("");
	const [confirmText, setConfirmText] = useState("");
	const [resetting, setResetting] = useState(false);

	const preview = useLiveQuery(() => {
		if (!open) return Promise.resolve(null);
		if (mode === "all") {
			return getResetLocalFinancialDataPreview(userId, { type: "all" });
		}
		if (!selectedCurrency) return Promise.resolve(null);
		return getResetLocalFinancialDataPreview(userId, {
			type: "currency",
			currency: selectedCurrency,
			enabledCurrencies,
		});
	}, [open, mode, selectedCurrency, enabledCurrencies.join(","), userId]);

	const confirmPhrase =
		mode === "currency" && selectedCurrency ? `RESET ${selectedCurrency}` : FULL_CONFIRM_PHRASE;
	const canReset = Boolean(preview) && confirmText === confirmPhrase && !resetting;

	function openFullReset() {
		setMode("all");
		setSelectedCurrency("");
		setConfirmText("");
		setOpen(true);
	}

	function openCurrencyReset() {
		setMode("currency");
		setSelectedCurrency("");
		setConfirmText("");
		setOpen(true);
	}

	async function handleReset() {
		setResetting(true);
		try {
			const result =
				mode === "currency"
					? await resetLocalFinancialDataForCurrency(userId, selectedCurrency, enabledCurrencies)
					: await resetLocalFinancialData(userId);
			setOpen(false);
			toast.success(
				`Reset complete — removed ${formatCount(result.accountsDeleted)} accounts, ${formatCount(
					result.categoriesDeleted
				)} categories, ${formatCount(result.budgetsDeleted)} budgets, and ${formatCount(
					result.transactionsDeleted
				)} transactions.`
			);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to reset local data.");
		} finally {
			setResetting(false);
		}
	}

	return (
		<div className="space-y-3 rounded-xl border border-destructive/30 bg-card p-4 shadow-[var(--shadow-card)]">
			<div>
				<h2 className="font-semibold text-destructive">Reset Local Data</h2>
				<p className="mt-0.5 text-sm text-muted-foreground">
					Wipes local cached financial data from this device and resets sync cursors so Firebase can
					re-download it. Use the scoped option to clear one enabled currency without touching the
					others.
				</p>
			</div>

			<div className="flex flex-wrap gap-2">
				<Button
					variant="outline"
					className="text-destructive hover:text-destructive"
					onClick={openCurrencyReset}
					disabled={enabledCurrencies.length === 0}>
					<Trash2 className="mr-2 h-4 w-4" />
					Reset One Currency
				</Button>
				<Button
					variant="outline"
					className="text-destructive hover:text-destructive"
					onClick={openFullReset}>
					<Trash2 className="mr-2 h-4 w-4" />
					Reset Everything
				</Button>
			</div>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle>
							{mode === "currency"
								? selectedCurrency
									? `Reset ${selectedCurrency} local data?`
									: "Choose a currency to reset"
								: "Reset all local data?"}
						</DialogTitle>
						<DialogDescription>
							{mode === "currency"
								? "This is a scoped local reset. It does not preselect a currency and will not run until you choose one and type the exact confirmation phrase."
								: "This permanently removes all local accounts, categories, budgets, and transactions from this device, then restores the default category list."}
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-3 py-1">
						{mode === "currency" ? (
							<div className="space-y-1.5">
								<p className="text-xs font-medium">Currency to clear</p>
								<Select
									value={selectedCurrency}
									onValueChange={(value) => {
										setSelectedCurrency(value);
										setConfirmText("");
									}}>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Select a currency…" />
									</SelectTrigger>
									<SelectContent>
										{enabledCurrencies.map((code) => (
											<SelectItem key={code} value={code}>
												{formatCurrencyLabel(code)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						) : null}

						{preview === undefined ? (
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
								Counting local records…
							</div>
						) : preview ? (
							<ResetPreviewSummary preview={preview} syncEnabled={syncEnabled} />
						) : (
							<p className="text-sm text-muted-foreground">
								Select a currency to see exactly what will be removed and kept.
							</p>
						)}

						<div className="space-y-1.5">
							<p className="text-xs text-muted-foreground">
								Type <span className="font-mono font-semibold">{confirmPhrase}</span> to confirm.
							</p>
							<Input
								value={confirmText}
								onChange={(e) => setConfirmText(e.target.value)}
								placeholder={confirmPhrase}
								autoFocus={mode === "all"}
								disabled={!preview}
							/>
						</div>
					</div>

					<DialogFooter>
						<Button variant="outline" onClick={() => setOpen(false)} disabled={resetting}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							disabled={!canReset}
							onClick={() => {
								void handleReset();
							}}>
							{resetting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
							{mode === "currency" && selectedCurrency
								? `Reset ${selectedCurrency} Locally`
								: "Reset Everything"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
