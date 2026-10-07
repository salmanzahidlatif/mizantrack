import {
	collection,
	doc,
	getDocs,
	getDoc,
	getCountFromServer,
	orderBy,
	query,
	serverTimestamp,
	setDoc,
	type Firestore,
	writeBatch,
	where,
} from "firebase/firestore";

import { invalidateAnalyticsCache } from "@/lib/analytics/cache";
import { sanitizeDashboardStats } from "@/lib/analytics/computeDashboardStats";
import { scheduleAnalyticsRecompute } from "@/lib/analytics/scheduleRecompute";

import { getFirestoreForUser } from "./firebase";
import { LEGACY_ZAKAT_CURRENCY, db as localDb, withoutSyncDirtyTracking } from "./local";

import type { SyncDirtyFields } from "./local";
import type {
	Account,
	Budget,
	Category,
	DashboardStats,
	DbConfig,
	GoldItem,
	Transaction,
	ZakatCalculation,
	ZakatPayment,
} from "@/types";
import type { Table } from "dexie";

export type SyncableTable =
	| "accounts"
	| "categories"
	| "transactions"
	| "budgets"
	| "goldItems"
	| "zakatCalculations"
	| "zakatPayments";
type SyncableRecord = (
	| Account
	| Category
	| Transaction
	| Budget
	| GoldItem
	| ZakatCalculation
	| ZakatPayment
) &
	SyncDirtyFields;
export type SyncScope = SyncableTable | "firebase" | "settings" | "dashboard";
type OptionalSyncFieldsByTable = {
	accounts: readonly (keyof Account)[];
	categories: readonly (keyof Category)[];
	transactions: readonly (keyof Transaction)[];
	budgets: readonly (keyof Budget)[];
	goldItems: readonly (keyof GoldItem)[];
	zakatCalculations: readonly (keyof ZakatCalculation)[];
	zakatPayments: readonly (keyof ZakatPayment)[];
};
type NonClearingOptionalSyncFieldsByTable = {
	accounts: readonly (keyof Account)[];
	categories: readonly (keyof Category)[];
	transactions: readonly (keyof Transaction)[];
	budgets: readonly (keyof Budget)[];
	goldItems: readonly (keyof GoldItem)[];
	zakatCalculations: readonly (keyof ZakatCalculation)[];
	zakatPayments: readonly (keyof ZakatPayment)[];
};

export const FIRESTORE_FREE_TIER_DAILY_WRITE_LIMIT = 20_000;
export const FIRESTORE_FREE_TIER_DAILY_READ_LIMIT = 50_000;
export const FIRESTORE_SYNC_TIMEOUT_MS = 15_000;
export const CORE_SYNC_TABLES = [
	"accounts",
	"categories",
	"transactions",
	"budgets",
	"goldItems",
	"zakatCalculations",
	"zakatPayments",
] as const;

function formatFirestoreLimit(limit: number): string {
	return new Intl.NumberFormat("en-US").format(limit);
}

export const FIRESTORE_DAILY_QUOTA_EXCEEDED_MESSAGE = `Sync failed: Firestore daily quota exceeded. Free tier allows ${formatFirestoreLimit(FIRESTORE_FREE_TIER_DAILY_WRITE_LIMIT)} writes and ${formatFirestoreLimit(FIRESTORE_FREE_TIER_DAILY_READ_LIMIT)} reads per day. Sync will resume tomorrow.`;

function getFirebaseErrorCode(error: unknown): string | undefined {
	if (error instanceof Error && "code" in error) {
		const code = (error as { code?: unknown }).code;
		return typeof code === "string" ? code : undefined;
	}
	if (typeof error === "object" && error !== null && "code" in error) {
		const code = (error as { code?: unknown }).code;
		return typeof code === "string" ? code : undefined;
	}
	return undefined;
}

function isQuotaError(error: unknown): boolean {
	return getFirebaseErrorCode(error) === "resource-exhausted";
}

function withFirestoreTimeout<T>(
	operation: Promise<T>,
	description: string,
	timeoutMs = FIRESTORE_SYNC_TIMEOUT_MS
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => {
			reject(
				new Error(`Sync timed out while ${description}. Check your connection and try again.`)
			);
		}, timeoutMs);
	});

	return Promise.race([operation, timeout]).finally(() => {
		if (timeoutId) clearTimeout(timeoutId);
	});
}

function getPerTableSyncKey(table: SyncableTable): string {
	return `lastSync:${table}`;
}

function getPerTableMigrationKey(table: SyncableTable): string {
	return `syncedAtMigration:${table}:v1`;
}

async function getTableSyncCursor(table: SyncableTable): Promise<number> {
	const perTableMeta = await localDb.syncMeta.get(getPerTableSyncKey(table));
	return perTableMeta?.timestamp ?? 0;
}

async function setTableSyncCursor(table: SyncableTable, timestamp: number): Promise<void> {
	await localDb.syncMeta.put({ id: getPerTableSyncKey(table), timestamp });
}

export interface SyncTableResult {
	pushed: number;
	pulled: number;
	migrated: boolean;
	cursor: number;
}

