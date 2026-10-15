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
	// Privacy
	hideAmounts?: boolean; // mask every monetary amount in the UI; default false
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
	cacheStatus?: "valid" | "recomputing" | "failed";
	cacheUpdatedAt?: number;
	cacheError?: string;
	cacheFailedAt?: number;
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

export type GoogleSheetsErrorCode =
	| "Offline"
	| "Unauthorized"
	| "NotConnected"
	| "RequiresReconnect"
	| "SheetMissing"
	| "SheetForeign"
	| "ConcurrentBackup"
	| "QuotaExceeded"
	| "PayloadTooLarge"
	| "PartialWrite"
	| "GoogleServerError"
	| "GoogleApiError"
	| "SheetTooLarge";

export interface GoogleSheetsCurrencyBackupState {
	currency: string;
	selected: boolean;
	spreadsheetId?: string;
	spreadsheetUrl?: string;
	spreadsheetName?: string;
	lastBackupAt?: number;
	lastBackupStartedAt?: number;
	lastBackupCompletedAt?: number;
	lastStatus?: "idle" | "in_progress" | "success" | "failed";
	lastError?: string;
	rowCounts?: Record<string, number>;
}

export interface GoogleSheetsBackupProgress {
	currency: string;
	tab: string;
	rowsWritten: number;
	totalRows: number;
}

export interface GoogleSheetsBackupStatus {
	connected: boolean;
	needsReconnect: boolean;
	states: GoogleSheetsCurrencyBackupState[];
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
	/**
	 * @deprecated Nisab was dropped; zakat is owed on the chosen basis whatever its size.
	 * Kept, unwritten, so calculations saved before the change still read back intact.
	 */
	nisabStandard?: "gold" | "silver";
	/** Blended price per gram actually used: total gold value ÷ total grams. */
	goldPricePerGram: number;
	/** @deprecated Only the silver nisab ever used this. Never written now. */
	silverPricePerGram?: number;
	/** Price per gram for each karat, in `referenceCurrency`, as of `assessmentDate`. */
	goldPricesByPurity?: Partial<Record<GoldPurity, number>>;
	referenceCurrency: string;
	/** Which monthly TOTAL fed the calculation: the year's minimum or its maximum. */
	basis?: "minimum" | "maximum";
	/** The editable zakat percentage this calculation used, 2.5 by default. */
	ratePercent?: number;

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
	/** @deprecated Nisab was dropped. Kept so older calculations still read back. */
	nisabThreshold?: number;
	zakatObligation: number;
	/** @deprecated Zakat is owed on any amount; there is no liability threshold. */
	isLiable?: boolean;

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

	/** Unix ms. Optional: zakat is often recorded long after it was handed over. */
	date?: number;
	amount: number;
	currency: string;
	recipient?: string; // e.g., "Local Masjid", "Charity X"
	notes?: string;

	createdAt: number;
	updatedAt: number;
	deletedAt?: number;
}

/**
 * Where a zakat year's 1 Ramaḍān anchor came from.
 * - "announced": a Ruet-e-Hilal sighting that actually happened
 * - "computed": umalqura 1 Ramaḍān + 1 day, pending an announcement
 * - "manual": the owner corrected the anchor by hand
 */
export type ZakatYearSource = "announced" | "computed" | "manual";

/**
 * Where a zakat year's Past Remaining came from.
 * - "auto": carried from the previous year's Balance/Excess
 * - "manual": the owner typed a figure in place of the carried one
 */
export type ZakatCarryForwardSource = "auto" | "manual";

/**
 * The per-year zakat inputs the owner can override: the 1 Ramaḍān anchor and the
 * balance carried in from earlier years.
 *
 * Only inputs are stored. The twelve months are always recomputed from the anchor, and
 * the carried balance is always recomputed from the previous year unless
 * `pastRemainingOverride` holds a figure the owner typed, so nothing stored here can
 * contradict what the engine derives.
 */
