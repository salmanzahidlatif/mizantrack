/**
 * Regression tests for cross-device sync of the Reports input tables
 * (reportAccountTags, reportProjects, reportTransactionTags, reportManualEntries,
 * reportMonthlySalaryRows).
 *
 * Covers: local report tags are pushed to Firestore
 *         remote report records are pulled into Dexie
 *         soft deletes propagate in both directions and do not resurrect
 *         every persisted field survives a push/pull round trip
 *         syncing twice is a no-op the second time
 *
 * Computed report output is never persisted or synced — only these five input tables.
 */
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db/local";
import { CORE_SYNC_TABLES, syncAll } from "@/lib/db/sync";

import type {
	ReportAccountTag,
	ReportManualEntry,
	ReportMonthlySalaryRow,
	ReportProject,
	ReportTransactionTag,
} from "@/types";
import type * as FirestoreModule from "firebase/firestore";

vi.mock("@/lib/db/firebase", () => ({
	getFirestoreForUser: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
	collection: vi.fn((_db: unknown, path: string) => ({ path })),
	getCountFromServer: vi.fn(),
	writeBatch: vi.fn(),
	doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
	getDocs: vi.fn(),
	getDoc: vi.fn(),
	limit: vi.fn((count: number) => ({ type: "limit", count })),
	runTransaction: vi.fn(),
	setDoc: vi.fn(),
	startAfter: vi.fn((docSnap: unknown) => ({ type: "startAfter", docSnap })),
	query: vi.fn(),
	where: vi.fn(),
	orderBy: vi.fn(),
	serverTimestamp: vi.fn(() => ({ __type: "serverTimestamp" })),
}));

const REPORT_SYNC_TABLES = [
	"reportAccountTags",
	"reportProjects",
	"reportTransactionTags",
	"reportManualEntries",
	"reportMonthlySalaryRows",
] as const;

type ReportSyncTable = (typeof REPORT_SYNC_TABLES)[number];

function coreSyncMetaKeys() {
	return [
		"lastSync",
		...CORE_SYNC_TABLES.map((table) => `lastSync:${table}`),
		...CORE_SYNC_TABLES.map((table) => `syncedAtMigration:${table}:v1`),
	];
}

function firestoreTimestamp(millis: number) {
	return { toMillis: () => millis };
}

async function markAllTableMigrationsDone() {
	await db.syncMeta.bulkPut(
		CORE_SYNC_TABLES.map((table) => ({
			id: `syncedAtMigration:${table}:v1`,
			timestamp: 1,
		}))
	);
}

async function configureEmptySyncMocks() {
	const { getFirestoreForUser } = await import("@/lib/db/firebase");
	const firestore = await import("firebase/firestore");
	const mockCommit = vi.fn().mockResolvedValue(undefined);
	const mockSet = vi.fn();
	const batch = { set: mockSet, commit: mockCommit };

	vi.mocked(getFirestoreForUser).mockResolvedValue(
		{} as Awaited<ReturnType<typeof getFirestoreForUser>>
	);
	vi.mocked(firestore.writeBatch).mockReturnValue(
		batch as unknown as ReturnType<typeof firestore.writeBatch>
	);
	vi.mocked(firestore.getDocs).mockResolvedValue({ docs: [] } as unknown as Awaited<
		ReturnType<typeof firestore.getDocs>
	>);
	vi.mocked(firestore.getDoc).mockResolvedValue({
		exists: () => false,
	} as unknown as Awaited<ReturnType<typeof firestore.getDoc>>);
	vi.mocked(firestore.getCountFromServer).mockRejectedValue(new Error("count unavailable"));
	vi.mocked(firestore.runTransaction).mockImplementation(async (_db, updateFunction) => {
		const transaction = {
			get: vi.fn().mockResolvedValue({ exists: () => false }),
			set: vi.fn(),
		} as unknown as Parameters<typeof updateFunction>[0];
		return updateFunction(transaction) as unknown as ReturnType<typeof firestore.runTransaction>;
	});
	vi.mocked(firestore.query).mockImplementation(((ref: unknown) => ref) as typeof firestore.query);
	vi.mocked(firestore.where).mockReturnValue({} as unknown as ReturnType<typeof firestore.where>);
	vi.mocked(firestore.collection).mockImplementation(((_db: unknown, path: string) => ({
		path,
	})) as typeof firestore.collection);

	return { firestore, mockCommit, mockSet };
}