export interface SyncErrorDetail {
	/** Table/document area that failed. Core data tables use their table name. */
	scope: SyncScope;
	/** Sync phase that failed. UI can display this for precise diagnostics. */
	phase: "opening" | "migration" | "push" | "pull" | "settings" | "dashboard";
	/** Firebase SDK error code when present, e.g. "resource-exhausted". */
	code?: string;
	/** User-facing error text. Quota errors use FIRESTORE_DAILY_QUOTA_EXCEEDED_MESSAGE. */
	message: string;
	/** True when the failure is Firestore's daily quota/resource-exhausted condition. */
	quotaExceeded: boolean;
}

export interface SyncResult {
	/** True only when every sync scope completed successfully. */
	synced: boolean;
	/** "success" = all scopes completed; "partial" = at least one scope completed and one failed; "failed" = none completed; "no-config" = sync disabled/unconfigured. */
	status: "success" | "partial" | "failed" | "no-config";
	reason?: "no-config" | "partial-failure" | "sync-failed";
	tables?: Partial<Record<SyncableTable, SyncTableResult>>;
	errors: SyncErrorDetail[];
	totalPushed: number;
	totalPulled: number;
}

export type SyncProgressCallback = (progress: {
	table: SyncableTable;
	pushed: number;
	pulled: number;
	totalPushed: number;
	totalPulled: number;
}) => void;

const OPTIONAL_SYNC_FIELDS = {
	accounts: ["color", "icon", "accountType", "deletedAt"],
	categories: ["currency", "icon", "color", "parentId", "deletedAt"],
	transactions: [
		"description",
		"categoryId",
		"toAccountId",
		"tags",
		"place",
		"travelCurrency",
		"deletedAt",
	],
	budgets: ["currency", "deletedAt"],
	goldItems: ["purchaseDate", "purchasePrice", "notes", "deletedAt"],
	zakatCalculations: ["silverPricePerGram", "monthlyBalances", "deletedAt"],
	zakatPayments: ["calculationId", "recipient", "notes", "deletedAt"],
} as const satisfies OptionalSyncFieldsByTable;

// sourceId is optional for legacy/manual records, but it is not null-written:
// clearing it during a merge could erase the external identity needed for safe re-imports.
const NON_CLEARING_OPTIONAL_SYNC_FIELDS = {
	accounts: ["sourceId"],
	categories: ["sourceId"],
	transactions: ["sourceId"],
	budgets: ["sourceId"],
	goldItems: [],
	zakatCalculations: [],
	zakatPayments: [],
} as const satisfies NonClearingOptionalSyncFieldsByTable;

const LOCAL_ONLY_SYNC_FIELDS = new Set(["pendingSync", "syncedAt"]);
const ZAKAT_SYNC_TABLES = new Set<SyncableTable>([
	"goldItems",
	"zakatCalculations",
	"zakatPayments",
]);

function getLocalSyncTable(tableName: SyncableTable): Table<SyncableRecord> {
	return localDb[tableName] as unknown as Table<SyncableRecord>;
}

function toFirestoreSyncRecord(
	tableName: SyncableTable,
	record: SyncableRecord,
	options: { includeSyncedAt?: boolean } = {}
): Record<string, unknown> {
	const clean = Object.fromEntries(
		Object.entries(record).filter(
			([key, value]) => value !== undefined && !LOCAL_ONLY_SYNC_FIELDS.has(key)
		)
	);

	for (const field of OPTIONAL_SYNC_FIELDS[tableName]) {
		if ((record as unknown as Record<string, unknown>)[field] === undefined) {
			clean[field] = null;
		}
	}

	if (options.includeSyncedAt ?? true) {
		clean.syncedAt = serverTimestamp();
	}

	return clean;
}

function fromFirestoreSyncRecord<T extends SyncableRecord>(
	tableName: SyncableTable,
	record: T,
	fallbackId?: string
): T {
	const clean = { ...record } as Record<string, unknown>;
	if (typeof clean.id !== "string" && fallbackId) {
		clean.id = fallbackId;
	}
	delete clean.pendingSync;
	delete clean.syncedAt;

	for (const field of OPTIONAL_SYNC_FIELDS[tableName]) {
		if (clean[field] === null || clean[field] === undefined) {
			delete clean[field];
		}
	}
	for (const field of NON_CLEARING_OPTIONAL_SYNC_FIELDS[tableName]) {
		if (clean[field] === null || clean[field] === undefined) {
			delete clean[field];
		}
	}
	if (ZAKAT_SYNC_TABLES.has(tableName) && !clean.currency) {
		clean.currency = LEGACY_ZAKAT_CURRENCY;
	}

	return clean as T;
}

function getSyncedAtMillis(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "object") {
		const maybeTimestamp = value as {
			toMillis?: () => number;
			seconds?: number;
			nanoseconds?: number;
		};
		if (typeof maybeTimestamp.toMillis === "function") {
			const millis = maybeTimestamp.toMillis();
			return Number.isFinite(millis) ? millis : null;
		}
		if (typeof maybeTimestamp.seconds === "number") {
			return (
				maybeTimestamp.seconds * 1000 + Math.floor((maybeTimestamp.nanoseconds ?? 0) / 1_000_000)
			);
		}
	}
	return null;
}

function normalizeSyncError(
	scope: SyncScope,
	phase: SyncErrorDetail["phase"],
	error: unknown
): SyncErrorDetail {
	const code = getFirebaseErrorCode(error);
	const quotaExceeded = isQuotaError(error);
	const message = quotaExceeded
		? FIRESTORE_DAILY_QUOTA_EXCEEDED_MESSAGE
		: code === "permission-denied"
			? "Sync failed: permission denied. Check your Firestore security rules."
			: error instanceof Error
				? error.message
				: `Sync failed while ${phase}.`;

	return {
		scope,
		phase,
		code,
		message,
		quotaExceeded,
	};
}

