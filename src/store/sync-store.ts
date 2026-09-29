import { create } from "zustand";

import { FIRESTORE_DAILY_QUOTA_EXCEEDED_MESSAGE, syncAll } from "@/lib/db/sync";

import type { CORE_SYNC_TABLES, SyncResult } from "@/lib/db/sync";

export interface SyncProgress {
	totalPushed: number;
	totalPulled: number;
}

export interface SyncTableFailure {
	table: (typeof CORE_SYNC_TABLES)[number] | string;
	message: string;
}

export interface SyncErrorDetails {
	message: string;
	tableFailures: SyncTableFailure[];
	lastSuccessfulSync: number | null;
	occurredAt: number;
	quotaExceeded: boolean;
}

interface SyncStore {
	syncing: boolean;
	lastSync: number | null;
	lastSyncUserId: string | null;
	error: string | null;
	syncErrorDetails: SyncErrorDetails | null;
	/** Live counts updated as each table finishes during an active sync. */
	syncProgress: SyncProgress | null;
	/** Final counts from the last completed sync. */
	lastSyncResult: SyncResult | null;
	/**
	 * Timestamp until which auto-sync should be suppressed.
	 * Set to next-day midnight when resource-exhausted is returned.
	 * Prevents the periodic interval from hammering a depleted quota.
	 */
	suppressAutoSyncUntil: number | null;

	triggerSync: (userId: string) => Promise<void>;
	setSyncing: (syncing: boolean) => void;
	setLastSync: (timestamp: number) => void;
	setError: (error: string | null) => void;
}