/** Serves one page of remote docs per Firestore collection path. */
function configureRemoteDocsByTable(
	firestore: typeof FirestoreModule,
	userId: string,
	docsByTable: Partial<Record<ReportSyncTable, { id: string; data: Record<string, unknown> }[]>>
) {
	vi.mocked(firestore.getDocs).mockImplementation(async (ref: unknown) => {
		const path = (ref as { path?: string }).path;
		for (const [table, docs] of Object.entries(docsByTable)) {
			if (path === `users/${userId}/${table}`) {
				return {
					docs: (docs ?? []).map((docSnap) => ({
						id: docSnap.id,
						data: () => docSnap.data,
					})),
				} as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
			}
		}
		return { docs: [] } as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
	});
}

function findWrite(mockSet: ReturnType<typeof vi.fn>, path: string) {
	return mockSet.mock.calls.find(([ref]) => (ref as { path?: string }).path === path)?.[1] as
		| Record<string, unknown>
		| undefined;
}

async function clearReportTables(userId: string) {
	for (const table of REPORT_SYNC_TABLES) {
		await db[table].where("userId").equals(userId).delete();
	}
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("syncAll — report tables are registered for sync", () => {
	it("reportTables_AreRegisteredAsCoreSyncTables", () => {
		for (const table of REPORT_SYNC_TABLES) {
			expect(CORE_SYNC_TABLES).toContain(table);
		}
	});
});

describe("syncAll — report transaction tags", () => {
	const USER_ID = "report-sync-tag-user";

	beforeEach(async () => {
		await clearReportTables(USER_ID);
		await db.syncMeta.bulkDelete(coreSyncMetaKeys());
	});

	it("syncAll_LocalReportTransactionTag_IsPushedToFirestore", async () => {
		await markAllTableMigrationsDone();
		await db.reportTransactionTags.put({
			id: "tag-local",
			userId: USER_ID,
			transactionId: "txn-1",
			role: "remittance",
			confirmed: true,
			updatedAt: 10_000,
		});

		const { mockSet } = await configureEmptySyncMocks();

		const result = await syncAll(USER_ID);

		expect(result.status).toBe("success");
		expect(result.tables?.reportTransactionTags).toMatchObject({ pushed: 1 });
		expect(mockSet).toHaveBeenCalledWith(
			expect.objectContaining({
				path: `users/${USER_ID}/reportTransactionTags/tag-local`,
			}),
			expect.objectContaining({
				transactionId: "txn-1",
				role: "remittance",
				confirmed: true,
				updatedAt: 10_000,
				projectId: null,
				deletedAt: null,
			}),
			{ merge: true }
		);
		expect(await db.reportTransactionTags.get("tag-local")).toMatchObject({ pendingSync: false });
	});

	it("syncAll_RemoteReportTransactionTag_IsPulledIntoDexie", async () => {
		await markAllTableMigrationsDone();
		const { firestore } = await configureEmptySyncMocks();

		configureRemoteDocsByTable(firestore, USER_ID, {
			reportTransactionTags: [
				{
					id: "tag-from-mobile",
					data: {
						id: "tag-from-mobile",
						userId: USER_ID,
						transactionId: "txn-mobile",
						role: "plot-payment",
						projectId: "project-1",
						confirmed: true,
						updatedAt: 20_000,
						syncedAt: firestoreTimestamp(2_000),
					},
				},
			],
		});

		const result = await syncAll(USER_ID);

		expect(result.status).toBe("success");
		expect(result.tables?.reportTransactionTags).toMatchObject({ pulled: 1 });
		expect(await db.reportTransactionTags.get("tag-from-mobile")).toMatchObject({
			transactionId: "txn-mobile",
			role: "plot-payment",
			projectId: "project-1",
			confirmed: true,
			updatedAt: 20_000,
			pendingSync: false,
		});
		expect((await db.syncMeta.get("lastSync:reportTransactionTags"))?.timestamp).toBe(2_000);
	});

	it("syncAll_RemoteNullOptionalProjectId_PullsAsUndefinedLocally", async () => {
		await markAllTableMigrationsDone();
		const { firestore } = await configureEmptySyncMocks();

		configureRemoteDocsByTable(firestore, USER_ID, {
			reportTransactionTags: [
				{
					id: "tag-no-project",
					data: {
						id: "tag-no-project",
						userId: USER_ID,
						transactionId: "txn-income",
						role: "income",
						projectId: null,
						confirmed: false,
						deletedAt: null,
						updatedAt: 25_000,
						syncedAt: firestoreTimestamp(2_500),
					},
				},
			],
		});

		await syncAll(USER_ID);

		const tag = await db.reportTransactionTags.get("tag-no-project");
		expect(tag).toMatchObject({ role: "income", confirmed: false });
		expect(Object.prototype.hasOwnProperty.call(tag ?? {}, "projectId")).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(tag ?? {}, "deletedAt")).toBe(false);
	});
});

