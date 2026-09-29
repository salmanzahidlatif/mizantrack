"use client";

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
import { useDbConfig } from "@/hooks/useDbConfig";
import { resetLocalFinancialData } from "@/lib/db/reset";

interface ResetLocalDataPanelProps {
	userId: string;
}

const CONFIRM_PHRASE = "RESET";

export function ResetLocalDataPanel({ userId }: ResetLocalDataPanelProps) {
	const config = useDbConfig(userId);
	const syncEnabled = config?.enabled ?? false;

	const [open, setOpen] = useState(false);
	const [confirmText, setConfirmText] = useState("");
	const [resetting, setResetting] = useState(false);

	function handleOpen() {
		setConfirmText("");
		setOpen(true);
	}

	async function handleReset() {
		setResetting(true);
		try {
			const result = await resetLocalFinancialData(userId);
			setOpen(false);
			toast.success(
				`Reset complete — removed ${result.accountsDeleted} accounts, ${result.categoriesDeleted} categories, and ${result.transactionsDeleted} transactions. ${result.categoriesReseeded} default categories restored.`
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
					Wipes all accounts, categories, and transactions from this device and restores the default
					category list — like a fresh install. Useful on mobile/PWA where clearing browser cache
					isn&apos;t easy.
				</p>
			</div>

			<Button
				variant="outline"
				className="text-destructive hover:text-destructive"
				onClick={handleOpen}>
				<Trash2 className="mr-2 h-4 w-4" />
				Reset Local Data
			</Button>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-sm">
					<DialogHeader>
						<DialogTitle>Reset local data?</DialogTitle>
						<DialogDescription>
							This permanently deletes all accounts, categories, and transactions stored on this
							device, then restores the default category list. Your app settings and Zakat data are
							not affected.{" "}
							{syncEnabled
								? "Since Cloud Sync is enabled, your data will be re-downloaded from Firebase on the next sync."
								: "Cloud Sync is off, so this data cannot be recovered afterwards."}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-1.5 py-1">
						<p className="text-xs text-muted-foreground">
							Type <span className="font-mono font-semibold">{CONFIRM_PHRASE}</span> to confirm.
						</p>
						<Input
							value={confirmText}
							onChange={(e) => setConfirmText(e.target.value)}
							placeholder={CONFIRM_PHRASE}
							autoFocus
						/>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setOpen(false)} disabled={resetting}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							disabled={confirmText !== CONFIRM_PHRASE || resetting}
							onClick={() => {
								void handleReset();
							}}>
							{resetting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
							Reset Everything
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
