import { create } from "zustand";

interface UIStore {
	// Transaction drawer state
	isTransactionDrawerOpen: boolean;
	editTransactionId: string | null;
	openAddTransaction: () => void;
	openEditTransaction: (id: string) => void;
	closeTransactionDrawer: () => void;

	// Account drawer state
	isAccountDrawerOpen: boolean;
	editAccountId: string | null;
	openAddAccount: () => void;
	openEditAccount: (id: string) => void;
	closeAccountDrawer: () => void;

	// Category drawer state
	isCategoryDrawerOpen: boolean;
	editCategoryId: string | null;
	openAddCategory: () => void;
	openEditCategory: (id: string) => void;
	closeCategoryDrawer: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
	// Transaction drawer
	isTransactionDrawerOpen: false,
	editTransactionId: null,
	openAddTransaction: () => set({ isTransactionDrawerOpen: true, editTransactionId: null }),
	openEditTransaction: (id) => set({ isTransactionDrawerOpen: true, editTransactionId: id }),
	closeTransactionDrawer: () => set({ isTransactionDrawerOpen: false, editTransactionId: null }),

	// Account drawer
	isAccountDrawerOpen: false,
	editAccountId: null,
	openAddAccount: () => set({ isAccountDrawerOpen: true, editAccountId: null }),
	openEditAccount: (id) => set({ isAccountDrawerOpen: true, editAccountId: id }),
	closeAccountDrawer: () => set({ isAccountDrawerOpen: false, editAccountId: null }),

	// Category drawer
	isCategoryDrawerOpen: false,
	editCategoryId: null,
	openAddCategory: () => set({ isCategoryDrawerOpen: true, editCategoryId: null }),
	openEditCategory: (id) => set({ isCategoryDrawerOpen: true, editCategoryId: id }),
	closeCategoryDrawer: () => set({ isCategoryDrawerOpen: false, editCategoryId: null }),
}));