function nextMidnightMs(): number {
	const d = new Date();
	d.setDate(d.getDate() + 1);
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function toNonEmptyString(value: unknown): string | null {
	return typeof value === "string" && value.trim() ? value : null;
}

function toTableFailure(value: unknown, fallbackTable?: string): SyncTableFailure | null {
	if (typeof value === "string") {
		if (!fallbackTable || !value.trim()) return null;

		return { table: fallbackTable, message: value };
	}

	if (!isRecord(value)) return null;

	const table = toNonEmptyString(value.table) ?? toNonEmptyString(value.name) ?? fallbackTable;
	const scopedTable = table ?? toNonEmptyString(value.scope);
	if (!scopedTable) return null;

	return {
		table: scopedTable,
		message:
			toNonEmptyString(value.message) ??
			toNonEmptyString(value.error) ??
			toNonEmptyString(value.reason) ??
			"Sync failed",
	};
}

function failuresFromUnknown(value: unknown): SyncTableFailure[] {
	if (Array.isArray(value)) {
		return value.flatMap((item) => {
			const failure = toTableFailure(item);
			return failure ? [failure] : [];
		});
	}

	if (!isRecord(value)) return [];

	return Object.entries(value).flatMap(([table, item]) => {
		const failure = toTableFailure(item, table);
		return failure ? [failure] : [];
	});
}

function uniqueFailures(failures: SyncTableFailure[]): SyncTableFailure[] {
	const seen = new Set<string>();

	return failures.filter((failure) => {
		const key = `${failure.table}:${failure.message}`;
		if (seen.has(key)) return false;

		seen.add(key);
		return true;
	});
}

export function collectSyncTableFailures(source: unknown): SyncTableFailure[] {
	if (!isRecord(source)) return [];

	const explicitFailures = [
		...failuresFromUnknown(source.failedTables),
		...failuresFromUnknown(source.tableFailures),
		...failuresFromUnknown(source.tableErrors),
		...failuresFromUnknown(source.errors),
		...failuresFromUnknown(source.failures),
	];
	const tableFailures = isRecord(source.tables)
		? Object.entries(source.tables).flatMap(([table, result]) => {
				if (!isRecord(result)) return [];

				const status = toNonEmptyString(result.status)?.toLowerCase();
				const message =
					toNonEmptyString(result.message) ??
					toNonEmptyString(result.error) ??
					toNonEmptyString(result.reason);
				const failed =
					result.failed === true ||
					result.success === false ||
					result.synced === false ||
					status === "failed" ||
					status === "failure" ||
					status === "error";

				if (!message && !failed) return [];

				return [{ table, message: message ?? "Sync failed" }];
			})
		: [];

	return uniqueFailures([...explicitFailures, ...tableFailures]);
}

function hasQuotaExceeded(source: unknown): boolean {
	if (!isRecord(source)) return false;
	if (Array.isArray(source.errors) && source.errors.some((error) => hasQuotaExceeded(error))) {
		return true;
	}

	const code = toNonEmptyString(source.code)?.toLowerCase();
	const status = toNonEmptyString(source.status)?.toLowerCase();
	const reason = toNonEmptyString(source.reason)?.toLowerCase();
	const message = (
		toNonEmptyString(source.message) ??
		toNonEmptyString(source.error) ??
		""
	).toLowerCase();

	return (
		source.quotaExceeded === true ||
		source.quotaExhausted === true ||
		code === "resource-exhausted" ||
		status === "resource-exhausted" ||
		reason === "resource-exhausted" ||
		message.includes("quota")
	);
}

function getResultErrorMessage(result: SyncResult, tableFailures: SyncTableFailure[]) {
	const resultRecord = result as SyncResult & Record<string, unknown>;
	const status = toNonEmptyString(resultRecord.status)?.toLowerCase();
	const reason = toNonEmptyString(resultRecord.reason);
	const firstFailureMessage = tableFailures[0]?.message ?? null;
	const message =
		toNonEmptyString(resultRecord.message) ??
		toNonEmptyString(resultRecord.error) ??
		firstFailureMessage ??
		(reason !== "no-config" ? reason : null);
	const errorMessages = Array.isArray(result.errors)
		? result.errors
				.map((error) => toNonEmptyString(error.message))
				.filter((errorMessage): errorMessage is string => Boolean(errorMessage))
		: [];

	if (status === "no-config") return null;
	if (hasQuotaExceeded(result)) return FIRESTORE_DAILY_QUOTA_EXCEEDED_MESSAGE;
	if (errorMessages.length > 0) {
		return status === "partial"
			? `Sync partially completed. Failed: ${errorMessages.join("; ")}`
			: errorMessages.join("; ");
	}
	if (message && (tableFailures.length > 0 || result.synced === false || status)) return message;
	if (tableFailures.length > 0) {
		return `Sync failed for ${tableFailures.map(({ table }) => table).join(", ")}`;
	}
	if (
		status === "partial" ||
		status === "partial-success" ||
		status === "failed" ||
		status === "failure" ||
		status === "error"
	) {
		return "Sync failed";
	}

	return null;
}

function createSyncErrorDetails(
	message: string,
	tableFailures: SyncTableFailure[],
	lastSuccessfulSync: number | null,
	source?: unknown
): SyncErrorDetails {
	return {
		message,
		tableFailures,
		lastSuccessfulSync,
		occurredAt: Date.now(),
		quotaExceeded: hasQuotaExceeded(source),
	};
}

export const useSyncStore = create<SyncStore>((set, get) => ({
	syncing: false,
	lastSync: null,
	lastSyncUserId: null,
	error: null,
	syncErrorDetails: null,
	syncProgress: null,
	lastSyncResult: null,
	suppressAutoSyncUntil: null,

	triggerSync: async (userId: string) => {
		set({
			syncing: true,
			lastSyncUserId: userId,
			error: null,
			syncErrorDetails: null,
			syncProgress: { totalPushed: 0, totalPulled: 0 },
		});
		try {
			const result = await syncAll(userId, ({ totalPushed, totalPulled }) => {
				set({ syncProgress: { totalPushed, totalPulled } });
			});
			const tableFailures = collectSyncTableFailures(result);
			const resultError = getResultErrorMessage(result, tableFailures);
			if (resultError) {
				const suppressAutoSyncUntil = hasQuotaExceeded(result)
					? nextMidnightMs()
					: get().suppressAutoSyncUntil;
				set({
					syncing: false,
					error: resultError,
					syncErrorDetails: createSyncErrorDetails(
						resultError,
						tableFailures,
						get().lastSync,
						result
					),
					syncProgress: null,
					lastSyncResult: result,
					suppressAutoSyncUntil,
				});
				return;
			}

			set({
				syncing: false,
				lastSync: Date.now(),
				error: null,
				syncErrorDetails: null,
				syncProgress: null,
				lastSyncResult: result,
			});
		} catch (err) {
			const code = err instanceof Error && "code" in err ? (err as { code: string }).code : null;
			let message: string;
			let suppressAutoSyncUntil: number | null = null;
			if (code === "permission-denied") {
				message = "Sync failed: permission denied. Check your Firestore security rules.";
			} else if (code === "resource-exhausted") {
				message = FIRESTORE_DAILY_QUOTA_EXCEEDED_MESSAGE;
				// Suppress auto-sync until midnight to avoid hammering the quota
				suppressAutoSyncUntil = nextMidnightMs();
			} else {
				message = err instanceof Error ? err.message : "Sync failed";
			}
			set({
				syncing: false,
				error: message,
				syncErrorDetails: createSyncErrorDetails(
					message,
					collectSyncTableFailures(err),
					get().lastSync,
					err
				),
				syncProgress: null,
				suppressAutoSyncUntil,
			});
		}
	},

	setSyncing: (syncing) => set({ syncing }),
	setLastSync: (timestamp) => set({ lastSync: timestamp }),
	setError: (error) =>
		set((state) => ({
			error,
			syncErrorDetails: error
				? createSyncErrorDetails(error, [], state.lastSync, { message: error })
				: null,
		})),
}));
