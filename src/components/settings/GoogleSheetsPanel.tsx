"use client";

import { formatDistanceToNow } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { GoogleSheetsSetupGuide } from "@/components/settings/GoogleSheetsSetupGuide";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { useDbConfig } from "@/hooks/useDbConfig";
import { connectGoogleSheetsAction } from "@/lib/actions/googleSheets";
import { backupGoogleSheetsCurrencies } from "@/lib/sheets/backup";
import { getGoogleSheetsErrorMessage } from "@/lib/sheets/errors";
import { listSheetsCurrencyStates, putSheetsCurrencyState } from "@/lib/sheets/metadata";

import type { GoogleSheetsBackupProgress, GoogleSheetsBackupStatus } from "@/types";

interface GoogleSheetsPanelProps {
	userId: string;
}

function formatLastBackup(timestamp?: number): string {
	if (!timestamp) return "Never backed up";
	return `Last backed up ${formatDistanceToNow(timestamp, { addSuffix: true })}`;
}

export function GoogleSheetsPanel({ userId }: GoogleSheetsPanelProps) {
	const config = useDbConfig(userId);
	const [status, setStatus] = useState<GoogleSheetsBackupStatus | null>(null);
	const [loadingStatus, setLoadingStatus] = useState(true);
	const [backingUp, setBackingUp] = useState(false);
	const [guideOpen, setGuideOpen] = useState(false);
	const [progress, setProgress] = useState<GoogleSheetsBackupProgress | null>(null);
	const [isPending, startTransition] = useTransition();
	const states = useLiveQuery(() => listSheetsCurrencyStates(), [], []);

	const currencies = useMemo(() => {
		const configured = config?.enabledCurrencies?.length
			? config.enabledCurrencies
			: [config?.currency ?? "PKR"];
		return [
			...new Set(configured.map((currency) => currency.trim().toUpperCase()).filter(Boolean)),
		];
	}, [config]);

	const selectedCurrencies = currencies.filter((currency) => {
		const state = states.find((item) => item.currency === currency);
		return state?.selected ?? true;
	});

	async function refreshStatus() {
		setLoadingStatus(true);
		try {
			const response = await fetch("/api/google-sheets/status", { cache: "no-store" });
			if (!response.ok) throw new Error("Unable to load Google Sheets status.");
			setStatus((await response.json()) as GoogleSheetsBackupStatus);
		} catch {
			setStatus({ connected: false, needsReconnect: false, states: [] });
		} finally {
			setLoadingStatus(false);
		}
	}

	useEffect(() => {
		void refreshStatus();
	}, []);

	async function toggleCurrency(currency: string, selected: boolean) {
		await putSheetsCurrencyState(currency, { selected });
	}

	async function handleBackupNow() {
		if (selectedCurrencies.length === 0) {
			toast.error("Choose at least one currency to back up.");
			return;
		}
		setBackingUp(true);
		setProgress(null);
		try {
			const results = await backupGoogleSheetsCurrencies(userId, selectedCurrencies, setProgress);
			toast.success(`Backed up ${results.length} Google Sheets spreadsheet(s).`);
			await refreshStatus();
		} catch (error) {
			toast.error(getGoogleSheetsErrorMessage(error));
		} finally {
			setBackingUp(false);
			setProgress(null);
		}
	}

	async function handleDisconnect() {
		try {
			await fetch("/api/google-sheets/disconnect", { method: "POST" });
			toast.success("Google Sheets disconnected.");
			await refreshStatus();
		} catch {
			toast.error("Failed to disconnect Google Sheets.");
		}
	}

	const connected = status?.connected ?? false;
	const needsReconnect = status?.needsReconnect ?? false;
	const offline = typeof navigator !== "undefined" && navigator.onLine === false;
	const progressPercent = progress
		? Math.round((progress.rowsWritten / progress.totalRows) * 100)
		: 0;

	return (
		<div className="space-y-4 rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<h2 className="font-semibold">Google Sheets Backup</h2>
					<p className="text-sm text-muted-foreground">
						One-way backup to one spreadsheet per currency in your Google Drive.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button variant="outline" size="sm" onClick={() => setGuideOpen(true)}>
						Setup Guide
					</Button>
					{connected && (
						<Button variant="outline" size="sm" onClick={() => void handleDisconnect()}>
							Disconnect
						</Button>
					)}
					<Button
						size="sm"
						disabled={isPending || loadingStatus}
						onClick={() => startTransition(() => void connectGoogleSheetsAction())}>
						{isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
						{connected && !needsReconnect ? "Reconnect" : "Connect"}
					</Button>
				</div>
			</div>

			{needsReconnect && (
				<div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
					<AlertCircle className="mt-0.5 h-4 w-4" />
					<span>Your Google connection expired or was revoked. Reconnect before backing up.</span>
				</div>
			)}

			<div className="space-y-2 text-sm text-muted-foreground">
				<p>
					MizanTrack requests only Drive file access. Your financial data goes directly from this
					browser to Google Sheets; the server only brokers a short-lived Google access token.
				</p>
				<p>The spreadsheet is not encrypted. Anyone you share it with can read its contents.</p>
			</div>

			<div className="space-y-2">
				<Label>Currencies</Label>
				<div className="grid gap-2 sm:grid-cols-2">
					{currencies.map((currency) => {
						const state = states.find((item) => item.currency === currency);
						return (
							<div key={currency} className="rounded-lg border border-border/60 p-3">
								<div className="flex items-center justify-between gap-3">
									<div>
										<div className="font-medium">{currency}</div>
										<div className="text-xs text-muted-foreground">
											{formatLastBackup(state?.lastBackupAt)}
										</div>
									</div>
									<Switch
										checked={state?.selected ?? true}
										onCheckedChange={(checked) => void toggleCurrency(currency, checked)}
										aria-label={`Back up ${currency}`}
									/>
								</div>
								{state?.spreadsheetUrl && (
									<a
										href={state.spreadsheetUrl}
										target="_blank"
										rel="noreferrer"
										className="mt-2 inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline">
										Open sheet <ExternalLink className="h-3 w-3" />
									</a>
								)}
								{state?.lastStatus === "failed" && state.lastError && (
									<p className="mt-2 text-xs text-destructive">{state.lastError}</p>
								)}
								{state?.lastStatus === "success" && (
									<p className="mt-2 inline-flex items-center gap-1 text-xs text-emerald-600">
										<CheckCircle2 className="h-3 w-3" /> Complete
									</p>
								)}
							</div>
						);
					})}
				</div>
			</div>

			{progress && (
				<div className="space-y-1">
					<Progress value={progressPercent} />
					<p className="text-xs text-muted-foreground">
						Writing {progress.currency} · {progress.tab} · {progress.rowsWritten} /{" "}
						{progress.totalRows}
					</p>
				</div>
			)}

			<div className="flex flex-wrap items-center gap-2">
				<Button
					onClick={() => void handleBackupNow()}
					disabled={
						!connected || needsReconnect || backingUp || offline || selectedCurrencies.length === 0
					}>
					{backingUp ? (
						<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
					) : (
						<RefreshCw className="mr-1.5 h-3.5 w-3.5" />
					)}
					Back up now
				</Button>
				{offline && <span className="text-sm text-muted-foreground">You're offline.</span>}
				{!connected && !loadingStatus && (
					<span className="text-sm text-muted-foreground">Connect Google Sheets first.</span>
				)}
			</div>
			<GoogleSheetsSetupGuide open={guideOpen} onOpenChange={setGuideOpen} />
		</div>
	);
}
