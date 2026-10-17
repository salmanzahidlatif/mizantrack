/**
 * Restoring a native MizanTrack full backup.
 *
 * The file is a merge, never a replacement. Every table it carries is keyed by `id` and
 * stamped with `updatedAt`, so an incoming record is applied only when it is strictly
 * newer than what this device already holds — the same last-write-wins rule
 * `src/lib/db/sync.ts` applies to a Firestore pull, shared through `incomingRecordWins`
 * rather than reimplemented here. Three things fall out of that for free:
 *
 * - Importing the same file twice writes nothing the second time; the clocks are equal.
 * - A record the owner soft-deleted on the source device arrives carrying its
 *   `deletedAt`, so a delete propagates instead of the row resurrecting.
 * - A merge of duplicate accounts or categories survives. Merging stamps the survivor,
 *   the moved transactions and the absorbed row with `Date.now()`, so a backup taken
 *   before the merge is uniformly older and loses every one of those rows; a backup
 *   taken after it carries the merged state verbatim. Either way the absorbed account
 *   stays soft-deleted and nothing points back at it.
 */

import { invalidateAnalyticsCache } from "@/lib/analytics/cache";
import { scheduleAnalyticsRecompute } from "@/lib/analytics/scheduleRecompute";
import { upsertDbConfig } from "@/lib/db/dbConfig";
import { db, withoutSyncDirtyTracking } from "@/lib/db/local";
import { getSyncableLocalTable, incomingRecordWins } from "@/lib/db/sync";
import {
	MIZAN_TRACK_FULL_BACKUP_DB_CONFIG_FIELDS,
	MIZAN_TRACK_FULL_BACKUP_FORMAT,
	MIZAN_TRACK_FULL_BACKUP_FORMAT_VERSION,
	MIZAN_TRACK_FULL_BACKUP_REFERENCES,
	MIZAN_TRACK_FULL_BACKUP_TABLES,
} from "@/lib/export/mizanTrackFullBackup";
import { buildZakatGoldYearItemId } from "@/lib/zakatGoldYearItems";
import { buildZakatGoldYearId } from "@/lib/zakatGoldYearRepository";
import { buildZakatYearOverrideId } from "@/lib/zakatYearRepository";

import type { SyncableTable } from "@/lib/db/sync";
import type {
	MizanTrackFullBackupDocument,
	MizanTrackFullBackupRecord,
	MizanTrackFullBackupTable,
	MizanTrackFullBackupVersionedRecord,
} from "@/lib/export/mizanTrackFullBackup";
import type { DbConfig } from "@/types";

/** Keeps each Dexie round trip bounded so a 50,000-row restore never freezes the UI. */
const RESTORE_CHUNK_SIZE = 500;

export interface MizanTrackFullBackupTableResult {
	table: MizanTrackFullBackupTable;
	/** Records the file carried for this table. */
	incoming: number;
	/** Records actually written, because they were new or strictly newer. */
	applied: number;
	/** Records the file carried that this device already had at the same clock. */
	unchanged: number;
	/** Records refused because the local copy was edited more recently. */
	skippedOlder: number;
}

export interface MizanTrackFullBackupOrphanReport {
	table: MizanTrackFullBackupTable;
	field: string;
	references: MizanTrackFullBackupTable;
	/** Distinct referenced ids that exist nowhere after the restore. */
	count: number;
}

export interface MizanTrackFullBackupRestoreResult {
	formatVersion: number;
	dexieVersion: number;
	exportedAt: number;
	sourceUserId: string;
	/** True when the file came from a different account and ids had to be re-homed. */
	userIdRemapped: boolean;
	tables: MizanTrackFullBackupTableResult[];
	totalIncoming: number;
	totalApplied: number;
	/** Preference names taken from the file. Secrets are never in the file to begin with. */
	settingsRestored: string[];
	/**
	 * References that point at an id neither the file nor this device holds, counted as
	 * distinct missing targets. The pointing rows are imported anyway: dropping a record
	 * the owner entered is worse than a dangling reference, and the missing row may still
	 * arrive from a later Firebase pull. The count is surfaced so a genuinely broken file
	 * is visible rather than silent.
	 */
	orphans: MizanTrackFullBackupOrphanReport[];
}