describe("syncAll — report soft deletes", () => {
	const USER_ID = "report-sync-delete-user";

	beforeEach(async () => {
		await clearReportTables(USER_ID);
		await db.syncMeta.bulkDelete(coreSyncMetaKeys());
	});

	it("syncAll_LocallyDeletedReportTag_PushesTombstoneToFirestore", async () => {
		await markAllTableMigrationsDone();
		await db.reportTransactionTags.put({
			id: "tag-deleted-here",
			userId: USER_ID,
			transactionId: "txn-9",
			role: "remittance",
			confirmed: true,
			deletedAt: 31_000,
			updatedAt: 31_000,
		});

		const { mockSet } = await configureEmptySyncMocks();

		await syncAll(USER_ID);

		expect(
			findWrite(mockSet, `users/${USER_ID}/reportTransactionTags/tag-deleted-here`)
		).toMatchObject({ deletedAt: 31_000 });
	});

	it("syncAll_RemoteDeletedReportTag_SoftDeletesLocallyAndDoesNotResurrect", async () => {
		await markAllTableMigrationsDone();
		await db.reportTransactionTags.put({
			id: "tag-shared",
			userId: USER_ID,
			transactionId: "txn-shared",
			role: "remittance",
			confirmed: true,
			updatedAt: 40_000,
		});

		const { firestore, mockSet } = await configureEmptySyncMocks();
		configureRemoteDocsByTable(firestore, USER_ID, {
			reportTransactionTags: [
				{
					id: "tag-shared",
					data: {
						id: "tag-shared",
						userId: USER_ID,
						transactionId: "txn-shared",
						role: "remittance",
						projectId: null,
						confirmed: true,
						deletedAt: 41_000,
						updatedAt: 41_000,
						syncedAt: firestoreTimestamp(4_100),
					},
				},
			],
		});

		await syncAll(USER_ID);

		expect(await db.reportTransactionTags.get("tag-shared")).toMatchObject({
			deletedAt: 41_000,
			updatedAt: 41_000,
			pendingSync: false,
		});

		// A second sync must not re-push the tombstone nor revive the record.
		mockSet.mockClear();
		await syncAll(USER_ID);

		expect(mockSet).not.toHaveBeenCalled();
		expect(await db.reportTransactionTags.get("tag-shared")).toMatchObject({
			deletedAt: 41_000,
			pendingSync: false,
		});
	});

	it("syncAll_RemoteDeletedAccountTag_PropagatesAcrossDevices", async () => {
		await markAllTableMigrationsDone();
		await db.reportAccountTags.put({
			id: "acct-tag-shared",
			userId: USER_ID,
			accountId: "acc-1",
			includeInReport: true,
			isRemittanceSource: true,
			updatedAt: 50_000,
		});

		const { firestore } = await configureEmptySyncMocks();
		configureRemoteDocsByTable(firestore, USER_ID, {
			reportAccountTags: [
				{
					id: "acct-tag-shared",
					data: {
						id: "acct-tag-shared",
						userId: USER_ID,
						accountId: "acc-1",
						includeInReport: true,
						isRemittanceSource: true,
						deletedAt: 51_000,
						updatedAt: 51_000,
						syncedAt: firestoreTimestamp(5_100),
					},
				},
			],
		});

		await syncAll(USER_ID);

		expect(await db.reportAccountTags.get("acct-tag-shared")).toMatchObject({
			deletedAt: 51_000,
			pendingSync: false,
		});
	});
});

