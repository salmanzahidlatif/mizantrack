"use client";

import { useCallback, useMemo } from "react";

/** Stable no-throw haptic feedback callbacks. */
export type Haptics = Readonly<{
	light: () => void;
	medium: () => void;
	heavy: () => void;
	success: () => void;
	warning: () => void;
	error: () => void;
	selection: () => void;
}>;

function prefersReducedMotion(): boolean {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
		return false;
	}

	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Returns SSR-safe haptic callbacks backed by navigator.vibrate when available. */
export function useHaptics(): Haptics {
	const vibrate = useCallback((pattern: VibratePattern) => {
		if (
			prefersReducedMotion() ||
			typeof navigator === "undefined" ||
			typeof navigator.vibrate !== "function"
		) {
			return;
		}

		try {
			navigator.vibrate(pattern);
		} catch {
			// Unsupported browsers should silently no-op.
		}
	}, []);

	const light = useCallback(() => vibrate(8), [vibrate]);
	const medium = useCallback(() => vibrate(16), [vibrate]);
	const heavy = useCallback(() => vibrate(28), [vibrate]);
	const success = useCallback(() => vibrate([12, 36, 18]), [vibrate]);
	const warning = useCallback(() => vibrate([18, 40, 18]), [vibrate]);
	const error = useCallback(() => vibrate([24, 32, 24, 32, 36]), [vibrate]);
	const selection = useCallback(() => vibrate(5), [vibrate]);

	return useMemo(
		() => ({
			light,
			medium,
			heavy,
			success,
			warning,
			error,
			selection,
		}),
		[error, heavy, light, medium, selection, success, warning]
	);
}
