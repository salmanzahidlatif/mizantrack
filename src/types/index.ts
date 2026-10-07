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
	accountType?: "asset" | "liability"; // Default: asset. Liability = loan you owe (reduces zakat)
	/** External-system identity used for idempotent re-imports; never use as this app's primary key. */
	sourceId?: string;
	updatedAt: number;
	deletedAt?: number;
}

export interface Category {
	id: string;
	userId: string;
	title: string;
	type: CategoryType;
	currency?: string; // Legacy records can be untagged; new edits require a currency.
	icon?: string;
	color?: string;
	parentId?: string;
	/** External-system identity used for idempotent re-imports; never use as this app's primary key. */
	sourceId?: string;
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
	/** External-system identity used for idempotent re-imports; never use as this app's primary key. */
	sourceId?: string;
	updatedAt: number;
	deletedAt?: number;
}

export interface Budget {
	id: string;
	userId: string;
	categoryId: string;
	/** Calendar month in YYYY-MM form. This avoids timezone bugs and indexes one period key. */
	period: string;
	amount: number;
	currency?: string;
	active: boolean;
	/** External-system identity used for idempotent re-imports; never use as this app's primary key. */
	sourceId?: string;
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

export interface DashboardStats {
	id: string; // userId
	updatedAt: number; // Unix ms
	logicVersion?: number;
	dataVersion?: string;
	cacheStatus?: "valid" | "recomputing";
	cacheUpdatedAt?: number;
	analyticsCache?: {
		accounts?: Record<
			string,
			{
				logicVersion: number;
				dataVersion: string;
				key: string;
				updatedAt: number;
				value: unknown;
			}
		>;
		periods?: Record<
			string,
			{
				logicVersion: number;
				dataVersion: string;
				key: string;
				updatedAt: number;
				value: unknown;
			}
		>;
		monthlySummaries?: Record<
			string,
			{
				logicVersion: number;
				dataVersion: string;
				key: string;
				updatedAt: number;
				value: unknown;
			}
		>;
	};
	balances: Record<string, number>;
	perCurrency: Record<
		string,
		{
			monthIncome: number;
			monthExpense: number;
			trend: Array<{
				month: string;
				income: number;
				expense: number;
			}>;
		}
	>;
	recent: Array<{
		id: string;
		type: "Expense" | "Income" | "Transfer";
		date: number;
		amount: number;
		description?: string;
		place?: string;
		accountId: string;
		accountTitle: string;
		accountCurrency: string;
		toAccountId?: string;
	}>;
	warnings?: Array<{
		code: "cross_currency_transfer_destination_skipped" | "invalid_transfer_counterparty_skipped";
		transactionId: string;
		message: string;
	}>;
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

// ============================================================================
// ZAKAT TYPES
// ============================================================================

export type GoldPurity = "21k" | "22k" | "24k";

export interface GoldItem {
	id: string;
	userId: string;
	currency: string;
	title: string; // e.g., "Wedding Ring", "Necklace"
	weight: number; // in grams
	purity: GoldPurity;
	purchaseDate?: number; // Unix ms
	purchasePrice?: number; // Original cost (reference only)
	notes?: string;
	updatedAt: number;
	deletedAt?: number;
}

export interface ZakatCalculation {
	id: string;
	userId: string;
	currency: string;
	islamicYear: string; // e.g., "1446-1447"
	assessmentDate: number; // Unix ms - typically end of Sha'ban

	// Configuration used
	nisabStandard: "gold" | "silver";
	goldPricePerGram: number;
	silverPricePerGram?: number;
	referenceCurrency: string;

	// Gold holdings
	totalGoldWeightGrams: number;
	totalGoldValue: number;

	// Account balances snapshot
	accountBalances: {
		accountId: string;
		accountTitle: string;
		balance: number;
		currency: string;
		exchangeRate: number;
		zakatable: boolean;
		accountType: "asset" | "liability";
	}[];

	// Results
	totalZakatable: number;
	nisabThreshold: number;
	zakatObligation: number;
	isLiable: boolean;

	// Monthly minimum tracking (for the 12 Islamic months)
	monthlyBalances?: {
		month: string; // e.g., "Ramadan 1446"
		gregorianDate: string; // e.g., "2024-04-10"
		totalWealth: number;
	}[];

	createdAt: number;
	updatedAt: number;
	deletedAt?: number;
}

export interface ZakatPayment {
	id: string;
	userId: string;
	calculationId?: string; // Link to ZakatCalculation
	islamicYear: string; // e.g., "1446-1447"

	date: number; // Unix ms - when paid
	amount: number;
	currency: string;
	recipient?: string; // e.g., "Local Masjid", "Charity X"
	notes?: string;

	createdAt: number;
	updatedAt: number;
	deletedAt?: number;
}

// Islamic calendar months in zakat year order (Ramadan → Sha'ban)
export const ISLAMIC_MONTHS = [
	"Ramaḍān",
	"Shawwāl",
	"Zū al-Qaʿdah",
	"Zū al-Ḥijjah",
	"al-Muḥarram", // Year changes here
	"Ṣafar",
	"Rabīʿ al-ʾAwwal",
	"Rabīʿ ath-Thānī",
	"Jumādā al-ʾAwwal",
	"Jumādā ath-Thāniyah",
	"Rajab",
	"Shaʿbān",
] as const;

export type IslamicMonth = (typeof ISLAMIC_MONTHS)[number];
