"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	getTransferIntegrityReport,
	repairInvalidTransferRecords,
} from "@/lib/import/transferIntegrity";

interface TransferIntegrityPanelProps {
	userId: string;
}

function formatMoney(value: number, currency: string): string {
	return `${currency} ${new Intl.NumberFormat("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	}).format(value)}`;
}

export function TransferIntegrityPanel({ userId }: TransferIntegrityPanelProps) {
	const report = useLiveQuery(() => getTransferIntegrityReport(userId), [userId]);
	const [confirming, setConfirming] = useState(false);
	const [repairing, setRepairing] = useState(false);
	const hasInvalidTransfers = (report?.invalidTransferCount ?? 0) > 0;

	async function handleRepair() {
		if (!confirming) {
			setConfirming(true);
			return;
		}

		setRepairing(true);
		try {
			const result = await repairInvalidTransferRecords(userId);
			toast.success(`Repaired ${result.repaired} invalid transfer records.`);
			setConfirming(false);
		} catch {
			toast.error("Failed to repair invalid transfer records.");
		} finally {
			setRepairing(false);
		}
	}

	return (
		<div className="space-y-3 rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
			<div className="flex items-start justify-between gap-3">
				<div className="space-y-1">
					<div className="flex items-center gap-2">
						{hasInvalidTransfers ? (
							<AlertTriangle className="h-4 w-4 text-amber-600" />
						) : (
							<ShieldCheck className="h-4 w-4 text-emerald-600" />
						)}
						<h2 className="font-semibold">Transfer Integrity Check</h2>
					</div>
					<p className="text-sm text-muted-foreground">
						Finds legacy imported transfers that have no usable destination account, so they cannot
						silently reduce a balance.
					</p>
				</div>
				{report === undefined ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
			</div>

			{report && !hasInvalidTransfers ? (
				<p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
					No one-sided transfer records were found in your local data.
				</p>
			) : null}

			{report && hasInvalidTransfers ? (
				<div className="space-y-3">
					<div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100">
						Found <span className="font-semibold">{report.invalidTransferCount}</span> invalid
						transfer records totaling{" "}
						<span className="font-semibold">
							{new Intl.NumberFormat("en-US", {
								minimumFractionDigits: 2,
								maximumFractionDigits: 2,
							}).format(report.totalInvalidValue)}
						</span>
						. Balance calculations now ignore these invalid records; repairing will soft-delete them
						after your confirmation.
					</div>

					<div className="divide-y divide-border rounded-lg border border-border text-sm">
						{report.accounts.map((account) => (
							<div key={account.accountId} className="space-y-1 px-3 py-2">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<span className="font-medium">{account.title}</span>
									<span className="text-muted-foreground">
										{account.count} record{account.count === 1 ? "" : "s"} ·{" "}
										{formatMoney(account.total, account.currency)}
									</span>
								</div>
								<p className="text-xs text-muted-foreground">
									Old leaky balance: {formatMoney(account.legacyBalance, account.currency)} · after
									correction: {formatMoney(account.correctedBalance, account.currency)}
								</p>
							</div>
						))}
					</div>

					{report.openingBalanceWarnings.map((warning) => (
						<p
							key={warning.accountId}
							className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
							Possible manual workaround detected: {warning.title} has an opening balance of{" "}
							{formatMoney(warning.openingBalance, warning.currency)}, close to its invalid transfer
							total of {formatMoney(warning.invalidTransferTotal, warning.currency)}. If that was
							added only to compensate for this bug, remove it after repair.
						</p>
					))}

					<div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
						<Button
							variant={confirming ? "destructive" : "outline"}
							onClick={() => void handleRepair()}
							disabled={repairing}>
							{repairing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
							{confirming ? "Confirm Repair" : "Repair Invalid Transfers"}
						</Button>
						{confirming ? (
							<Button variant="ghost" onClick={() => setConfirming(false)} disabled={repairing}>
								Cancel
							</Button>
						) : null}
						<p className="text-xs text-muted-foreground">
							This is read-only until you press repair and then confirm. Soft-deleted records remain
							in local history but no longer affect balances.
						</p>
					</div>
				</div>
			) : null}
		</div>
	);
}
