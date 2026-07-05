export type TransactionType = "Expense" | "Income" | "Transfer";
export type CategoryType = "Income" | "Expense";

export interface Account {
	id: string;
	userId: string;
	title: string;
	openingBalance: number;
	currency: string; // ISO code: AED, PKR, USD etc.
	color?: string;
	icon?: string;
	isArchived: boolean;
	updatedAt: number;
	deletedAt?: number;
}

export interface Category {
	id: string;
	userId: string;
	title: string;
	type: CategoryType;
	icon?: string;
	color?: string;
	parentId?: string;
	updatedAt: number;
	deletedAt?: number;
}

export interface Transaction {
	id: string;
	userId: string;
	type: TransactionType;
	date: number; // Unix ms
	amount: number; // Always positive
	description?: string;
	categoryId?: string;
	accountId: string;
	toAccountId?: string; // Transfer target
	tags?: string[];
	place?: string;
	travelCurrency?: {
		symbol: string;
		rate: number;
		amount: number;
		location: string;
	};
	updatedAt: number;
	deletedAt?: number;
}

export interface DbConfig {
	id: string; // userId
	firebaseConfig: string; // JSON stringified Firebase config
	enabled: boolean;
	currency: string; // user's default currency
	fiscalYearStartMonth: number; // 1–12
	// Gold price cache
	goldApiKey?: string;
	lastGoldPricePerGram?: number;
	lastGoldPriceFetchedAt?: number;
	// App Lock
	pinHash?: string; // SHA-256 hex of 4-digit PIN; absent = no PIN set
	appLockEnabled?: boolean; // default false
	biometricEnabled?: boolean; // flag only; default false
	biometricCredentialId?: string; // Base64 WebAuthn credentialId; device-local, NOT synced
	// Multi-currency
	enabledCurrencies?: string[]; // ISO codes of active currencies; min 1
}

export interface SyncMeta {
	id: string;
	timestamp: number;
}

export type FilterPeriod =
	| "today"
	| "week"
	| "month"
	| "quarter"
	| "half-year"
	| "year"
	| "fiscal-year"
	| "custom"
	| "all";

export interface DateRange {
	from: Date;
	to: Date;
}

export interface SyncStatus {
	lastSync: number | null;
	syncing: boolean;
	error: string | null;
}
