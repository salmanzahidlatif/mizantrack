"use client";

import { formatDistanceToNow } from "date-fns";
import { AlertCircle, Check, Cloud, CloudOff, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
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
		return () => {
			if (t) clearTimeout(t);
		};
	}, [syncing, error, lastSync]);

	let title = "Sync not configured";
	let text: string | undefined;
	let tone = "text-muted-foreground/40";
	let surface = "border-transparent bg-transparent";
	let icon = <Cloud className="h-4 w-4" />;

	if (badgeState === "syncing") {
		const pushed = syncProgress?.totalPushed ?? 0;
		const pulled = syncProgress?.totalPulled ?? 0;
		const total = pushed + pulled;

		title = total > 0 ? `Syncing… ↑${pushed} ↓${pulled}` : "Syncing…";
		text = total > 0 ? `↑${pushed} ↓${pulled}` : "Syncing";
		tone = "text-primary";
		surface = "border-primary/15 bg-primary/10 pulse-soft";
		icon = <Loader2 className="h-4 w-4 animate-spin" />;
	} else if (badgeState === "error") {
		title = `Sync error: ${error ?? ""}`;
		tone = "text-destructive";
		surface = "border-destructive/15 bg-destructive/10";
		icon = <CloudOff className="h-4 w-4" />;
	} else if (badgeState === "success") {
		const pushed = lastSyncResult?.totalPushed ?? 0;
		const pulled = lastSyncResult?.totalPulled ?? 0;

		title = "Synced";
		text = pushed + pulled > 0 ? `↑${pushed} ↓${pulled}` : "Synced";
		tone = "text-emerald-500";
		surface = "border-emerald-500/15 bg-emerald-500/10";
		icon = <Check className="h-4 w-4" />;
	} else if (error) {
		title = `Sync error: ${error}`;
		tone = "text-destructive";
		surface = "border-destructive/15 bg-destructive/10";
		icon = <AlertCircle className="h-4 w-4" />;
	} else if (lastSync) {
		const timeLabel = formatDistanceToNow(new Date(lastSync), { addSuffix: true });
		const pushed = lastSyncResult?.totalPushed ?? 0;
		const pulled = lastSyncResult?.totalPulled ?? 0;
		const countLabel = pushed + pulled > 0 ? ` — ↑${pushed} pushed, ↓${pulled} pulled` : "";

		title = `Last synced ${timeLabel}${countLabel}`;
		tone = "text-muted-foreground/60";
		icon = <Cloud className="h-4 w-4" />;
	}

	return (
		<div
			title={title}
			aria-label={title}
			className={cn(
				"inline-flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border transition-[background-color,border-color,color] duration-[var(--dur-base)] ease-[var(--ease-ios)] motion-reduce:transition-none sm:w-[6.75rem] sm:justify-start sm:px-3",
				tone,
				surface
			)}>
			<span key={badgeState} className="fade-scale-in flex min-w-0 items-center gap-1.5">
				{icon}
				{text && (
					<span className="hidden min-w-0 truncate text-xs font-medium sm:inline">{text}</span>
				)}
			</span>
		</div>
	);
}
