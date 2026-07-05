"use client";

import { useEffect } from "react";

import { LockScreen } from "@/components/layout/LockScreen";
import { useDbConfig } from "@/hooks/useDbConfig";
import { useLockStore } from "@/store/lock-store";

const GRACE_PERIOD_MS = 30_000; // 30 seconds
const LAST_HIDDEN_KEY = "mizantrack:lastHidden";

interface AppLockGuardProps {
	userId: string;
	children: React.ReactNode;
}

export function AppLockGuard({ userId, children }: AppLockGuardProps) {
	const config = useDbConfig(userId);
	const { isLocked, lock, startGraceTimer, cancelGraceTimer, _graceExpired } = useLockStore();

	// ── Mount check: did the tab/app close and reopen? ──────────────────────
	// On a fresh page load (tab re-opened, PWA relaunched), React state is reset
	// so `_graceExpired` is always false. We persist a timestamp to localStorage
	// on every hide event and check it on mount to decide whether to lock immediately.
	useEffect(() => {
		if (!config) return; // still loading
		if (!config.appLockEnabled || !config.pinHash) return;

		const stored = localStorage.getItem(LAST_HIDDEN_KEY);
		if (stored) {
			const elapsed = Date.now() - Number(stored);
			localStorage.removeItem(LAST_HIDDEN_KEY);

			if (elapsed >= GRACE_PERIOD_MS) {
				// Tab was closed / app was in background long enough — lock immediately
				lock();
			} else {
				// Within grace window — start a timer for the remaining time
				startGraceTimer(GRACE_PERIOD_MS - elapsed);
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [config?.appLockEnabled, config?.pinHash]);

	// ── Visibility change: background ↔ foreground ──────────────────────────
	useEffect(() => {
		const handleVisibilityChange = () => {
			if (document.visibilityState === "hidden") {
				// Persist timestamp so we can check it on a fresh load
				localStorage.setItem(LAST_HIDDEN_KEY, String(Date.now()));
				startGraceTimer(GRACE_PERIOD_MS);
			} else {
				// Returning from background — clear stored timestamp (we'll handle via in-memory timer)
				localStorage.removeItem(LAST_HIDDEN_KEY);
				if (_graceExpired && config?.appLockEnabled && config?.pinHash) {
					lock();
				} else {
					cancelGraceTimer();
				}
			}
		};

		// pagehide fires on mobile PWA close and iOS Safari tab close
		const handlePageHide = () => {
			localStorage.setItem(LAST_HIDDEN_KEY, String(Date.now()));
		};

		document.addEventListener("visibilitychange", handleVisibilityChange);
		window.addEventListener("pagehide", handlePageHide);

		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange);
			window.removeEventListener("pagehide", handlePageHide);
		};
	}, [config?.appLockEnabled, config?.pinHash, _graceExpired, lock, startGraceTimer, cancelGraceTimer]);

	if (isLocked) {
		return (
			<LockScreen
				userId={userId}
				onUnlock={() => useLockStore.getState().unlock()}
			/>
		);
	}

	return <>{children}</>;
}