export interface ZakatYearOverride {
	id: string; // `${userId}:${islamicYear}`
	userId: string;
	islamicYear: number;
	ramadanStart: number; // Unix ms at local midnight
	source: ZakatYearSource;
	/** Past Remaining typed by the owner. Absent means carry the previous year's balance. */
	pastRemainingOverride?: number;
	pastRemainingSource?: ZakatCarryForwardSource;
	updatedAt: number;
	deletedAt?: number;
	pendingSync?: boolean;
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

// ============================================================================
// REPORTS TYPES
// ============================================================================

export type ReportTransactionRole = "remittance" | "plot-payment" | "income" | "excluded";

/** Per-account opt-in for the fiscal report; the user decides which accounts appear. */
export interface ReportAccountTag {
	id: string;
	userId: string;
	accountId: string;
	includeInReport: boolean;
	isRemittanceSource?: boolean;
	updatedAt: number;
	deletedAt?: number;
	pendingSync?: boolean;
}

/** A user-defined grouping for property payments, e.g. "BWC 7 Marla Overseas Block". */
export interface ReportProject {
	id: string;
	userId: string;
	title: string;
	note?: string;
	sortOrder?: number;
	updatedAt: number;
	deletedAt?: number;
	pendingSync?: boolean;
}

/** The user's confirm/untag decision for ONE transaction. */
export interface ReportTransactionTag {
	id: string;
	userId: string;
	transactionId: string;
	role: ReportTransactionRole;
	projectId?: string; // Set when role === "plot-payment"
	confirmed: boolean; // True once the user explicitly accepted or overrode the suggestion
	updatedAt: number;
	deletedAt?: number;
	pendingSync?: boolean;
}

/** Free-form rows the user types in by hand, e.g. "Nayatel tax" 4285 PKR. */
export interface ReportManualEntry {
	id: string;
	userId: string;
	label: string;
	amount: number;
	currency: string;
	section: "banks" | "plots" | "other";
	date?: number; // Unix ms
	note?: string;
	fiscalYearKey?: string; // Optional scoping to a single fiscal year
	updatedAt: number;
	deletedAt?: number;
	pendingSync?: boolean;
}

/** One row of the Jul→Jun salary grid the user maintains manually. */
export interface ReportMonthlySalaryRow {
	id: string;
	userId: string;
	fiscalYearKey: string;
	monthKey: string; // Calendar month in YYYY-MM form
	company?: string;
	salaryPkr?: number;
	salaryUsd?: number;
	taxablePkr?: number;
	providentFundRefund?: number;
	updatedAt: number;
	deletedAt?: number;
	pendingSync?: boolean;
}

export type ReportDetectionReason = "keyword" | "inflow" | "manual" | "account-flag";

/** Runtime-only detection candidate. Never persisted. */
export interface DetectedReportTransaction {
	transaction: Transaction;
	suggestedRole: ReportTransactionRole;
	reason: ReportDetectionReason;
	matchedKeyword?: string;
	confirmed: boolean;
	projectId?: string;
}

/** Runtime-only. Never persisted. */
export interface ReportAccountBalance {
	accountId: string;
	title: string;
	currency: string;
	closingBalance: number;
	isArchived: boolean;
}

/** Runtime-only. Never persisted. */
export interface ReportProjectPayment {
	transactionId: string;
	date: number;
	amount: number;
	currency: string;
	title: string;
	note?: string;
}

/** Runtime-only. Never persisted. */
export interface ReportProjectGroup {
	project: ReportProject;
	payments: ReportProjectPayment[];
	total: number;
	currency: string;
}

/** Runtime-only. Never persisted. */
export interface ReportRemittance {
	transactionId: string;
	date: number;
	amount: number;
	currency: string;
	title: string;
}

/** Runtime-only. Never persisted. Mirrors ReportRemittance for income the user tagged. */
export interface ReportIncome {
	transactionId: string;
	date: number;
	amount: number;
	currency: string;
	title: string;
}

/** Runtime-only aggregate recomputed on every render. Never persisted. */
export interface FiscalReportSummary {
	rangeKey: string;
	rangeLabel: string;
	fromMs: number;
	toMs: number;
	/** The single currency the whole report is scoped to; empty when unscoped. */
	currency: string;
	accountBalances: ReportAccountBalance[];
	remittances: ReportRemittance[];
	remittanceTotal: number;
	incomes: ReportIncome[];
	incomeTotal: number;
	projectGroups: ReportProjectGroup[];
	projectGrandTotal: number;
	manualEntries: ReportManualEntry[];
	monthlySalaryRows: ReportMonthlySalaryRow[];
	warnings: string[];
}