function recordsMatchForPendingClear(
	tableName: SyncableTable,
	current: SyncableRecord,
	pushed: SyncableRecord
): boolean {
	return (
		JSON.stringify(toFirestoreSyncRecord(tableName, current, { includeSyncedAt: false })) ===
		JSON.stringify(toFirestoreSyncRecord(tableName, pushed, { includeSyncedAt: false }))
	);
}

async function putLocalRecord(tableName: SyncableTable, record: SyncableRecord): Promise<void> {
	const localRecord = { ...record, pendingSync: false };
	await withoutSyncDirtyTracking(async () => {
		switch (tableName) {
			case "accounts":
				await localDb.accounts.put(localRecord as Account);
				break;
			case "categories":
				await localDb.categories.put(localRecord as Category);
				break;
			case "transactions":
				await localDb.transactions.put(localRecord as Transaction);
				break;
			case "budgets":
				await localDb.budgets.put(localRecord as Budget);
				break;
			case "goldItems":
				await localDb.goldItems.put(localRecord as GoldItem);
				break;
			case "zakatCalculations":
				await localDb.zakatCalculations.put(localRecord as ZakatCalculation);
				break;
			case "zakatPayments":
				await localDb.zakatPayments.put(localRecord as ZakatPayment);
				break;
		}
	});
}

async function clearPendingForPushedRecords(
	tableName: SyncableTable,
	records: SyncableRecord[]
): Promise<void> {
	if (records.length === 0) return;
	const pushedById = new Map(records.map((record) => [record.id, record]));

	await withoutSyncDirtyTracking(async () => {
		await getLocalSyncTable(tableName)
			.where("id")
			.anyOf(records.map((record) => record.id))
			.modify((current: SyncableRecord) => {
				const pushed = pushedById.get(current.id);
				if (!pushed) return;
				if (recordsMatchForPendingClear(tableName, current, pushed)) {
					current.pendingSync = false;
				}
			});
	});
}

async function markLocalRecordPending(tableName: SyncableTable, id: string): Promise<void> {
	await getLocalSyncTable(tableName).update(id, { pendingSync: true } as Partial<SyncableRecord>);
}

export async function syncAll(
	userId: string,
	onProgress?: SyncProgressCallback
): Promise<SyncResult> {
	let firestore: Firestore | null;
	try {
		firestore = await withFirestoreTimeout(getFirestoreForUser(userId), "opening Firebase");
	} catch (error) {
		return {
			synced: false,
			status: "failed",
			reason: "sync-failed",
			errors: [normalizeSyncError("firebase", "opening", error)],
			totalPushed: 0,
			totalPulled: 0,
		};
	}
	if (!firestore) {
		return {
			synced: false,
			status: "no-config",
			reason: "no-config",
			errors: [],
			totalPushed: 0,
			totalPulled: 0,
		};
	}

	const tables: Partial<Record<SyncableTable, SyncTableResult>> = {};
	const errors: SyncErrorDetail[] = [];
	let totalPushed = 0;
	let totalPulled = 0;
	let pulledCoreChanges = false;
	let completedScopes = 0;
	let stoppedForQuota = false;

	for (const table of CORE_SYNC_TABLES) {
		try {
			const result = await syncCollection(userId, table, firestore);
			tables[table] = result;
			completedScopes++;
			totalPushed += result.pushed;
			totalPulled += result.pulled;
			if (result.pulled > 0) pulledCoreChanges = true;
			onProgress?.({ table, ...result, totalPushed, totalPulled });
		} catch (error) {
			const phase = error instanceof SyncPhaseError ? error.phase : "pull";
			errors.push(normalizeSyncError(table, phase, error));
			onProgress?.({
				table,
				pushed: 0,
				pulled: 0,
				totalPushed,
				totalPulled,
			});
			if (isQuotaError(error) || errors[errors.length - 1]?.quotaExceeded) {
				stoppedForQuota = true;
				break;
			}
		}
	}

	// Fixed doc-level sync cost after the 3 collection loops:
	// - settings/prefs: 1 read + up to 1 write
	// - analytics/dashboard: 1 read + up to 1 write
	// No per-field reads/writes are introduced here.
	if (!stoppedForQuota) {
		try {
			await syncSettingsPrefs(userId, firestore);
			completedScopes++;
		} catch (error) {
			const syncError = normalizeSyncError("settings", "settings", error);
			errors.push(syncError);
			stoppedForQuota = syncError.quotaExceeded;
		}

		if (!stoppedForQuota) {
			try {
				await syncDashboardStats(userId, firestore);
				completedScopes++;
			} catch (error) {
				errors.push(normalizeSyncError("dashboard", "dashboard", error));
			}
		}
	}

	if (pulledCoreChanges) {
		try {
			scheduleAnalyticsRecompute(userId);
		} catch (error) {
			console.error("Failed to schedule dashboard analytics recompute after sync:", error);
		}
	}

	const status = errors.length === 0 ? "success" : completedScopes > 0 ? "partial" : "failed";

	return {
		synced: status === "success",
		status,
		reason:
			status === "success" ? undefined : status === "partial" ? "partial-failure" : "sync-failed",
		tables,
		errors,
		totalPushed,
		totalPulled,
	};
}

