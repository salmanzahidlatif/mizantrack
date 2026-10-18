/**
 * The native, complete MizanTrack backup.
 *
 * The Hysab Kytab `.db` export exists to hand data to another app: its schema is
 * external, one currency at a time, and it can only carry accounts, categories,
 * transactions and budgets. Everything the owner actually types into MizanTrack —
 * gold holdings, per-year gold prices, Ramaḍān anchors, carry-forward overrides,
 * account selections, zakat payments and saved calculations, report tag decisions,
 * projects, manual entries, the salary grid, and the app's own settings — has no
 * home in that schema. This format is MizanTrack's own, so nothing has to be left out.
 *
 * It is plain JSON on purpose: it needs no new dependency, survives inspection in any
 * text editor, round-trips `undefined`-free records byte for byte, and version-stamps
 * itself so a file from a newer build is refused rather than half-applied.
 */

import { db, MIZAN_TRACK_DEXIE_VERSION } from "../db/local";
import { CORE_SYNC_TABLES, LOCAL_ONLY_RECORD_FIELDS } from "../db/sync";

import { SECURITY_EXCLUDED_DB_CONFIG_FIELDS } from "./mizanTrackWorkbook";

import type { SyncableTable } from "../db/sync";
import type { DbConfig } from "@/types";

export const MIZAN_TRACK_FULL_BACKUP_FORMAT = "mizantrack-full-backup";
/** Bump only when the document shape changes in a way an older reader cannot handle. */
export const MIZAN_TRACK_FULL_BACKUP_FORMAT_VERSION = 1;
export const MIZAN_TRACK_FULL_BACKUP_FILE_SUFFIX = ".mizantrack.json";

/**
 * The tables a backup carries, derived from the list sync already maintains so a table
 * added to one can never be silently forgotten by the other. `CORE_SYNC_TABLES` is
 * already in referential order (accounts before transactions, projects before the tags
 * that point at them), and a restore writes in exactly this order for that reason.
 * `dbConfig` leads because it references nothing and the rest of the summary reads it.
 */
export const MIZAN_TRACK_FULL_BACKUP_TABLES = ["dbConfig", ...CORE_SYNC_TABLES] as const;

export type MizanTrackFullBackupTable = (typeof MIZAN_TRACK_FULL_BACKUP_TABLES)[number];

/**
 * Dexie tables deliberately left out of a backup, with the reason each one is not data
 * the owner typed:
 *
 * - `dashboardStats` is a derived analytics cache keyed by a data fingerprint. Restoring
 *   it would serve another device's stale figures until a recompute happened to run, so
 *   the restore invalidates the cache instead and lets it rebuild from the real rows.
 * - `syncMeta` holds per-table Firestore cursors and migration flags that belong to one
 *   device's pairing with one Firebase project. Importing another device's cursors would
 *   make this device skip pulling everything written before them.
 */
export const MIZAN_TRACK_FULL_BACKUP_EXCLUDED_TABLES = ["dashboardStats", "syncMeta"] as const;

/**
 * The settings fields a backup carries. Everything else on `DbConfig` is either a secret
 * or device-bound — see `MIZAN_TRACK_FULL_BACKUP_EXCLUDED_DB_CONFIG_FIELDS`.
 */
export const MIZAN_TRACK_FULL_BACKUP_DB_CONFIG_FIELDS = [
	"currency",
	"fiscalYearStartMonth",
	"enabledCurrencies",
	"hideAmounts",
] as const satisfies readonly (keyof DbConfig)[];

/**
 * Settings never written to a backup file.
 *
 * The four `SECURITY_EXCLUDED_DB_CONFIG_FIELDS` are credentials: a Firebase service
 * config, a legacy gold API key, the app-lock PIN hash and a WebAuthn credential id. A
 * backup is a file the owner moves around on a USB stick or a chat thread, so none of them
 * may leave the device — and restoring an app-lock PIN hash onto a different phone is a
 * security decision nobody asked for.
 *
 * The rest are excluded because they would arrive broken:
 * - `enabled` turns on Firebase sync, which cannot work without the `firebaseConfig`
 *   that is deliberately absent.
 * - `appLockEnabled` without the `pinHash` would lock the owner out of their own data.
 * - `biometricEnabled` without the device-local `biometricCredentialId` points at a
 *   credential this device has never registered.
 * - `lastGoldPricePerGram` / `lastGoldPriceFetchedAt` are a dead live-price cache; nothing
 *   writes them any more. The prices that matter to a zakat year live in `zakatGoldYears`
 *   and are restored in full.
 */
export const MIZAN_TRACK_FULL_BACKUP_EXCLUDED_DB_CONFIG_FIELDS = [
	...SECURITY_EXCLUDED_DB_CONFIG_FIELDS,
	"enabled",
	"appLockEnabled",
	"biometricEnabled",
	"lastGoldPricePerGram",
	"lastGoldPriceFetchedAt",
] as const satisfies readonly (keyof DbConfig)[];

/** A reference one table makes into another, checked for orphans after a restore. */
export interface MizanTrackFullBackupReference {
	field: string;
	table: MizanTrackFullBackupTable;
}

/**
 * Who points at whom. The restore writes tables in `MIZAN_TRACK_FULL_BACKUP_TABLES`
 * order so every target below already exists by the time the pointing row lands.
 */
export const MIZAN_TRACK_FULL_BACKUP_REFERENCES: Partial<
	Record<MizanTrackFullBackupTable, readonly MizanTrackFullBackupReference[]>
