"use client";

import { formatDistanceToNow } from "date-fns";
import { AlertCircle, CheckCircle2, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SyncSetupWizard } from "@/components/settings/SyncSetupWizard";
import { SyncValidationFeedback } from "@/components/settings/SyncValidationFeedback";
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
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useDbConfig } from "@/hooks/useDbConfig";
import { upsertDbConfig } from "@/lib/db/dbConfig";
import { resetFirestoreForUser } from "@/lib/db/firebase";
import { clearFirestoreForUser, getFirestoreUsage, getSyncBackupCounts } from "@/lib/db/sync";
import { parseFirebaseConfigJson } from "@/lib/firebaseConfigParser";
import { useSyncStore } from "@/store/sync-store";

import type { SyncBackupCounts } from "@/lib/db/sync";
import type { ParseFirebaseConfigResult } from "@/lib/firebaseConfigParser";

interface FirebaseSyncPanelProps {
	userId: string;
}

const backupTableLabels: Record<string, string> = {
	accounts: "Accounts",
	categories: "Categories",
	transactions: "Transactions",
	budgets: "Budgets",
	goldItems: "Gold items",
	zakatCalculations: "Zakat calculations",
	zakatPayments: "Zakat payments",
};

const backupCountFormatter = new Intl.NumberFormat();

function getBackupTableLabel(table: string): string {
	return backupTableLabels[table] ?? table;
}

function formatBackupCount(value: number): string {
	return backupCountFormatter.format(value);
}

function getBackupTableStatus(count: SyncBackupCounts["tables"][number]): {
	label: string;
	summary: string;
	detail: string;
	tone: "good" | "pending" | "review";
} {
	const pendingExplainsGap = count.pending > 0 && count.remote + count.pending === count.local;

	if (count.remote === count.local && count.pending === 0) {
		return {
			label: "Nothing missing",
			summary: `Firebase ${formatBackupCount(count.remote)} total · Local ${formatBackupCount(
				count.local
			)} total`,
			detail:
				count.localDeleted > 0
					? "Deleted markers keep merges/deletes synced; they are counted in the total."
					: "Firebase and local totals match.",
			tone: "good",
		};
	}

	if (pendingExplainsGap) {
		return {
			label: "Nothing missing",
			summary: `Firebase ${formatBackupCount(count.remote)} backed up · ${formatBackupCount(
				count.pending
			)} waiting · Local ${formatBackupCount(count.local)} total`,
			detail:
				count.pending === count.local
					? `All ${formatBackupCount(count.pending)} local rows are waiting to upload.`
					: `${formatBackupCount(
							count.pending
						)} local rows are waiting to upload; that explains the count difference.`,
			tone: "good",
		};
	}

	if (count.pending > 0) {
		return {
			label: "Pending changes",
			summary: `Firebase ${formatBackupCount(count.remote)} total · Local ${formatBackupCount(
				count.local
			)} total · ${formatBackupCount(count.pending)} pending`,
			detail: "Some local rows have unsynced changes; totals may differ until sync completes.",
			tone: "pending",
		};
	}

	return {
		label: "Review counts",
		summary: `Firebase ${formatBackupCount(count.remote)} total · Local ${formatBackupCount(
			count.local
		)} total`,
		detail:
			"Counts still differ after including deleted markers. Run sync again when Firebase is available.",
		tone: "review",
	};
}

function getBackupStatusBadgeClass(tone: ReturnType<typeof getBackupTableStatus>["tone"]): string {
	if (tone === "pending") {
		return "shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400";
	}
	if (tone === "review") {
		return "shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-medium text-destructive";
	}
	return "shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400";
}

