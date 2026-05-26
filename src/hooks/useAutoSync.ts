import { useEffect } from "react";

import { useDbConfig } from "@/hooks/useDbConfig";
import { useSyncStore } from "@/store/sync-store";

const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function useAutoSync(userId: string) {
	const config = useDbConfig(userId);
	const triggerSync = useSyncStore((s) => s.triggerSync);

	useEffect(() => {
		if (!config?.enabled) return;

		function handleOnline() {
			if (navigator.onLine) {
				void triggerSync(userId);
			}
		}

		window.addEventListener("online", handleOnline);

		// Initial sync if already online
		if (navigator.onLine) {
			void triggerSync(userId);
		}

		const interval = setInterval(() => {
			if (navigator.onLine) {
				void triggerSync(userId);
			}
		}, SYNC_INTERVAL_MS);

		return () => {
			window.removeEventListener("online", handleOnline);
			clearInterval(interval);
		};
	}, [config?.enabled, userId, triggerSync]);
}
