import { create } from "zustand";

import type { FilterPeriod, TransactionType, DateRange } from "@/types";

interface FilterStore {
	period: FilterPeriod;
	accountId: string | null;
	categoryId: string | null;
	transactionType: TransactionType | "All";
	searchQuery: string;
	customRange: DateRange | null;
	/** Active currency ISO code. Empty string = not yet seeded from dbConfig. */
	activeCurrency: string;
	/** Show archived accounts within the active currency. Default false. */
	showArchivedAccounts: boolean;

	setPeriod: (period: FilterPeriod) => void;
	setAccountId: (accountId: string | null) => void;
	setCategoryId: (categoryId: string | null) => void;
	setTransactionType: (type: TransactionType | "All") => void;
	setSearchQuery: (query: string) => void;
	setCustomRange: (range: DateRange | null) => void;
	setActiveCurrency: (code: string) => void;
	setShowArchivedAccounts: (show: boolean) => void;
	reset: () => void;
}

const defaultState = {
	period: "month" as FilterPeriod,
	accountId: null,
	categoryId: null,
	transactionType: "All" as TransactionType | "All",
	searchQuery: "",
	customRange: null,
	activeCurrency: "",
	showArchivedAccounts: false,
};

export const useFilterStore = create<FilterStore>((set) => ({
	...defaultState,

	setPeriod: (period) => set({ period }),
	setAccountId: (accountId) => set({ accountId }),
	setCategoryId: (categoryId) => set({ categoryId }),
	setTransactionType: (transactionType) => set({ transactionType }),
	setSearchQuery: (searchQuery) => set({ searchQuery }),
	setCustomRange: (customRange) => set({ customRange }),
	setActiveCurrency: (activeCurrency) => set({ activeCurrency }),
	setShowArchivedAccounts: (showArchivedAccounts) => set({ showArchivedAccounts }),
	// reset clears per-page filters but NOT activeCurrency (currency context persists)
	reset: () =>
		set((state) => ({
			...defaultState,
			activeCurrency: state.activeCurrency,
		})),
}));