> = {
	categories: [{ field: "parentId", table: "categories" }],
	transactions: [
		{ field: "accountId", table: "accounts" },
		{ field: "toAccountId", table: "accounts" },
		{ field: "categoryId", table: "categories" },
	],
	budgets: [{ field: "categoryId", table: "categories" }],
	zakatPayments: [{ field: "calculationId", table: "zakatCalculations" }],
	reportAccountTags: [{ field: "accountId", table: "accounts" }],
	reportTransactionTags: [
		{ field: "transactionId", table: "transactions" },
		{ field: "projectId", table: "reportProjects" },
	],
};

export type MizanTrackFullBackupRecord = Record<string, unknown> & {
	id: string;
};

/** Every table except `dbConfig` carries the last-write-wins clock a restore merges on. */
export type MizanTrackFullBackupVersionedRecord = MizanTrackFullBackupRecord & {
	updatedAt: number;
};

export interface MizanTrackFullBackupDocument {
	format: typeof MIZAN_TRACK_FULL_BACKUP_FORMAT;
	/** The document shape. A reader refuses anything it does not know. */
	formatVersion: number;
	/** The Dexie schema the records were read from, so a future reader can migrate. */
	dexieVersion: number;
	exportedAt: number;
	/** The user the records belong to; a restore remaps them when it differs. */
	userId: string;
	counts: Record<MizanTrackFullBackupTable, number>;
	tables: Record<MizanTrackFullBackupTable, MizanTrackFullBackupRecord[]>;
}

export interface MizanTrackFullBackupProgress {
	table: MizanTrackFullBackupTable;
	tablesDone: number;
	tablesTotal: number;
	records: number;
}

export interface MizanTrackFullBackupOptions {
	onProgress?: (progress: MizanTrackFullBackupProgress) => void;
}

const LOCAL_ONLY_FIELD_SET = new Set(LOCAL_ONLY_RECORD_FIELDS);

/** Lets the event loop paint between tables so a large export never freezes the UI. */
function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
}

/**
 * Strips the two fields that only mean something on this device, and drops `undefined`
 * values so a record survives `JSON.stringify` with exactly the keys it had.
 */
function toBackupRecord(record: object): MizanTrackFullBackupRecord {
	const clean: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		if (value === undefined) continue;
		if (LOCAL_ONLY_FIELD_SET.has(key)) continue;
		clean[key] = value;
	}
	return clean as MizanTrackFullBackupRecord;
}

/** The settings row reduced to the non-secret, device-independent preferences. */
export function toBackupDbConfig(config: DbConfig): MizanTrackFullBackupRecord {
	const clean: Record<string, unknown> = { id: config.id };
	for (const field of MIZAN_TRACK_FULL_BACKUP_DB_CONFIG_FIELDS) {
		const value = config[field];
		if (value === undefined) continue;
		clean[field] = value;
	}
	return clean as MizanTrackFullBackupRecord;
}

async function loadBackupTable(
	table: MizanTrackFullBackupTable,
	userId: string
): Promise<MizanTrackFullBackupRecord[]> {
	if (table === "dbConfig") {
		const config = await db.dbConfig.get(userId);
		return config ? [toBackupDbConfig(config)] : [];
	}

	// Soft-deleted rows are exported too: a delete is data, and dropping it here is how
	// a restore would resurrect something the owner removed on the source device.
	const records = await db[table as SyncableTable].where("userId").equals(userId).toArray();
	return records.map(toBackupRecord);
}

export async function buildMizanTrackFullBackup(
	userId: string,
	options: MizanTrackFullBackupOptions = {}
): Promise<MizanTrackFullBackupDocument> {
	const tables = {} as Record<MizanTrackFullBackupTable, MizanTrackFullBackupRecord[]>;
	const counts = {} as Record<MizanTrackFullBackupTable, number>;
	const tablesTotal = MIZAN_TRACK_FULL_BACKUP_TABLES.length;
	let tablesDone = 0;

	for (const table of MIZAN_TRACK_FULL_BACKUP_TABLES) {
		const records = await loadBackupTable(table, userId);
		tables[table] = records;
		counts[table] = records.length;
		tablesDone += 1;
		options.onProgress?.({ table, tablesDone, tablesTotal, records: records.length });
		await yieldToEventLoop();
	}

	return {
		format: MIZAN_TRACK_FULL_BACKUP_FORMAT,
		formatVersion: MIZAN_TRACK_FULL_BACKUP_FORMAT_VERSION,
		dexieVersion: MIZAN_TRACK_DEXIE_VERSION,
		exportedAt: Date.now(),
		userId,
		counts,
		tables,
	};
}

export function serializeMizanTrackFullBackup(document: MizanTrackFullBackupDocument): string {
	return JSON.stringify(document);
}

export async function buildMizanTrackFullBackupText(
	userId: string,
	options: MizanTrackFullBackupOptions = {}
): Promise<string> {
	return serializeMizanTrackFullBackup(await buildMizanTrackFullBackup(userId, options));
}

export function buildMizanTrackFullBackupFilename(date = new Date()): string {
	const stamp = [
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, "0"),
		String(date.getDate()).padStart(2, "0"),
	].join("-");
	return `mizantrack-full-backup-${stamp}${MIZAN_TRACK_FULL_BACKUP_FILE_SUFFIX}`;
}