export interface MizanTrackFullBackupRestoreProgress {
	table: MizanTrackFullBackupTable;
	tablesDone: number;
	tablesTotal: number;
	recordsDone: number;
	recordsTotal: number;
}

export interface MizanTrackFullBackupRestoreOptions {
	onProgress?: (progress: MizanTrackFullBackupRestoreProgress) => void;
}

/**
 * Tables whose primary key is derived from the user id. When a file is restored under a
 * different account the key has to be rebuilt from the same template that wrote it, or
 * the row would be invisible to every reader that looks it up by the derived id.
 */
const DERIVED_ID_BUILDERS: Partial<
	Record<MizanTrackFullBackupTable, (record: MizanTrackFullBackupRecord, userId: string) => string>
> = {
	zakatYears: (record, userId) => buildZakatYearOverrideId(userId, Number(record.islamicYear)),
	zakatGoldYears: (record, userId) =>
		buildZakatGoldYearId(userId, String(record.currency ?? ""), Number(record.islamicYear)),
	zakatGoldYearItems: (record, userId) =>
		buildZakatGoldYearItemId(
			userId,
			String(record.currency ?? ""),
			Number(record.islamicYear),
			String(record.lineageId ?? "")
		),
};

function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
}

function refuse(message: string): never {
	throw new Error(message);
}

function readRecordArray(value: unknown, table: MizanTrackFullBackupTable): unknown[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) {
		refuse(`This backup file is damaged: "${table}" is not a list of records.`);
	}
	return value;
}

/**
 * Validates the whole document before a single row is written, so a malformed or
 * unsupported file is refused outright instead of being partially applied.
 */
export function parseMizanTrackFullBackup(text: string): MizanTrackFullBackupDocument {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		refuse("This file is not a MizanTrack backup — it is not valid JSON.");
	}

	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		refuse("This file is not a MizanTrack backup.");
	}

	const document = parsed as Record<string, unknown>;
	if (document.format !== MIZAN_TRACK_FULL_BACKUP_FORMAT) {
		refuse(
			"This file is not a MizanTrack full backup. Hysab Kytab .db and .xlsx files are imported with the Hysab Kytab option above."
		);
	}

	const formatVersion = document.formatVersion;
	if (typeof formatVersion !== "number" || !Number.isInteger(formatVersion) || formatVersion < 1) {
		refuse("This backup file does not say which format it uses, so it cannot be restored.");
	}
	if (formatVersion > MIZAN_TRACK_FULL_BACKUP_FORMAT_VERSION) {
		refuse(
			`This backup was written in format v${formatVersion}, but this version of MizanTrack only understands up to v${MIZAN_TRACK_FULL_BACKUP_FORMAT_VERSION}. Update MizanTrack and try again. Nothing has been changed.`
		);
	}

	const dexieVersion = typeof document.dexieVersion === "number" ? document.dexieVersion : 0;
	const exportedAt = typeof document.exportedAt === "number" ? document.exportedAt : 0;
	const sourceUserId = typeof document.userId === "string" ? document.userId : "";
	const rawTables = document.tables;
	if (typeof rawTables !== "object" || rawTables === null || Array.isArray(rawTables)) {
		refuse("This backup file is damaged: it carries no tables.");
	}

	const tableSource = rawTables as Record<string, unknown>;
	const tables = {} as Record<MizanTrackFullBackupTable, MizanTrackFullBackupRecord[]>;
	const counts = {} as Record<MizanTrackFullBackupTable, number>;

	for (const table of MIZAN_TRACK_FULL_BACKUP_TABLES) {
		const rows = readRecordArray(tableSource[table], table);
		const records: MizanTrackFullBackupRecord[] = [];

		for (const row of rows) {
			if (typeof row !== "object" || row === null || Array.isArray(row)) {
				refuse(`This backup file is damaged: "${table}" holds something that is not a record.`);
			}
			const record = row as Record<string, unknown>;
			if (typeof record.id !== "string" || record.id.length === 0) {
				refuse(`This backup file is damaged: a "${table}" record has no id.`);
			}
			if (table !== "dbConfig") {
				const updatedAt = record.updatedAt;
				if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) {
					refuse(
						`This backup file is damaged: "${table}" record ${record.id} has no usable last-changed time, so it cannot be merged safely.`
					);
				}
			}
			records.push(record as MizanTrackFullBackupRecord);
		}

		tables[table] = records;
		counts[table] = records.length;
	}

	return {
		format: MIZAN_TRACK_FULL_BACKUP_FORMAT,
		formatVersion,
		dexieVersion,
		exportedAt,
		userId: sourceUserId,
		counts,
		tables,
	};
}