class SyncPhaseError extends Error {
	phase: SyncErrorDetail["phase"];
	cause: unknown;

	constructor(phase: SyncErrorDetail["phase"], cause: unknown) {
		super(cause instanceof Error ? cause.message : `Sync failed during ${phase}.`);
		this.name = "SyncPhaseError";
		this.phase = phase;
		this.cause = cause;
		const code = getFirebaseErrorCode(cause);
		if (code) {
			(this as Error & { code?: string }).code = code;
		}
	}
}

async function syncCollection(
	userId: string,
	tableName: SyncableTable,
	firestore: Firestore
): Promise<SyncTableResult> {
	const table = getLocalSyncTable(tableName);
	let pushed = 0;
	let pulled = 0;
	let migrated = false;

	try {
		const migration = await migrateTableToServerCursor(userId, tableName, firestore);
		migrated = migration.migrated;
		pushed += migration.pushed;
	} catch (error) {
		throw new SyncPhaseError("migration", error);
	}

	try {
		const localChanged = await table
			.where("userId")
			.equals(userId)
			.and((r: SyncableRecord) => r.pendingSync === true)
			.toArray();

		pushed += await pushLocalRecords(userId, tableName, firestore, localChanged);
	} catch (error) {
		throw new SyncPhaseError("push", error);
	}

	let cursor: number;
	try {
		const result = await pullRemoteRecords(userId, tableName, firestore);
		pulled += result.pulled;
		cursor = result.cursor;
	} catch (error) {
		throw new SyncPhaseError("pull", error);
	}

	return { pushed, pulled, migrated, cursor };
}

async function pushLocalRecords(
	userId: string,
	tableName: SyncableTable,
	firestore: Firestore,
	records: SyncableRecord[]
): Promise<number> {
	let pushed = 0;
	for (let i = 0; i < records.length; i += 499) {
		const chunk = records.slice(i, i + 499);
		const batch = writeBatch(firestore);
		chunk.forEach((record: SyncableRecord) => {
			const ref = doc(firestore, `users/${userId}/${tableName}`, record.id);
			const clean = toFirestoreSyncRecord(tableName, record);
			batch.set(ref, clean, { merge: true });
		});
		await withFirestoreTimeout(batch.commit(), `pushing ${tableName}`);
		await clearPendingForPushedRecords(tableName, chunk);
		pushed += chunk.length;
	}
	return pushed;
}

async function pullRemoteRecords(
	userId: string,
	tableName: SyncableTable,
	firestore: Firestore
): Promise<{ pulled: number; cursor: number }> {
	const table = getLocalSyncTable(tableName);
	const cursor = await getTableSyncCursor(tableName);
	const remoteSnap = await withFirestoreTimeout(
		getDocs(
			query(
				collection(firestore, `users/${userId}/${tableName}`),
				where("syncedAt", ">", cursor),
				orderBy("syncedAt")
			)
		),
		`pulling ${tableName}`
	);

	let pulled = 0;
	let maxSyncedAt = cursor;
	let invalidatedAnalytics = false;
	for (const docSnap of remoteSnap.docs) {
		const rawRemote = docSnap.data() as SyncableRecord & { syncedAt?: unknown };
		const remoteSyncedAt = getSyncedAtMillis(rawRemote.syncedAt);
		if (remoteSyncedAt === null) continue;
		maxSyncedAt = Math.max(maxSyncedAt, remoteSyncedAt);

		const remote = fromFirestoreSyncRecord(tableName, rawRemote, docSnap.id);
		const local = (await table.get(remote.id)) as SyncableRecord | undefined;
		if (!local || remote.updatedAt > local.updatedAt) {
			if (!invalidatedAnalytics) {
				await invalidateAnalyticsCache(userId);
				invalidatedAnalytics = true;
			}
			await putLocalRecord(tableName, remote);
			pulled++;
		} else if (local.updatedAt > remote.updatedAt && local.pendingSync !== true) {
			await markLocalRecordPending(tableName, local.id);
		}
	}

	if (maxSyncedAt > cursor) {
		await setTableSyncCursor(tableName, maxSyncedAt);
	}

	return { pulled, cursor: maxSyncedAt };
}

