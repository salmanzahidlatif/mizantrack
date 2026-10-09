import { create } from "zustand";

import type { FilterPeriod, TransactionType, DateRange } from "@/types";

const ACTIVE_CURRENCY_KEY = "mizantrack:activeCurrency";
export const UNCATEGORIZED_CATEGORY_FILTER = Symbol("uncategorized-category-filter");
export type CategoryFilterValue = string | typeof UNCATEGORIZED_CATEGORY_FILTER;

/** Read persisted currency from localStorage (SSR-safe). */
function readPersistedCurrency(): string {
	if (typeof window === "undefined") return "";
	return localStorage.getItem(ACTIVE_CURRENCY_KEY) ?? "";
}

interface FilterStore {
	period: FilterPeriod;
	accountId: string | null;
	categoryId: CategoryFilterValue | null;
	transactionType: TransactionType | "All";
	searchQuery: string;
	customRange: DateRange | null;
	/** Active currency ISO code. Persisted to localStorage across app restarts. */
	activeCurrency: string;
	/** Show archived accounts within the active currency. Default false. */
	showArchivedAccounts: boolean;
	/** Include future-dated transactions in account balances. Default true. */
	includeFutureDatedBalances: boolean;

	setPeriod: (period: FilterPeriod) => void;
	setAccountId: (accountId: string | null) => void;
	setCategoryId: (categoryId: CategoryFilterValue | null) => void;
	setTransactionType: (type: TransactionType | "All") => void;
	setSearchQuery: (query: string) => void;
	setCustomRange: (range: DateRange | null) => void;
	setActiveCurrency: (code: string) => void;
	setShowArchivedAccounts: (show: boolean) => void;
	setIncludeFutureDatedBalances: (include: boolean) => void;
	reset: () => void;
}

const defaultState = {
	period: "month" as FilterPeriod,
	accountId: null,
	categoryId: null,
	transactionType: "All" as TransactionType | "All",
	searchQuery: "",
	customRange: null,
	// Restore last-used currency immediately on startup — no flash to wrong currency
	activeCurrency: readPersistedCurrency(),
	showArchivedAccounts: false,
	includeFutureDatedBalances: true,
};

export const useFilterStore = create<FilterStore>((set) => ({
	...defaultState,

	setPeriod: (period) => set({ period }),
	setAccountId: (accountId) => set({ accountId }),
	setCategoryId: (categoryId) => set({ categoryId }),
	setTransactionType: (transactionType) => set({ transactionType }),
	setSearchQuery: (searchQuery) => set({ searchQuery }),
	setCustomRange: (customRange) => set({ customRange }),
	setActiveCurrency: (activeCurrency) => {
		// Persist to localStorage so the selection survives app close/reopen
		if (typeof window !== "undefined") {
			localStorage.setItem(ACTIVE_CURRENCY_KEY, activeCurrency);
		}
		set({ activeCurrency });
	},
	setShowArchivedAccounts: (showArchivedAccounts) => set({ showArchivedAccounts }),
	setIncludeFutureDatedBalances: (includeFutureDatedBalances) =>
		set({ includeFutureDatedBalances }),
	// reset clears per-page filters but NOT activeCurrency (currency context persists)
	reset: () =>
		set((state) => ({
			...defaultState,
			activeCurrency: state.activeCurrency,
		})),
}));
