"use client";

import { formatDistanceToNow } from "date-fns";
import { AlertCircle, CheckCircle2, Cloud, Loader2 } from "lucide-react";

import { useSyncStore } from "@/store/sync-store";

export function SyncStatusBadge() {
	const { syncing, lastSync, error } = useSyncStore();

	if (syncing) {
		return (
			<div className="flex items-center gap-1 text-muted-foreground" title="Syncing…">
				<Loader2 className="h-4 w-4 animate-spin" />
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
		const label = formatDistanceToNow(new Date(lastSync), { addSuffix: true });
		return (
			<div
				className="flex items-center gap-1 text-emerald-500"
				title={`Last synced ${label}`}>
				<CheckCircle2 className="h-4 w-4" />
			</div>
		);
	}

	return (
		<div className="flex items-center gap-1 text-muted-foreground/40" title="Sync not configured">
			<Cloud className="h-4 w-4" />
		</div>
	);
}
