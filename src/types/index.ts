export type TransactionType = "Expense" | "Income" | "Transfer";

export type RecurrenceFrequency = "daily" | "weekly" | "monthly" | "yearly";

/**
 * How a repeated transaction expands. The rule itself is never stored: occurrences are
 * materialised as real transactions when the owner saves, so budgets, analytics and
 * zakat read them like any other row. Each occurrence carries the series' `recurrenceId`.
 */
export type RecurrenceRule = {
	frequency: RecurrenceFrequency;
	/** Repeat every N periods — 1 is monthly, 2 is every other month. */
	interval: number;
} & ({ endMode: "count"; count: number } | { endMode: "until"; until: Date });

/** Which occurrences of a series an edit or delete reaches. */
export type RecurrenceEditScope = "single" | "future" | "series";
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
	/**
	 * Groups every occurrence a single "repeat" produced, so the series can later be
	 * edited or deleted as one. Absent on a one-off transaction.
	 */
	recurrenceId?: string;
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
	// Gold price cache — legacy
	/**
	 * @deprecated Live gold-price fetching was dropped; the owner types a price per karat
	 * for each zakat year instead (see `ZakatGoldYear`). Kept, unwritten, so records saved
	 * before the change still read back intact — and so `goldApiKey` stays in
	 * `SECURITY_EXCLUDED_DB_CONFIG_FIELDS`, which keeps an already-stored key out of every
	 * export file.
	 */
	goldApiKey?: string;
	/** @deprecated Cache for the dropped live price fetch. Never written now. */
	lastGoldPricePerGram?: number;
	/** @deprecated Cache for the dropped live price fetch. Never written now. */
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

/**
 * What one zakat year paid per gram for gold, in one currency.
 *
 * Only the PRICE belongs here now. The holding a year was assessed on is itemised in
 * `ZakatGoldYearItem`, one list per year, because pieces are sold and bought one at a
 * time: the owner's 168.4 g of 21k lost a 10 g piece and gained a 14 g 22k piece years
 * later, and the years before that must keep reporting what was actually held then.
 */
export interface ZakatGoldYear {
	id: string; // `${userId}:${currency}:${islamicYear}`
	userId: string;
	currency: string;
	/** The Islamic year Ramaḍān falls in — the stable identity of a zakat year. */
	islamicYear: number;
	/** Price per gram for each karat, in `currency`, as of `priceDate`. */
	pricesByPurity: Partial<Record<GoldPurity, number>>;
	/**
	 * @deprecated Superseded by `ZakatGoldYearItem`, which records the pieces themselves.
	 * Kept, and still honoured below an itemised list, so a year pinned before the change
	 * reads back exactly as it did. Never written for a year that has items.
	 */
	gramsByPurity?: Partial<Record<GoldPurity, number>>;
	/**
	 * Total silver held that year, in grams.
	 *
	 * Silver is one weight and one price per year, never itemised: the owner keeps it as
	 * a single line he retypes each year, so there is no per-piece list, no karat and no
	 * lineage to carry across years. Absent means the year held none, which is worth
	 * exactly zero rather than borrowing another year's figure.
	 */
	silverGrams?: number;
	/** Price per gram of silver, in `currency`, as of the same `priceDate` as the gold. */
	silverPricePerGram?: number;
	/** Unix ms the prices were taken on; the sheet prices gold at 1 Ramaḍān. */
	priceDate?: number;
	updatedAt: number;
	deletedAt?: number;
	pendingSync?: boolean;
}

/**
 * ONE piece of gold, as it was held in ONE zakat year.
 *
 * Holdings drift gradually: most pieces carry over untouched year to year while the odd
 * one is sold or added, and both the total and the karat mix move with them. A single
 * current inventory cannot express that — recording today's sale would rewrite every
 * past year as though the piece had never been owned — so each zakat year owns its own
 * list and editing one year can never reach another.
 *
 * `lineageId` is the piece's identity ACROSS years: the same necklace carries the same
 * lineage in 1440 and 1446, so the owner can see when it left, and the row id is derived
 * from it so two devices copying the same year forward converge on one row instead of
 * minting duplicates.
 */
export interface ZakatGoldYearItem {
	id: string; // `${userId}:${currency}:${islamicYear}:${lineageId}`
	userId: string;
	currency: string;
	/** The Islamic year Ramaḍān falls in — the stable identity of a zakat year. */
	islamicYear: number;
	/** The piece's identity across years, preserved by every copy-forward. */
	lineageId: string;
	title: string; // e.g., "Wedding Set", "Necklace"
	weight: number; // in grams
	purity: GoldPurity;
	notes?: string;
	/** The `goldItems` row this piece was first seeded from, when it came from there. */
	sourceGoldItemId?: string;
	/**
	 * The zakat year the piece was SOLD in, recorded once against the lineage.
	 *
	 * A sale is not a removal: "sold in 1446" means 1446 is the first year that no longer
	 * counts the piece — the owner sold a 10 g piece and bought 14 g of 22k instead, and
	 * the replacement is what serves that year. Every year before it keeps the piece, and
	 * every year after it reads the sale from this one row rather than needing a tombstone
	 * of its own.
	 */
	soldInIslamicYear?: number;
	/** Unix ms the piece first entered the record; stable across years, so order is too. */
	createdAt: number;
	updatedAt: number;
	deletedAt?: number;
	pendingSync?: boolean;
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
	/**
	 * @deprecated Only the silver NISAB ever used this, and nisab was dropped. Never
	 * written now — and deliberately NOT reused for the silver a year actually holds:
	 * a nisab threshold and a holding's price per gram are different statements, and a
	 * record saved years ago must not start reading as though silver had been held.
	 * Silver holdings are recorded in `totalSilverWeightGrams` / `totalSilverValue`,
	 * whose quotient IS the price per gram, there being one weight at one price.
	 */
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

	// Silver holdings. One weight at one price per gram, so the price the year was
	// assessed at is `totalSilverValue / totalSilverWeightGrams`. Optional: a year with
	// no silver records none, and reads back as zero.
	totalSilverWeightGrams?: number;
	totalSilverValue?: number;

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
	/**
	 * Accounts the owner chose for THIS year. Accounts open and close, so the set differs
	 * year to year — the `2020` sheet includes a closed Alfalah account the `2024` sheet
	 * has no row for. Absent means the year was never touched and the screen may
	 * pre-select for it; an empty array is a deliberate "none of them" and wins.
	 */
	selectedAccountIds?: string[];
	/** Whether the account picker lists closed accounts for this year. */
	showArchivedAccounts?: boolean;
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
