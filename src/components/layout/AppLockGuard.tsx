"use client";

import { useEffect } from "react";

import { LockScreen } from "@/components/layout/LockScreen";
import { useDbConfig } from "@/hooks/useDbConfig";
import { useLockStore } from "@/store/lock-store";

const GRACE_PERIOD_MS = 30_000; // 30 seconds

interface AppLockGuardProps {
	userId: string;
	children: React.ReactNode;
}

export function AppLockGuard({ userId, children }: AppLockGuardProps) {
	const config = useDbConfig(userId);
	const { isLocked, lock, startGraceTimer, cancelGraceTimer, _graceExpired } = useLockStore();

	useEffect(() => {
		const handleVisibilityChange = () => {
			if (document.visibilityState === "hidden") {
				startGraceTimer(GRACE_PERIOD_MS);
			} else {
				// Page became visible
				if (_graceExpired && config?.appLockEnabled && config?.pinHash) {
					lock();
				} else {
					cancelGraceTimer();
				}
			}
		};

		document.addEventListener("visibilitychange", handleVisibilityChange);
		// Also listen for pagehide as a fallback on some mobile browsers
		window.addEventListener("pagehide", () => startGraceTimer(GRACE_PERIOD_MS));

		return () => {
			document.removeEventListener("visibilitychange", handleVisibilityChange);
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
