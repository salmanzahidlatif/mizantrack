import { useEffect } from "react";

import { useDbConfig } from "@/hooks/useDbConfig";
import { useSyncStore } from "@/store/sync-store";

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

export function useAutoSync(userId: string) {
	const config = useDbConfig(userId);
	const triggerSync = useSyncStore((s) => s.triggerSync);
	const suppressAutoSyncUntil = useSyncStore((s) => s.suppressAutoSyncUntil);

	useEffect(() => {
		if (!config?.enabled) return;

		function shouldSync() {
			if (!navigator.onLine) return false;
			if (suppressAutoSyncUntil && Date.now() < suppressAutoSyncUntil) return false;
			return true;
		}

		function handleOnline() {
			if (shouldSync()) void triggerSync(userId);
		}

		window.addEventListener("online", handleOnline);

		// Initial sync if already online
		if (shouldSync()) {
			void triggerSync(userId);
		}

		const interval = setInterval(() => {
			// Firestore free tier guard:
			// - before: 12 periodic sync attempts/hour/tab, even while hidden
			// - after: 4/hour while visible, 0/hour while hidden
			// Manual sync, the initial sync, and the online event remain unchanged.
			if (document.visibilityState === "hidden") return;
			if (shouldSync()) void triggerSync(userId);
		}, SYNC_INTERVAL_MS);

		return () => {
			window.removeEventListener("online", handleOnline);
			clearInterval(interval);
		};
	}, [config?.enabled, userId, triggerSync, suppressAutoSyncUntil]);
}
