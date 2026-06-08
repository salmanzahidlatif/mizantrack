"use client";

import { formatDistanceToNow } from "date-fns";
import { AlertCircle, CheckCircle2, Cloud, Loader2 } from "lucide-react";

import { useSyncStore } from "@/store/sync-store";

export function SyncStatusBadge() {
	const { syncing, lastSync, error, syncProgress, lastSyncResult } = useSyncStore();

	if (syncing) {
		const pushed = syncProgress?.totalPushed ?? 0;
		const pulled = syncProgress?.totalPulled ?? 0;
		const total = pushed + pulled;
		const label =
			total > 0
				? `Syncing… ↑${pushed} ↓${pulled}`
				: "Syncing…";
		return (
			<div className="flex items-center gap-1.5 text-muted-foreground" title={label}>
				<Loader2 className="h-4 w-4 animate-spin" />
				{total > 0 && (
					<span className="hidden text-xs sm:inline">{label}</span>
				)}
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex items-center gap-1 text-destructive" title={`Sync error: ${error}`}>
				<AlertCircle className="h-4 w-4" />
			</div>
		);
	}

	if (lastSync) {
		const timeLabel = formatDistanceToNow(new Date(lastSync), { addSuffix: true });
		const pushed = lastSyncResult?.totalPushed ?? 0;
		const pulled = lastSyncResult?.totalPulled ?? 0;
		const countLabel =
			pushed + pulled > 0
				? ` — ↑${pushed} pushed, ↓${pulled} pulled`
				: " — nothing to sync";
		const title = `Last synced ${timeLabel}${countLabel}`;

		return (
			<div className="flex items-center gap-1.5 text-emerald-500" title={title}>
				<CheckCircle2 className="h-4 w-4" />
				{pushed + pulled > 0 && (
					<span className="hidden text-xs sm:inline">
						↑{pushed} ↓{pulled}
					</span>
				)}
			</div>
		);
	}

	return (
		<div className="flex items-center gap-1 text-muted-foreground/40" title="Sync not configured">
			<Cloud className="h-4 w-4" />
		</div>
	);
}