async function migrateTableToServerCursor(
	userId: string,
	tableName: SyncableTable,
	firestore: Firestore
): Promise<{ migrated: boolean; pushed: number }> {
	const migrationKey = getPerTableMigrationKey(tableName);
	const migrationDone = await localDb.syncMeta.get(migrationKey);
	if (migrationDone) return { migrated: false, pushed: 0 };

	const table = getLocalSyncTable(tableName);
	const remoteSnap = await withFirestoreTimeout(
		getDocs(collection(firestore, `users/${userId}/${tableName}`)),
		`backfilling ${tableName}`
	);
	const remoteIds = new Set<string>();
	const fullPushes: SyncableRecord[] = [];
	const stampOnlyIds: string[] = [];

	for (const docSnap of remoteSnap.docs) {
		const rawRemote = docSnap.data() as SyncableRecord & { syncedAt?: unknown };
		const remote = fromFirestoreSyncRecord(tableName, rawRemote, docSnap.id);
		remoteIds.add(remote.id);

		const local = (await table.get(remote.id)) as SyncableRecord | undefined;
		if (!local) {
			await putLocalRecord(tableName, remote);
			if (getSyncedAtMillis(rawRemote.syncedAt) === null) {
				stampOnlyIds.push(remote.id);
			}
			continue;
		}

		if (remote.updatedAt > local.updatedAt) {
			await putLocalRecord(tableName, remote);
			if (getSyncedAtMillis(rawRemote.syncedAt) === null) {
				stampOnlyIds.push(remote.id);
			}
			continue;
		}

		if (local.updatedAt > remote.updatedAt) {
			fullPushes.push(local);
		} else if (getSyncedAtMillis(rawRemote.syncedAt) === null) {
			stampOnlyIds.push(remote.id);
		}
	}

	const localOnly = (await table
		.where("userId")
		.equals(userId)
		.and((record: SyncableRecord) => !remoteIds.has(record.id))
		.toArray()) as SyncableRecord[];
	fullPushes.push(...localOnly);

	const fullPushCount = await pushLocalRecords(userId, tableName, firestore, fullPushes);
	const stampOnlyCount = await stampRemoteRecords(userId, tableName, firestore, stampOnlyIds);

	await localDb.syncMeta.bulkPut([
		{ id: migrationKey, timestamp: 1 },
		{ id: getPerTableSyncKey(tableName), timestamp: 0 },
	]);

	return { migrated: true, pushed: fullPushCount + stampOnlyCount };
}

async function stampRemoteRecords(
	userId: string,
	tableName: SyncableTable,
	firestore: Firestore,
	ids: string[]
): Promise<number> {
	let stamped = 0;
	for (let i = 0; i < ids.length; i += 499) {
		const chunk = ids.slice(i, i + 499);
		const batch = writeBatch(firestore);
		chunk.forEach((id) => {
			const ref = doc(firestore, `users/${userId}/${tableName}`, id);
			batch.set(ref, { syncedAt: serverTimestamp() }, { merge: true });
		});
		await withFirestoreTimeout(batch.commit(), `stamping ${tableName}`);
		stamped += chunk.length;
	}
	return stamped;
}

/** Fields synced to Firestore settings/prefs document. biometricCredentialId is intentionally excluded. */
const SYNCED_PREFS_FIELDS = [
	"pinHash",
	"appLockEnabled",
	"biometricEnabled",
	"currency",
	"enabledCurrencies",
	"fiscalYearStartMonth",
] as const;

/**
 * Push/pull the settings/prefs Firestore document.
 * Path: /users/{userId}/settings/prefs
 * Conflict resolution: last-write-wins on prefs.updatedAt
 */
async function syncSettingsPrefs(userId: string, firestore: Firestore): Promise<void> {
	const localConfig = await localDb.dbConfig.get(userId);
	if (!localConfig) return;

	const prefsRef = doc(firestore, `users/${userId}/settings`, "prefs");

	// On a fresh device prefsUpdatedAt is undefined — default to 0 so Firebase always wins.
	const localUpdatedAt =
		((localConfig as unknown as Record<string, unknown>).prefsUpdatedAt as number | undefined) ?? 0;

	const remoteSnap = await withFirestoreTimeout(getDoc(prefsRef), "pulling settings");

	if (remoteSnap.exists()) {
		const remote = remoteSnap.data() as Record<string, unknown>;
		const remoteUpdatedAt = (remote.updatedAt as number | undefined) ?? 0;

		if (remoteUpdatedAt > localUpdatedAt) {
			// Pull remote → local
			const patch: Partial<typeof localConfig> = {};
			for (const field of SYNCED_PREFS_FIELDS) {
				if (remote[field] !== undefined) {
					(patch as Record<string, unknown>)[field] = remote[field];
				}
			}
			if (Object.keys(patch).length > 0) {
				await localDb.dbConfig.update(userId, patch);
			}
			return;
		}
	}

	// Push local → remote
	const prefs: Record<string, unknown> = { updatedAt: localUpdatedAt };
	for (const field of SYNCED_PREFS_FIELDS) {
		const val = (localConfig as unknown as Record<string, unknown>)[field];
		if (val !== undefined) prefs[field] = val;
	}
	await withFirestoreTimeout(setDoc(prefsRef, prefs, { merge: true }), "pushing settings");
}

async function syncDashboardStats(userId: string, firestore: Firestore): Promise<void> {
	const analyticsRef = doc(firestore, `users/${userId}/analytics`, "dashboard");
	const local = await localDb.dashboardStats.get(userId);
	const remoteSnap = await withFirestoreTimeout(
		getDoc(analyticsRef),
		"pulling dashboard analytics"
	);

	if (remoteSnap.exists()) {
		const remote = remoteSnap.data() as DashboardStats;
		const localUpdatedAt = local?.updatedAt ?? 0;
		const remoteUpdatedAt = remote.updatedAt ?? 0;

		if (remoteUpdatedAt > localUpdatedAt) {
			await localDb.dashboardStats.put(sanitizeDashboardStats({ ...remote, id: userId }));
			return;
		}
	}

	if (local) {
		await withFirestoreTimeout(
			setDoc(analyticsRef, sanitizeDashboardStats(local)),
			"pushing dashboard analytics"
		);
	}
}

export interface SyncBackupTableCount {
	table: SyncableTable;
	local: number;
	remote: number;
	pending: number;
}

