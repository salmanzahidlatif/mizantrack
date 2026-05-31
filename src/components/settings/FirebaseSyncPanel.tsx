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
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useDbConfig } from "@/hooks/useDbConfig";
import { resetFirestoreForUser } from "@/lib/db/firebase";
import { db } from "@/lib/db/local";
import { getFirestoreUsage } from "@/lib/db/sync";
import { parseFirebaseConfigJson } from "@/lib/firebaseConfigParser";
import { useSyncStore } from "@/store/sync-store";

import type { ParseFirebaseConfigResult } from "@/lib/firebaseConfigParser";

interface FirebaseSyncPanelProps {
	userId: string;
}

export function FirebaseSyncPanel({ userId }: FirebaseSyncPanelProps) {
	const config = useDbConfig(userId);
	const { syncing, lastSync, error, triggerSync } = useSyncStore();

	const [configJson, setConfigJson] = useState("");
	const [enabled, setEnabled] = useState(false);
	const [parseResult, setParseResult] = useState<ParseFirebaseConfigResult | null>(null);
	const [saving, setSaving] = useState(false);
	const [resetOpen, setResetOpen] = useState(false);
	const [wizardOpen, setWizardOpen] = useState(false);
	const [wizardInitialStep, setWizardInitialStep] = useState<number | undefined>(undefined);
	const [usage, setUsage] = useState<{
		estimatedMB: string;
		freeLimitMB: number;
		percentUsed: string;
	} | null>(null);

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

	async function handleSave() {
		if (!configJson.trim()) return;
		const result = parseFirebaseConfigJson(configJson);
		if (!result.valid) return;
		setSaving(true);
		try {
			await db.dbConfig.update(userId, {
				firebaseConfig: configJson,
				enabled,
			});
			// Reset cached Firestore instance so new config is picked up
			await resetFirestoreForUser(userId);
			toast.success("Sync config saved.");
		} catch {
			toast.error("Failed to save config.");
		} finally {
			setSaving(false);
		}
	}

	async function handleReset() {
		await db.dbConfig.update(userId, { firebaseConfig: "", enabled: false });
		await resetFirestoreForUser(userId);
		setConfigJson("");
		setEnabled(false);
		setUsage(null);
		setResetOpen(false);
		toast.success("Firebase config cleared.");
	}

	return (
		<div className="space-y-4 rounded-xl border border-border bg-card p-4">
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
			</div>

			{/* Reset confirmation dialog */}
			<Dialog open={resetOpen} onOpenChange={setResetOpen}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>Clear Firebase Config?</DialogTitle>
					</DialogHeader>
					<p className="text-sm text-muted-foreground">
						This will disconnect cloud sync. Your local data won&apos;t be affected.
					</p>
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