describe("syncAll — report tables round trip", () => {
	const USER_ID = "report-sync-roundtrip-user";

	const accountTag: ReportAccountTag = {
		id: "rt-account-tag",
		userId: USER_ID,
		accountId: "acc-round",
		includeInReport: true,
		isRemittanceSource: false,
		updatedAt: 60_001,
	};
	const project: ReportProject = {
		id: "rt-project",
		userId: USER_ID,
		title: "BWC 7 Marla Overseas Block",
		note: "Instalment plan",
		sortOrder: 3,
		updatedAt: 60_002,
	};
	const transactionTag: ReportTransactionTag = {
		id: "rt-transaction-tag",
		userId: USER_ID,
		transactionId: "txn-round",
		role: "plot-payment",
		projectId: "rt-project",
		confirmed: true,
		updatedAt: 60_003,
	};
	const manualEntry: ReportManualEntry = {
		id: "rt-manual-entry",
		userId: USER_ID,
		label: "Nayatel",
		amount: 4_285,
		currency: "PKR",
		section: "other",
		date: 59_000,
		note: "Annual",
		fiscalYearKey: "2025-2026",
		updatedAt: 60_004,
	};
	const salaryRow: ReportMonthlySalaryRow = {
		id: "rt-salary-row",
		userId: USER_ID,
		fiscalYearKey: "2025-2026",
		monthKey: "2025-07",
		company: "Acme",
		salaryPkr: 500_000,
		salaryUsd: 1_800,
		taxablePkr: 450_000,
		providentFundRefund: 12_000,
		updatedAt: 60_005,
	};

	const seeds: Record<ReportSyncTable, Record<string, unknown>> = {
		reportAccountTags: accountTag as unknown as Record<string, unknown>,
		reportProjects: project as unknown as Record<string, unknown>,
		reportTransactionTags: transactionTag as unknown as Record<string, unknown>,
		reportManualEntries: manualEntry as unknown as Record<string, unknown>,
		reportMonthlySalaryRows: salaryRow as unknown as Record<string, unknown>,
	};

	beforeEach(async () => {
		await clearReportTables(USER_ID);
		await db.syncMeta.bulkDelete(coreSyncMetaKeys());
	});

	it("syncAll_AllFiveReportTables_PreserveEveryFieldAcrossPushAndPull", async () => {
		await markAllTableMigrationsDone();
		// Dexie's creating hook mutates the object it is given, so seed from clones
		// to keep the expected shapes pristine.
		await db.reportAccountTags.put({ ...accountTag });
		await db.reportProjects.put({ ...project });
		await db.reportTransactionTags.put({ ...transactionTag });
		await db.reportManualEntries.put({ ...manualEntry });
		await db.reportMonthlySalaryRows.put({ ...salaryRow });

		const { firestore, mockSet } = await configureEmptySyncMocks();

		const firstResult = await syncAll(USER_ID);
		expect(firstResult.status).toBe("success");

		const pushedByTable = {} as Record<ReportSyncTable, Record<string, unknown>>;
		let syncedAtCounter = 7_000;
		const remoteDocs: Partial<
			Record<ReportSyncTable, { id: string; data: Record<string, unknown> }[]>
		> = {};

		for (const table of REPORT_SYNC_TABLES) {
			const id = seeds[table].id as string;
			const written = findWrite(mockSet, `users/${USER_ID}/${table}/${id}`);
			expect(written).toBeDefined();
			pushedByTable[table] = written!;
			remoteDocs[table] = [
				{
					id,
					data: { ...written!, syncedAt: firestoreTimestamp(++syncedAtCounter) },
				},
			];
		}

		// Every non-sync field must have survived the push untouched.
		for (const table of REPORT_SYNC_TABLES) {
			expect(pushedByTable[table]).toMatchObject(seeds[table]);
			expect(pushedByTable[table]).not.toHaveProperty("pendingSync");
		}

		// Simulate the second device: empty Dexie, same remote documents.
		await clearReportTables(USER_ID);
		await db.syncMeta.bulkDelete(coreSyncMetaKeys());
		await markAllTableMigrationsDone();
		mockSet.mockClear();
		configureRemoteDocsByTable(firestore, USER_ID, remoteDocs);

		const secondResult = await syncAll(USER_ID);

		expect(secondResult.status).toBe("success");
		for (const table of REPORT_SYNC_TABLES) {
			expect(secondResult.tables?.[table]).toMatchObject({ pushed: 0, pulled: 1 });
		}

		expect(await db.reportAccountTags.get(accountTag.id)).toEqual({
			...accountTag,
			pendingSync: false,
		});
		expect(await db.reportProjects.get(project.id)).toEqual({ ...project, pendingSync: false });
		expect(await db.reportTransactionTags.get(transactionTag.id)).toEqual({
			...transactionTag,
			pendingSync: false,
		});
		expect(await db.reportManualEntries.get(manualEntry.id)).toEqual({
			...manualEntry,
			pendingSync: false,
		});
		expect(await db.reportMonthlySalaryRows.get(salaryRow.id)).toEqual({
			...salaryRow,
			pendingSync: false,
		});
	});

	it("syncAll_RunTwiceWithSameRemoteState_IsIdempotent", async () => {
		await markAllTableMigrationsDone();
		const { firestore, mockSet } = await configureEmptySyncMocks();

		let syncedAtCounter = 8_000;
		const remoteDocs: Partial<
			Record<ReportSyncTable, { id: string; data: Record<string, unknown> }[]>
		> = {};
		for (const table of REPORT_SYNC_TABLES) {
			const seed = seeds[table];
			remoteDocs[table] = [
				{
					id: seed.id as string,
					data: { ...seed, syncedAt: firestoreTimestamp(++syncedAtCounter) },
				},
			];
		}
		configureRemoteDocsByTable(firestore, USER_ID, remoteDocs);

		const firstResult = await syncAll(USER_ID);
		for (const table of REPORT_SYNC_TABLES) {
			expect(firstResult.tables?.[table]).toMatchObject({ pushed: 0, pulled: 1 });
		}

		const countsAfterFirst = await Promise.all(
			REPORT_SYNC_TABLES.map((table) => db[table].where("userId").equals(USER_ID).count())
		);
		const snapshotAfterFirst = await Promise.all(
			REPORT_SYNC_TABLES.map((table) => db[table].get(seeds[table].id as string))
		);

		mockSet.mockClear();
		const secondResult = await syncAll(USER_ID);

		expect(secondResult.status).toBe("success");
		expect(mockSet).not.toHaveBeenCalled();
		for (const table of REPORT_SYNC_TABLES) {
			expect(secondResult.tables?.[table]).toMatchObject({ pushed: 0, pulled: 0 });
		}

		const countsAfterSecond = await Promise.all(
			REPORT_SYNC_TABLES.map((table) => db[table].where("userId").equals(USER_ID).count())
		);
		const snapshotAfterSecond = await Promise.all(
			REPORT_SYNC_TABLES.map((table) => db[table].get(seeds[table].id as string))
		);

		expect(countsAfterSecond).toEqual(countsAfterFirst);
		expect(countsAfterSecond).toEqual([1, 1, 1, 1, 1]);
		expect(snapshotAfterSecond).toEqual(snapshotAfterFirst);
	});
});