export type SyncBackupCurrencyTable = Extract<
	SyncableTable,
	"accounts" | "categories" | "transactions" | "budgets"
>;

export type SyncBackupCurrencyBucketKind = "currency" | "untagged" | "unknown";

export interface SyncBackupCurrencyTableCount {
	table: SyncBackupCurrencyTable;
	local: number;
	pending: number;
}

export interface SyncBackupCurrencyCount {
	key: string;
	label: string;
	currency?: string;
	kind: SyncBackupCurrencyBucketKind;
	local: number;
	pending: number;
	tables: SyncBackupCurrencyTableCount[];
}

export interface SyncBackupCounts {
	tables: SyncBackupTableCount[];
	currencyBreakdown: SyncBackupCurrencyCount[];
	totalLocal: number;
	totalRemote: number;
	totalPending: number;
}

const BACKUP_CURRENCY_TABLES = [
	"accounts",
	"categories",
	"transactions",
	"budgets",
] as const satisfies readonly SyncBackupCurrencyTable[];
const UNTAGGED_CURRENCY_BUCKET_KEY = "__untagged";
const UNKNOWN_CURRENCY_BUCKET_KEY = "__unknown";

type CurrencyBucketDescriptor = {
	key: string;
	label: string;
	currency?: string;
	kind: SyncBackupCurrencyBucketKind;
};

type MutableCurrencyBucket = CurrencyBucketDescriptor & {
	local: number;
	pending: number;
	tables: Record<SyncBackupCurrencyTable, { local: number; pending: number }>;
};

function createEmptyCurrencyTableCounts(): Record<
	SyncBackupCurrencyTable,
	{ local: number; pending: number }
> {
	return {
		accounts: { local: 0, pending: 0 },
		categories: { local: 0, pending: 0 },
		transactions: { local: 0, pending: 0 },
		budgets: { local: 0, pending: 0 },
	};
}

function normalizeBackupCurrencyCode(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const normalized = value.trim().toUpperCase();
	return normalized ? normalized : null;
}

function hasPendingSync(record: unknown): boolean {
	return (record as SyncDirtyFields).pendingSync === true;
}

function getEnabledBackupCurrencies(config: DbConfig | undefined): string[] | null {
	const currencies = new Set<string>();
	const defaultCurrency = normalizeBackupCurrencyCode(config?.currency);
	if (defaultCurrency) currencies.add(defaultCurrency);
	for (const currency of config?.enabledCurrencies ?? []) {
		const normalized = normalizeBackupCurrencyCode(currency);
		if (normalized) currencies.add(normalized);
	}
	return currencies.size > 0 ? Array.from(currencies) : null;
}

function getBackupCurrencyBucket(
	value: unknown,
	enabledCurrencies: Set<string> | null,
	options: { allowUntagged?: boolean } = {}
): CurrencyBucketDescriptor {
	const normalized = normalizeBackupCurrencyCode(value);
	if (!normalized) {
		if (options.allowUntagged) {
			return {
				key: UNTAGGED_CURRENCY_BUCKET_KEY,
				label: "Untagged",
				kind: "untagged",
			};
		}
		return {
			key: UNKNOWN_CURRENCY_BUCKET_KEY,
			label: "Other / Unknown",
			kind: "unknown",
		};
	}

	if (enabledCurrencies && !enabledCurrencies.has(normalized)) {
		return {
			key: UNKNOWN_CURRENCY_BUCKET_KEY,
			label: "Other / Unknown",
			kind: "unknown",
		};
	}

	return {
		key: normalized,
		label: normalized,
		currency: normalized,
		kind: "currency",
	};
}

function getMutableCurrencyBucket(
	buckets: Map<string, MutableCurrencyBucket>,
	descriptor: CurrencyBucketDescriptor
): MutableCurrencyBucket {
	const existing = buckets.get(descriptor.key);
	if (existing) return existing;

	const bucket: MutableCurrencyBucket = {
		...descriptor,
		local: 0,
		pending: 0,
		tables: createEmptyCurrencyTableCounts(),
	};
	buckets.set(descriptor.key, bucket);
	return bucket;
}

function addCurrencyBackupCount(
	buckets: Map<string, MutableCurrencyBucket>,
	descriptor: CurrencyBucketDescriptor,
	table: SyncBackupCurrencyTable,
	counts: { local: number; pending: number }
): void {
	if (counts.local === 0 && counts.pending === 0) return;

	const bucket = getMutableCurrencyBucket(buckets, descriptor);
	bucket.local += counts.local;
	bucket.pending += counts.pending;
	bucket.tables[table].local += counts.local;
	bucket.tables[table].pending += counts.pending;
}

function finalizeCurrencyBackupCounts(
	buckets: Map<string, MutableCurrencyBucket>,
	enabledCurrencyOrder: Map<string, number>
): SyncBackupCurrencyCount[] {
	const kindOrder: Record<SyncBackupCurrencyBucketKind, number> = {
		currency: 0,
		untagged: 1,
		unknown: 2,
	};

	return Array.from(buckets.values())
		.sort((a, b) => {
			const kindDiff = kindOrder[a.kind] - kindOrder[b.kind];
			if (kindDiff !== 0) return kindDiff;
			const aOrder = a.currency
				? (enabledCurrencyOrder.get(a.currency) ?? Number.MAX_SAFE_INTEGER)
				: 0;
			const bOrder = b.currency
				? (enabledCurrencyOrder.get(b.currency) ?? Number.MAX_SAFE_INTEGER)
				: 0;
			if (aOrder !== bOrder) return aOrder - bOrder;
			return a.label.localeCompare(b.label);
		})
		.map((bucket) => ({
			key: bucket.key,
			label: bucket.label,
			currency: bucket.currency,
			kind: bucket.kind,
			local: bucket.local,
			pending: bucket.pending,
			tables: BACKUP_CURRENCY_TABLES.map((table) => ({
				table,
				local: bucket.tables[table].local,
				pending: bucket.tables[table].pending,
			})),
		}));
}

