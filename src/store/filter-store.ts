import { create } from "zustand";

import type { FilterPeriod, TransactionType, DateRange } from "@/types";

interface FilterStore {
	period: FilterPeriod;
	accountId: string | null;
	categoryId: string | null;
	transactionType: TransactionType | "All";
	searchQuery: string;
	customRange: DateRange | null;

	setPeriod: (period: FilterPeriod) => void;
	setAccountId: (accountId: string | null) => void;
	setCategoryId: (categoryId: string | null) => void;
	setTransactionType: (type: TransactionType | "All") => void;
	setSearchQuery: (query: string) => void;
	setCustomRange: (range: DateRange | null) => void;
	reset: () => void;
}

const defaultState = {
	period: "month" as FilterPeriod,
	accountId: null,
	categoryId: null,
	transactionType: "All" as TransactionType | "All",
	searchQuery: "",
	customRange: null,
};

export const useFilterStore = create<FilterStore>((set) => ({
	...defaultState,

	setPeriod: (period) => set({ period }),
	setAccountId: (accountId) => set({ accountId }),
	setCategoryId: (categoryId) => set({ categoryId }),
	setTransactionType: (transactionType) => set({ transactionType }),
	setSearchQuery: (searchQuery) => set({ searchQuery }),
	setCustomRange: (customRange) => set({ customRange }),
	reset: () => set(defaultState),
}));
