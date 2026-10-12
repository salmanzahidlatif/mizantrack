import { create } from "zustand";

const HIDE_AMOUNTS_KEY = "mizantrack:hideAmounts";

/** Read the persisted privacy flag from localStorage (SSR-safe). */
function readPersistedHideAmounts(): boolean {
	if (typeof window === "undefined") return false;
	return localStorage.getItem(HIDE_AMOUNTS_KEY) === "1";
}

interface PrivacyStore {
	/**
	 * Masks every monetary amount rendered through CurrencyAmount.
	 * Source of truth is `dbConfig.hideAmounts`; localStorage only mirrors it so the
	 * masked state is restored instantly on startup — amounts never flash before the
	 * Dexie config query resolves.
	 */
	hideAmounts: boolean;
	setHideAmounts: (hideAmounts: boolean) => void;
}

export const usePrivacyStore = create<PrivacyStore>((set) => ({
	hideAmounts: readPersistedHideAmounts(),

	setHideAmounts: (hideAmounts) => {
		if (typeof window !== "undefined") {
			localStorage.setItem(HIDE_AMOUNTS_KEY, hideAmounts ? "1" : "0");
		}
		set({ hideAmounts });
	},
}));
