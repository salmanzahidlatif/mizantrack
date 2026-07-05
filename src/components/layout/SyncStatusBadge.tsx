"use client";

import { formatDistanceToNow } from "date-fns";
import { AlertCircle, Check, Cloud, CloudOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { useSyncStore } from "@/store/sync-store";

type SyncBadgeState = "idle" | "syncing" | "success" | "error";

export function SyncStatusBadge() {
	const { syncing, lastSync, error, syncProgress, lastSyncResult } = useSyncStore();
	const [badgeState, setBadgeState] = useState<SyncBadgeState>("idle");

	useEffect(() => {
		let t: ReturnType<typeof setTimeout> | undefined;
		if (syncing) {
			setBadgeState("syncing");
		} else if (error) {
			setBadgeState("error");
			t = setTimeout(() => setBadgeState("idle"), 4000);
		} else if (lastSync) {
			setBadgeState("success");
			t = setTimeout(() => setBadgeState("idle"), 2000);
		} else {
			setBadgeState("idle");
		}
		return () => { if (t) clearTimeout(t); };
	}, [syncing, error, lastSync]);

	if (badgeState === "syncing") {
		const pushed = syncProgress?.totalPushed ?? 0;
		const pulled = syncProgress?.totalPulled ?? 0;
		const total = pushed + pulled;
		const label = total > 0 ? `Syncing… ↑${pushed} ↓${pulled}` : "Syncing…";
		return (
			<div className="flex items-center gap-1.5 text-muted-foreground" title={label}>
				<Loader2 className="h-4 w-4 animate-spin" />
				{total > 0 && <span className="hidden text-xs sm:inline">{label}</span>}
			</div>
		);
	}

	if (badgeState === "error") {
		return (
			<div className="flex items-center gap-1 text-destructive" title={`Sync error: ${error ?? ""}`}>
				<CloudOff className="h-4 w-4" />
			</div>
		);
	}

	if (badgeState === "success") {
		const pushed = lastSyncResult?.totalPushed ?? 0;
		const pulled = lastSyncResult?.totalPulled ?? 0;
		return (
			<div className="flex items-center gap-1.5 text-emerald-500" title="Synced">
				<Check className="h-4 w-4" />
				{pushed + pulled > 0 && (
					<span className="hidden text-xs sm:inline">↑{pushed} ↓{pulled}</span>
				)}
			</div>
		);
	}

	// idle
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
		const countLabel = pushed + pulled > 0 ? ` — ↑${pushed} pushed, ↓${pulled} pulled` : "";
		return (
			<div className="flex items-center gap-1.5 text-muted-foreground/60" title={`Last synced ${timeLabel}${countLabel}`}>
				<Cloud className="h-4 w-4" />
			</div>
		);
	}

	return (
		<div className="flex items-center gap-1 text-muted-foreground/40" title="Sync not configured">
			<Cloud className="h-4 w-4" />
		</div>
	);
}