/**
 * Re-homes a record on the signed-in user. Ids are left exactly as written unless the
 * file came from a different account, in which case the two tables whose key embeds the
 * user id have to be rebuilt from the same template that wrote them.
 */
function rehomeRecord(
	table: MizanTrackFullBackupTable,
	record: MizanTrackFullBackupRecord,
	userId: string,
	userIdRemapped: boolean
): MizanTrackFullBackupRecord {
	const buildId = userIdRemapped ? DERIVED_ID_BUILDERS[table] : undefined;
	return {
		...record,
		id: buildId ? buildId(record, userId) : record.id,
		userId,
	};
}

async function restoreSettings(
	record: MizanTrackFullBackupRecord | undefined,
	userId: string
): Promise<string[]> {
	if (!record) return [];

	// `DbConfig` carries no `updatedAt`, so last-write-wins has nothing to compare. It is
	// merged field by field instead: only the preferences the file actually carries are
	// written, and anything this device holds that the file omits — including every
	// secret, which is never exported — is left exactly as it was. Fields already equal
	// are skipped so restoring the same file twice writes nothing.
	const existing = await db.dbConfig.get(userId);
	const patch: Partial<Omit<DbConfig, "id">> = {};
	const restored: string[] = [];
	let changed = false;

	for (const field of MIZAN_TRACK_FULL_BACKUP_DB_CONFIG_FIELDS) {
		const value = record[field];
		if (value === undefined) continue;
		Object.assign(patch, { [field]: value });
		restored.push(field);
		if (JSON.stringify(existing?.[field]) !== JSON.stringify(value)) changed = true;
	}

	if (!changed) return [];
	await upsertDbConfig(userId, patch);
	return restored;
}

async function restoreSyncableTable(
	table: SyncableTable,
	records: readonly MizanTrackFullBackupRecord[],
	onChunk: (done: number) => void
): Promise<MizanTrackFullBackupTableResult> {
	const localTable = getSyncableLocalTable(table);
	let applied = 0;
	let unchanged = 0;
	let skippedOlder = 0;
	let done = 0;

	for (let offset = 0; offset < records.length; offset += RESTORE_CHUNK_SIZE) {
		// Safe: `parseMizanTrackFullBackup` refuses any non-`dbConfig` row without a
		// finite `updatedAt`, so every record here carries the clock the merge needs.
		const chunk = records.slice(
			offset,
			offset + RESTORE_CHUNK_SIZE
		) as unknown as readonly MizanTrackFullBackupVersionedRecord[];
		const locals = await localTable.bulkGet(chunk.map((record) => record.id));
		const winners: MizanTrackFullBackupVersionedRecord[] = [];

		chunk.forEach((incoming, index) => {
			const local = locals[index];
			if (incomingRecordWins(local, incoming)) {
				winners.push(incoming);
				return;
			}
			if (local && local.updatedAt > incoming.updatedAt) skippedOlder += 1;
			else unchanged += 1;
		});

		if (winners.length > 0) {
			// Restored rows are written dirty on purpose. A backup is moved to a device
			// whose Firebase project may hold none of this, and a clean row would never be
			// pushed — the data would live on one device only, which is the failure this
			// whole feature exists to fix. The dirty flag is set explicitly, with Dexie's
			// own hooks suppressed, so skipped rows are left untouched.
			await withoutSyncDirtyTracking(async () => {
				await localTable.bulkPut(
					winners.map((record) => ({ ...record, pendingSync: true }) as never)
				);
			});
			applied += winners.length;
		}

		done += chunk.length;
		onChunk(done);
		await yieldToEventLoop();
	}

	return { table, incoming: records.length, applied, unchanged, skippedOlder };
}

