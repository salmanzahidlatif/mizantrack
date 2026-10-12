"use client";

import { useEffect } from "react";

import { usePrivacyStore } from "@/store/privacy-store";

import type { DbConfig } from "@/types";

/** Current privacy state. Cheap store subscription — safe to call from leaf components. */
export function useHideAmounts(): boolean {
	return usePrivacyStore((state) => state.hideAmounts);
}

/**
 * Mirrors `dbConfig.hideAmounts` into the privacy store. Takes an already-loaded
 * config so it never opens a second live query.
 */
export function useSyncHideAmounts(config: DbConfig | undefined): void {
	const hideAmounts = config?.hideAmounts ?? false;
	const hasConfig = config !== undefined;

	useEffect(() => {
		if (!hasConfig) return;
		usePrivacyStore.getState().setHideAmounts(hideAmounts);
	}, [hasConfig, hideAmounts]);
}