export function FirebaseSyncPanel({ userId }: FirebaseSyncPanelProps) {
	const config = useDbConfig(userId);
	const { syncing, lastSync, error, triggerSync } = useSyncStore();

	const [configJson, setConfigJson] = useState("");
	const [enabled, setEnabled] = useState(false);
	const [parseResult, setParseResult] = useState<ParseFirebaseConfigResult | null>(null);
	const [saving, setSaving] = useState(false);
	const [resetOpen, setResetOpen] = useState(false);
	const [clearDataOpen, setClearDataOpen] = useState(false);
	const [clearing, setClearing] = useState(false);
	const [clearProgress, setClearProgress] = useState(0);
	const [wizardOpen, setWizardOpen] = useState(false);
	const [wizardInitialStep, setWizardInitialStep] = useState<number | undefined>(undefined);
	const [usage, setUsage] = useState<{
		estimatedMB: string;
		freeLimitMB: number;
		percentUsed: string;
	} | null>(null);
	const [backupCounts, setBackupCounts] = useState<SyncBackupCounts | null>(null);
	const currencyPendingTotal =
		backupCounts?.currencyBreakdown.reduce((sum, currency) => sum + currency.pending, 0) ?? 0;

	// Sync local state with DB config
	useEffect(() => {
		if (!config) return;
		setConfigJson(config.firebaseConfig ?? "");
		setEnabled(config.enabled ?? false);
	}, [config]);

	// Load Firestore usage when enabled
	useEffect(() => {
		if (!enabled) return;
		void getFirestoreUsage(userId).then((u) => {
			if (u) setUsage(u);
		});
	}, [enabled, userId, lastSync]);

	// Load per-table backup counts (accounts/categories/transactions: backed up vs. pending)
	useEffect(() => {
		if (!enabled) {
			setBackupCounts(null);
			return;
		}
		void getSyncBackupCounts(userId).then((c) => setBackupCounts(c));
	}, [enabled, userId, lastSync, syncing]);

	async function handleSave() {
		if (!configJson.trim()) return;
		const result = parseFirebaseConfigJson(configJson);
		if (!result.valid) return;
		setSaving(true);
		try {
			await upsertDbConfig(userId, {
				firebaseConfig: configJson,
				enabled,
			});
			// Reset cached Firestore instance so new config is picked up
			await resetFirestoreForUser(userId);
			toast.success("Sync config saved.");
			// Connect immediately instead of leaving the user waiting until they
			// separately hit "Sync Now" — this is what actually makes Firebase
			// "just work" the moment a valid config is saved with sync enabled.
			if (enabled) {
				void triggerSync(userId);
			}
		} catch {
			toast.error("Failed to save config.");
		} finally {
			setSaving(false);
		}
	}

	async function handleReset() {
		await upsertDbConfig(userId, { firebaseConfig: "", enabled: false });
		await resetFirestoreForUser(userId);
		setConfigJson("");
		setEnabled(false);
		setUsage(null);
		setResetOpen(false);
		toast.success("Firebase config cleared.");
	}

	async function handleClearData() {
		setClearing(true);
		setClearProgress(0);
		try {
			const result = await clearFirestoreForUser(userId, (n) => setClearProgress(n));
			setClearDataOpen(false);
			toast.success(`Cleared ${result.deleted} documents from Firebase.`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to clear Firebase data.");
		} finally {
			setClearing(false);
			setClearProgress(0);
		}
	}

	return (
		<div className="space-y-4 rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
			<div className="flex items-center justify-between">
				<h2 className="font-semibold">Cloud Sync</h2>
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						className="text-xs"
						onClick={() => {
							setWizardInitialStep(0);
							setWizardOpen(true);
						}}>
						Get Setup Instructions
					</Button>
					<Label htmlFor="sync-enabled" className="text-sm">
						Enable Sync
					</Label>
					<Switch
						id="sync-enabled"
						checked={enabled}
						onCheckedChange={(v) => {
							setEnabled(v);
						}}
					/>
				</div>
			</div>

			{/* Firebase JSON config */}
			<div className="space-y-1.5">
				<Label htmlFor="firebase-json">Firebase Config (JSON)</Label>
				<Textarea
					id="firebase-json"
					value={configJson}
					onChange={(e) => {
						setConfigJson(e.target.value);
						setParseResult(e.target.value.trim() ? parseFirebaseConfigJson(e.target.value) : null);
					}}
					placeholder={`{\n  "apiKey": "...",\n  "authDomain": "...",\n  "projectId": "..."\n}`}
					className="font-mono text-xs"
					rows={6}
				/>
				{parseResult && !parseResult.valid && (
					<SyncValidationFeedback
						errors={parseResult.errors}
						onOpenWizardAtStep={(step) => {
							setWizardInitialStep(step);
							setWizardOpen(true);
						}}
					/>
				)}
			</div>

			<div className="flex gap-2">
				<Button
					onClick={() => {
						void handleSave();
					}}
					disabled={saving || (parseResult !== null && !parseResult.valid)}>
					{saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
					Save Config
				</Button>
				<Button
					variant="outline"
					onClick={() => {
						void triggerSync(userId);
					}}
					disabled={syncing || !enabled}>
					{syncing ? (
						<Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
					) : (
						<RefreshCw className="mr-1.5 h-3.5 w-3.5" />
					)}
					Sync Now
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="ml-auto text-destructive hover:text-destructive"
					onClick={() => setResetOpen(true)}>
					<Trash2 className="h-4 w-4" />
					<span className="sr-only">Reset config</span>
				</Button>
			</div>

			{/* Sync status */}
			<div className="space-y-1.5">
				<div className="flex items-center gap-1.5 text-sm">
					{error ? (
						<>
							<AlertCircle className="h-4 w-4 text-destructive" />
							<span className="text-destructive">{error}</span>
						</>
					) : lastSync ? (
						<>
							<CheckCircle2 className="h-4 w-4 text-emerald-500" />
							<span className="text-muted-foreground">
								Last synced {formatDistanceToNow(new Date(lastSync), { addSuffix: true })}
							</span>
						</>
					) : (
						<span className="text-muted-foreground">Never synced</span>
					)}
				</div>

				{/* Firestore usage */}
				{usage && (
					<div className="space-y-1">
						<div className="flex justify-between text-xs text-muted-foreground">
							<span>Firestore storage</span>
							<span>
								{usage.estimatedMB} MB / {usage.freeLimitMB} MB ({usage.percentUsed}%)
							</span>
						</div>
						<Progress value={parseFloat(usage.percentUsed)} className="h-1.5" />
					</div>
				)}

				{/* Per-table backup counts */}
				{backupCounts && (
					<div className="space-y-3 rounded-lg border border-border/60 bg-muted/30 p-2.5">
						<div className="space-y-1">
							<p className="text-xs font-medium text-muted-foreground">Backed up to Firebase</p>
							<p className="text-[11px] leading-snug text-muted-foreground">
								Table totals include active rows plus deleted sync markers, so Firebase and local
								are compared like-for-like. Remote counts are aggregate totals only; per-currency
								figures below stay active-local only because Firebase cannot split them cheaply.
							</p>
						</div>

						<div className="space-y-2">
							{backupCounts.tables.map((t) => {
								const status = getBackupTableStatus(t);

								return (
									<div
										key={t.table}
										aria-label={`${getBackupTableLabel(t.table)} backup status`}
										className="space-y-1 rounded-md border border-border/50 bg-background/70 p-2 text-xs">
										<div className="flex items-start justify-between gap-2">
											<span className="font-medium">{getBackupTableLabel(t.table)}</span>
											<span className={getBackupStatusBadgeClass(status.tone)}>{status.label}</span>
										</div>
										<p>{status.summary}</p>
										<p className="text-muted-foreground">
											{formatBackupCount(t.localActive)} active
											{t.localDeleted > 0
												? ` · ${formatBackupCount(t.localDeleted)} deleted`
												: " · 0 deleted"}
											{" · "}
											{formatBackupCount(t.local)} total
										</p>
										<p className="text-[11px] leading-snug text-muted-foreground">
											{status.detail}
										</p>
									</div>
								);
							})}
						</div>

						<div className="space-y-2 border-t border-border/60 pt-2">
							<div className="flex items-center justify-between gap-2 text-xs">
								<span className="font-medium text-muted-foreground">Pending by currency</span>
								<span className="text-muted-foreground">
									{currencyPendingTotal > 0
										? `${currencyPendingTotal} active pending`
										: "All backed up"}
								</span>
							</div>
							<div className="space-y-2">
								{backupCounts.currencyBreakdown.length === 0 ? (
									<p className="rounded-md border border-border/50 bg-background/70 p-2 text-xs text-emerald-700 dark:text-emerald-400">
										All active rows backed up — no local pending records by currency.
									</p>
								) : (
									backupCounts.currencyBreakdown.map((currency) => {
										const pendingTables = currency.tables.filter((table) => table.pending > 0);

										return (
											<div
												key={currency.key}
												className="space-y-1.5 rounded-md border border-border/50 bg-background/70 p-2">
												<div className="flex items-start justify-between gap-2">
													<div>
														<p className="text-xs font-medium">{currency.label}</p>
														<p className="text-[11px] text-muted-foreground">
															Local {currency.local} · Pending {currency.pending}
														</p>
													</div>
													<span
														className={
															currency.pending > 0
																? "shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400"
																: "shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400"
														}>
														{currency.pending > 0 ? `${currency.pending} pending` : "All backed up"}
													</span>
												</div>
												{pendingTables.length > 0 && (
													<div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
														{pendingTables.map((table) => (
															<div
																key={table.table}
																className="flex items-center justify-between rounded bg-muted/50 px-2 py-1 text-[11px]">
																<span className="text-muted-foreground">
																	{getBackupTableLabel(table.table)}
																</span>
																<span>
																	{table.pending} / {table.local} pending
																</span>
															</div>
														))}
													</div>
												)}
											</div>
										);
									})
								)}
							</div>
						</div>
					</div>
				)}
			</div>

			{/* Reset confirmation dialog */}
			<Dialog open={resetOpen} onOpenChange={setResetOpen}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>Clear Firebase Config?</DialogTitle>
						<DialogDescription>
							This will disconnect cloud sync. Your local data won&apos;t be affected.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={() => setResetOpen(false)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={() => {
								void handleReset();
							}}>
							Clear Config
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Clear Firebase data dialog */}
			<Dialog open={clearDataOpen} onOpenChange={setClearDataOpen}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>Delete All Firebase Data?</DialogTitle>
						<DialogDescription>
							This will permanently delete ALL your data from Firebase. Your local data is not
							affected. The next sync will re-upload everything.
						</DialogDescription>
					</DialogHeader>
					{clearing && (
						<p className="text-sm text-muted-foreground">Deleting… ({clearProgress} documents)</p>
					)}
					<DialogFooter>
						<Button variant="outline" onClick={() => setClearDataOpen(false)} disabled={clearing}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={() => void handleClearData()}
							disabled={clearing}>
							{clearing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
							Delete from Firebase
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Clear Firebase data button */}
			{enabled && (
				<div className="border-t border-border pt-3">
					<Button
						variant="outline"
						size="sm"
						className="text-destructive hover:text-destructive"
						onClick={() => setClearDataOpen(true)}>
						<Trash2 className="mr-1.5 h-3.5 w-3.5" />
						Clear All Firebase Data
					</Button>
					<p className="mt-1 text-xs text-muted-foreground">
						Removes all your data from Firebase without affecting local storage.
					</p>
				</div>
			)}

			<SyncSetupWizard
				open={wizardOpen}
				onOpenChange={setWizardOpen}
				initialStep={wizardInitialStep}
				onConfigPasted={(json) => {
					setConfigJson(json);
					setParseResult(parseFirebaseConfigJson(json));
					setEnabled(true);
				}}
			/>
		</div>
	);
}