async function collectOrphans(
	tables: Record<MizanTrackFullBackupTable, MizanTrackFullBackupRecord[]>
): Promise<MizanTrackFullBackupOrphanReport[]> {
	const orphans: MizanTrackFullBackupOrphanReport[] = [];

	for (const [table, references] of Object.entries(MIZAN_TRACK_FULL_BACKUP_REFERENCES)) {
		const records = tables[table as MizanTrackFullBackupTable];
		if (!records || records.length === 0) continue;

		for (const reference of references ?? []) {
			const wanted = new Set<string>();
			for (const record of records) {
				const value = record[reference.field];
				if (typeof value === "string" && value.length > 0) wanted.add(value);
			}
			if (wanted.size === 0) continue;

			const targetTable = getSyncableLocalTable(reference.table as SyncableTable);
			const present = await targetTable.bulkGet([...wanted]);
			const missing = present.filter((row) => row === undefined).length;
			if (missing > 0) {
				orphans.push({
					table: table as MizanTrackFullBackupTable,
					field: reference.field,
					references: reference.table,
					count: missing,
				});
			}
		}
	}

	return orphans;
}

export async function restoreMizanTrackFullBackup(
	source: File | string,
	userId: string,
	options: MizanTrackFullBackupRestoreOptions = {}
): Promise<MizanTrackFullBackupRestoreResult> {
	const text = typeof source === "string" ? source : await source.text();
	const document = parseMizanTrackFullBackup(text);
	const userIdRemapped = document.userId !== "" && document.userId !== userId;

	const rehomed = {} as Record<MizanTrackFullBackupTable, MizanTrackFullBackupRecord[]>;
	for (const table of MIZAN_TRACK_FULL_BACKUP_TABLES) {
		rehomed[table] = document.tables[table].map((record) =>
			rehomeRecord(table, record, userId, userIdRemapped)
		);
	}

	const results: MizanTrackFullBackupTableResult[] = [];
	const tablesTotal = MIZAN_TRACK_FULL_BACKUP_TABLES.length;
	let tablesDone = 0;
	let settingsRestored: string[] = [];

	for (const table of MIZAN_TRACK_FULL_BACKUP_TABLES) {
		const records = rehomed[table];
		const report = (recordsDone: number) =>
			options.onProgress?.({
				table,
				tablesDone,
				tablesTotal,
				recordsDone,
				recordsTotal: records.length,
			});

		if (table === "dbConfig") {
			settingsRestored = await restoreSettings(records[0], userId);
			results.push({
				table,
				incoming: records.length,
				applied: settingsRestored.length > 0 ? 1 : 0,
				unchanged: settingsRestored.length > 0 ? 0 : records.length,
				skippedOlder: 0,
			});
		} else {
			results.push(await restoreSyncableTable(table as SyncableTable, records, report));
		}

		tablesDone += 1;
		report(records.length);
	}

	const totalApplied = results.reduce((total, result) => total + result.applied, 0);
	if (totalApplied > 0) {
		// `dashboardStats` is never restored, so the cache on this device still describes
		// the data that was here a moment ago. Drop it and let it rebuild from real rows.
		await invalidateAnalyticsCache(userId);
		scheduleAnalyticsRecompute(userId);
	}

	return {
		formatVersion: document.formatVersion,
		dexieVersion: document.dexieVersion,
		exportedAt: document.exportedAt,
		sourceUserId: document.userId,
		userIdRemapped,
		tables: results,
		totalIncoming: results.reduce((total, result) => total + result.incoming, 0),
		totalApplied,
		settingsRestored,
		orphans: await collectOrphans(rehomed),
	};
}
