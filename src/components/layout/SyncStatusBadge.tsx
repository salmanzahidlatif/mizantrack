"use client";

import { formatDistanceToNow } from "date-fns";
import { AlertCircle, Check, Cloud, CloudOff, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@/components/ui/popover";
import { useHaptics } from "@/hooks/useHaptics";
import { cn } from "@/lib/utils";
import { collectSyncTableFailures, useSyncStore } from "@/store/sync-store";

type SyncBadgeState = "idle" | "syncing" | "success" | "error";

export function SyncStatusBadge() {
	const {
		syncing,
		lastSync,
		lastSyncUserId,
		error,
		syncErrorDetails,
		syncProgress,
		lastSyncResult,
		triggerSync,
	} = useSyncStore();
	const haptics = useHaptics();
	const [badgeState, setBadgeState] = useState<SyncBadgeState>("idle");
	const [open, setOpen] = useState(false);
	const errorMessage = syncErrorDetails?.message ?? error;
	const tableFailures = syncErrorDetails?.tableFailures?.length
		? syncErrorDetails.tableFailures
		: collectSyncTableFailures(lastSyncResult);
	const lastSuccessfulSync = syncErrorDetails?.lastSuccessfulSync ?? lastSync;
	const canRetry = Boolean(lastSyncUserId && !syncing);

	useEffect(() => {
		let t: ReturnType<typeof setTimeout> | undefined;
		if (syncing) {
			setBadgeState("syncing");
		} else if (errorMessage) {
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
	}, [syncing, errorMessage, lastSync]);

	useEffect(() => {
		if (!errorMessage) setOpen(false);
	}, [errorMessage]);

	function handleOpenChange(nextOpen: boolean) {
		setOpen(nextOpen);
		if (nextOpen) haptics.warning();
	}

	function handleRetrySync() {
		if (!lastSyncUserId) return;

		haptics.selection();
		void triggerSync(lastSyncUserId);
	}

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
		title = `Sync error: ${errorMessage ?? ""}`;
		tone = "text-destructive";
		surface = "border-destructive/15 bg-destructive/10";
		icon = <CloudOff className="h-4 w-4" />;
	} else if (badgeState === "success" && !errorMessage) {
		const pushed = lastSyncResult?.totalPushed ?? 0;
		const pulled = lastSyncResult?.totalPulled ?? 0;

		title = "Synced";
		text = pushed + pulled > 0 ? `↑${pushed} ↓${pulled}` : "Synced";
		tone = "text-emerald-500";
		surface = "border-emerald-500/15 bg-emerald-500/10";
		icon = <Check className="h-4 w-4" />;
	} else if (errorMessage) {
		title = `Sync error: ${errorMessage}`;
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

	const badgeContent = (
		<>
			<span key={badgeState} className="fade-scale-in flex min-w-0 items-center gap-1.5">
				{icon}
				{text && (
					<span className="hidden min-w-0 truncate text-xs font-medium sm:inline">{text}</span>
				)}
			</span>
		</>
	);
	const badgeClassName = cn(
		"inline-flex h-11 min-w-11 items-center justify-center overflow-hidden rounded-full border transition-[background-color,border-color,color] duration-[var(--dur-base)] ease-[var(--ease-ios)] motion-reduce:transition-none sm:w-[6.75rem] sm:justify-start sm:px-3",
		errorMessage ? "cursor-pointer" : "",
		tone,
		surface
	);
	const lastSyncLabel = lastSuccessfulSync
		? formatDistanceToNow(new Date(lastSuccessfulSync), { addSuffix: true })
		: "Never";

	if (!errorMessage) {
		return (
			<div title={title} aria-label={title} className={badgeClassName}>
				{badgeContent}
			</div>
		);
	}

	return (
		<Popover open={open} onOpenChange={handleOpenChange}>
			<PopoverTrigger asChild>
				<button type="button" title={title} aria-label={title} className={badgeClassName}>
					{badgeContent}
				</button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
				<PopoverHeader>
					<PopoverTitle>Sync error</PopoverTitle>
					<PopoverDescription>{errorMessage}</PopoverDescription>
				</PopoverHeader>

				<div className="rounded-xl bg-muted/50 p-2.5 text-xs">
					<p className="font-medium text-foreground">Failed tables/scopes</p>
					{tableFailures.length > 0 ? (
						<ul className="mt-1.5 space-y-1 text-muted-foreground">
							{tableFailures.map(({ table, message }) => (
								<li key={`${table}:${message}`} className="flex gap-1.5">
									<span className="font-medium text-foreground">{table}</span>
									<span>{message}</span>
								</li>
							))}
						</ul>
					) : (
						<p className="mt-1.5 text-muted-foreground">No table-specific details reported.</p>
					)}
				</div>

				<p className="text-xs text-muted-foreground">
					Last successful sync: <span className="font-medium text-foreground">{lastSyncLabel}</span>
				</p>

				<Button
					type="button"
					variant="destructive"
					onClick={handleRetrySync}
					disabled={!canRetry}
					className="w-full">
					<RefreshCw className={cn("h-4 w-4", syncing ? "animate-spin" : "")} />
					Retry sync
				</Button>
				{!lastSyncUserId && (
					<p className="text-center text-[11px] text-muted-foreground">
						Open Settings and save sync again if retry is unavailable.
					</p>
				)}
			</PopoverContent>
		</Popover>
	);
}