async function getLocalBackupCurrencyBreakdown(
	userId: string,
	enabledCurrencyCodes: string[] | null
): Promise<SyncBackupCurrencyCount[]> {
	const enabledCurrencies = enabledCurrencyCodes ? new Set(enabledCurrencyCodes) : null;
	const enabledCurrencyOrder = new Map(
		(enabledCurrencyCodes ?? []).map((currency, index) => [currency, index])
	);
	const buckets = new Map<string, MutableCurrencyBucket>();

	for (const currency of enabledCurrencyCodes ?? []) {
		getMutableCurrencyBucket(buckets, getBackupCurrencyBucket(currency, enabledCurrencies));
	}

	const [accounts, categories, budgets] = await Promise.all([
		localDb.accounts
			.where("userId")
			.equals(userId)
			.and((account) => !account.deletedAt)
			.toArray(),
		localDb.categories
			.where("userId")
			.equals(userId)
			.and((category) => !category.deletedAt)
			.toArray(),
		localDb.budgets
			.where("userId")
			.equals(userId)
			.and((budget) => !budget.deletedAt)
			.toArray(),
	]);
	const categoriesById = new Map(categories.map((category) => [category.id, category]));

	for (const account of accounts) {
		addCurrencyBackupCount(
			buckets,
			getBackupCurrencyBucket(account.currency, enabledCurrencies),
			"accounts",
			{ local: 1, pending: hasPendingSync(account) ? 1 : 0 }
		);
	}

	for (const category of categories) {
		addCurrencyBackupCount(
			buckets,
			getBackupCurrencyBucket(category.currency, enabledCurrencies, { allowUntagged: true }),
			"categories",
			{ local: 1, pending: hasPendingSync(category) ? 1 : 0 }
		);
	}

	for (const budget of budgets) {
		const category = categoriesById.get(budget.categoryId);
		const currencySource = normalizeBackupCurrencyCode(budget.currency)
			? budget.currency
			: category?.currency;
		addCurrencyBackupCount(
			buckets,
			getBackupCurrencyBucket(currencySource, enabledCurrencies, {
				allowUntagged: Boolean(category),
			}),
			"budgets",
			{ local: 1, pending: hasPendingSync(budget) ? 1 : 0 }
		);
	}

	const [transactionLocalTotal, transactionPendingTotal] = await Promise.all([
		localDb.transactions
			.where("userId")
			.equals(userId)
			.and((transaction) => !transaction.deletedAt)
			.count(),
		localDb.transactions
			.where("userId")
			.equals(userId)
			.and((transaction) => !transaction.deletedAt && hasPendingSync(transaction))
			.count(),
	]);
	let countedTransactionLocal = 0;
	let countedTransactionPending = 0;

	await Promise.all(
		accounts.map(async (account) => {
			const [local, pending] = await Promise.all([
				localDb.transactions
					.where("accountId")
					.equals(account.id)
					.and((transaction) => transaction.userId === userId && !transaction.deletedAt)
					.count(),
				localDb.transactions
					.where("accountId")
					.equals(account.id)
					.and(
						(transaction) =>
							transaction.userId === userId && !transaction.deletedAt && hasPendingSync(transaction)
					)
					.count(),
			]);
			countedTransactionLocal += local;
			countedTransactionPending += pending;
			addCurrencyBackupCount(
				buckets,
				getBackupCurrencyBucket(account.currency, enabledCurrencies),
				"transactions",
				{ local, pending }
			);
		})
	);

	addCurrencyBackupCount(
		buckets,
		getBackupCurrencyBucket(null, enabledCurrencies),
		"transactions",
		{
			local: Math.max(0, transactionLocalTotal - countedTransactionLocal),
			pending: Math.max(0, transactionPendingTotal - countedTransactionPending),
		}
	);

	return finalizeCurrencyBackupCounts(buckets, enabledCurrencyOrder);
}

/**
 * Compares local (non-deleted) record counts against remote Firestore document
 * counts per table, so the UI can show "X of Y backed up" / "Z left to sync".
 * Remote count uses aggregate getCountFromServer reads; pending is local-only
 * and comes from the dirty flag used by sync pushes, so it does not require
 * reading every remote document. Per-currency breakdowns are intentionally
 * local/pending only because Firestore aggregate counts cannot be split by
 * currency without reading every remote document.
 */
export async function getSyncBackupCounts(userId: string): Promise<SyncBackupCounts | null> {
	try {
		const [firestore, localConfig] = await Promise.all([
			withFirestoreTimeout(getFirestoreForUser(userId), "opening Firebase"),
			localDb.dbConfig.get(userId),
		]);
		if (!firestore) return null;
		const enabledCurrencyCodes = getEnabledBackupCurrencies(localConfig);

		const [tables, currencyBreakdown] = await Promise.all([
			Promise.all(
				CORE_SYNC_TABLES.map(async (table): Promise<SyncBackupTableCount> => {
					const [localCount, pendingCount, remoteSnap] = await Promise.all([
						getLocalSyncTable(table)
							.where("userId")
							.equals(userId)
							.and((r: SyncableRecord) => !r.deletedAt)
							.count(),
						getLocalSyncTable(table)
							.where("userId")
							.equals(userId)
							.and((r: SyncableRecord) => !r.deletedAt && r.pendingSync === true)
							.count(),
						withFirestoreTimeout(
							getCountFromServer(collection(firestore, `users/${userId}/${table}`)),
							`counting ${table}`
						),
					]);
					const remoteCount = remoteSnap.data().count;
					return {
						table,
						local: localCount,
						remote: remoteCount,
						pending: pendingCount,
					};
				})
			),
			getLocalBackupCurrencyBreakdown(userId, enabledCurrencyCodes),
		]);

		return {
			tables,
			currencyBreakdown,
			totalLocal: tables.reduce((sum, t) => sum + t.local, 0),
			totalRemote: tables.reduce((sum, t) => sum + t.remote, 0),
			totalPending: tables.reduce((sum, t) => sum + t.pending, 0),
		};
	} catch {
		return null;
	}
}

export async function getFirestoreUsage(userId: string) {
	try {
		const firestore = await withFirestoreTimeout(getFirestoreForUser(userId), "opening Firebase");
		if (!firestore) return null;

		const counts = await Promise.all(
			CORE_SYNC_TABLES.map(async (col) => {
				const snap = await withFirestoreTimeout(
					getCountFromServer(collection(firestore, `users/${userId}/${col}`)),
					`counting ${col}`
				);
				return { col, count: snap.data().count };
			})
		);

		// Rough estimate: avg doc ~600 bytes
		const totalDocs = counts.reduce((sum, c) => sum + c.count, 0);
		const estimatedMB = ((totalDocs * 600) / 1024 / 1024).toFixed(2);
		const freeLimitMB = 1024;

		return {
			counts,
			totalDocs,
			estimatedMB,
			freeLimitMB,
			percentUsed: ((+estimatedMB / freeLimitMB) * 100).toFixed(1),
		};
	} catch {
		return null;
	}
}

export interface ClearResult {
	deleted: number;
	collections: Record<string, number>;
}

/**
 * Batch-delete all documents under /users/{userId}/ in the user's Firestore.
 * Deletes: accounts, categories, transactions, settings/prefs, analytics/dashboard.
 * After deletion resets local syncMeta watermarks to 0 so next sync re-uploads everything.
 */
export async function clearFirestoreForUser(
	userId: string,
	onProgress?: (deleted: number) => void
): Promise<ClearResult> {
	const firestore = await withFirestoreTimeout(getFirestoreForUser(userId), "opening Firebase");
	if (!firestore) throw new Error("Firebase not configured.");

	let totalDeleted = 0;
	const collectionCounts: Record<string, number> = {};

	for (const col of CORE_SYNC_TABLES) {
		const snap = await withFirestoreTimeout(
			getDocs(collection(firestore, `users/${userId}/${col}`)),
			`listing ${col} for deletion`
		);
		let count = 0;
		for (let i = 0; i < snap.docs.length; i += 499) {
			const chunk = snap.docs.slice(i, i + 499);
			const batch = writeBatch(firestore);
			chunk.forEach((d) => batch.delete(d.ref));
			await withFirestoreTimeout(batch.commit(), `deleting ${col}`);
			count += chunk.length;
			totalDeleted += chunk.length;
			onProgress?.(totalDeleted);
		}
		collectionCounts[col] = count;
	}

	// Delete settings/prefs document
	try {
		const docsToDelete = [
			{ key: "settings", ref: doc(firestore, `users/${userId}/settings`, "prefs") },
			{ key: "analytics", ref: doc(firestore, `users/${userId}/analytics`, "dashboard") },
		];

		for (const { key, ref } of docsToDelete) {
			const snap = await withFirestoreTimeout(getDoc(ref), `checking ${key} document`);
			if (!snap.exists()) continue;

			const batch = writeBatch(firestore);
			batch.delete(ref);
			await withFirestoreTimeout(batch.commit(), `deleting ${key} document`);
			totalDeleted++;
			collectionCounts[key] = 1;
		}
	} catch {
		// Non-critical — continue
	}

	// Reset cursors/migration state and mark local records dirty so next sync
	// re-uploads everything into the now-empty Firestore collections.
	await localDb.syncMeta.bulkDelete(
		CORE_SYNC_TABLES.map((table) => getPerTableMigrationKey(table))
	);
	await localDb.syncMeta.bulkPut([
		{ id: "lastSync", timestamp: 0 },
		...CORE_SYNC_TABLES.map((table) => ({ id: getPerTableSyncKey(table), timestamp: 0 })),
	]);
	await Promise.all(
		CORE_SYNC_TABLES.map((table) =>
			getLocalSyncTable(table)
				.where("userId")
				.equals(userId)
				.modify((record: SyncableRecord) => {
					record.pendingSync = true;
				})
		)
	);

	return { deleted: totalDeleted, collections: collectionCounts };
}
