/**
 * Regression tests for src/lib/db/sync.ts and src/store/sync-store.ts
 * Covers: getFirestoreUsage returns null when Firestore throws (permission-denied)
 *         syncAll strips undefined fields before Firestore WriteBatch.set()
 *         triggerSync surfaces resource-exhausted as a user-friendly message
 */
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db/local";
import {
	CORE_SYNC_TABLES,
	FIRESTORE_DAILY_QUOTA_EXCEEDED_MESSAGE,
	getFirestoreUsage,
	syncAll,
} from "@/lib/db/sync";
import { useSyncStore } from "@/store/sync-store";
// Mock the firebase module so tests don't need a real Firebase project
vi.mock("@/lib/db/firebase", () => ({
	getFirestoreForUser: vi.fn(),
}));

// Mock firebase/firestore so we can control what getCountFromServer returns
vi.mock("firebase/firestore", () => ({
	collection: vi.fn((_db: unknown, path: string) => ({ path })),
	getCountFromServer: vi.fn(),
	writeBatch: vi.fn(),
	doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
	getDocs: vi.fn(),
	getDoc: vi.fn(),
	setDoc: vi.fn(),
	query: vi.fn(),
	where: vi.fn(),
	orderBy: vi.fn(),
	serverTimestamp: vi.fn(() => ({ __type: "serverTimestamp" })),
}));

function createEmptyFirestoreMocks() {
	const mockCommit = vi.fn().mockResolvedValue(undefined);
	const mockSet = vi.fn();

	return {
		mockCommit,
		mockSet,
		batch: { set: mockSet, commit: mockCommit },
	};
}

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
	const { batch, mockCommit, mockSet } = createEmptyFirestoreMocks();

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
	vi.mocked(firestore.query).mockImplementation(((ref: unknown) => ref) as typeof firestore.query);
	vi.mocked(firestore.where).mockReturnValue({} as unknown as ReturnType<typeof firestore.where>);
	vi.mocked(firestore.collection).mockImplementation(((_db: unknown, path: string) => ({
		path,
	})) as typeof firestore.collection);

	return { firestore, mockCommit, mockSet };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("getFirestoreUsage", () => {
	it("getFirestoreUsage_NoConfig_ReturnsNull", async () => {
		const { getFirestoreForUser } = await import("@/lib/db/firebase");
		vi.mocked(getFirestoreForUser).mockResolvedValueOnce(null);

		const result = await getFirestoreUsage("user-1");
		expect(result).toBeNull();
	});

	it("getFirestoreUsage_PermissionDenied_ReturnsNullInsteadOfThrowing", async () => {
		// Regression: before fix, this threw an unhandled promise rejection
		const { getFirestoreForUser } = await import("@/lib/db/firebase");
		const { getCountFromServer } = await import("firebase/firestore");

		vi.mocked(getFirestoreForUser).mockResolvedValueOnce(
			// Return a non-null dummy object to bypass the early return
			{} as Awaited<ReturnType<typeof getFirestoreForUser>>
		);

		const permissionError = Object.assign(new Error("Missing or insufficient permissions."), {
			code: "permission-denied",
			name: "FirebaseError",
		});
		vi.mocked(getCountFromServer).mockRejectedValue(permissionError);

		const result = await getFirestoreUsage("user-1");
		expect(result).toBeNull();
	});

	it("getFirestoreUsage_AnyFirestoreError_ReturnsNull", async () => {
		const { getFirestoreForUser } = await import("@/lib/db/firebase");
		const { getCountFromServer } = await import("firebase/firestore");

		vi.mocked(getFirestoreForUser).mockResolvedValueOnce(
			{} as Awaited<ReturnType<typeof getFirestoreForUser>>
		);
		vi.mocked(getCountFromServer).mockRejectedValue(new Error("Network error"));

		const result = await getFirestoreUsage("user-1");
		expect(result).toBeNull();
	});
});

// ─── syncAll: undefined field stripping ──────────────────────────────────────

describe("syncAll — strip undefined fields", () => {
	const USER_ID = "sync-undefined-test-user";

	beforeEach(async () => {
		await db.transactions.where("userId").equals(USER_ID).delete();
		await db.syncMeta.bulkDelete(coreSyncMetaKeys());
	});

	it("syncAll_TransactionWithUndefinedCategoryId_DoesNotPassUndefinedToFirestore", async () => {
		// Regression: Firestore WriteBatch.set() throws
		// "Unsupported field value: undefined" when categoryId is undefined.
		// After fix, syncAll must strip undefined fields before calling batch.set().

		// Arrange — seed a transaction that has no categoryId (as imported from HK)
		await db.transactions.put({
			id: "txn-no-cat-001",
			userId: USER_ID,
			type: "Expense",
			date: Date.now(),
			amount: 100,
			accountId: "acc-001",
			updatedAt: Date.now(),
			// categoryId intentionally absent (as imported from HK)
		});

		const capturedDocs: Record<string, unknown>[] = [];
		const mockSet = vi.fn((_ref: unknown, data: unknown) => {
			capturedDocs.push(data as Record<string, unknown>);
		});
		const mockCommit = vi.fn().mockResolvedValue(undefined);
		const mockBatch = { set: mockSet, commit: mockCommit };

		const { getFirestoreForUser } = await import("@/lib/db/firebase");
		const firestore = await import("firebase/firestore");

		vi.mocked(getFirestoreForUser).mockResolvedValue(
			{} as Awaited<ReturnType<typeof getFirestoreForUser>>
		);
		vi.mocked(firestore.writeBatch).mockReturnValue(
			mockBatch as unknown as ReturnType<typeof firestore.writeBatch>
		);
		// Return empty snapshot for pull step
		vi.mocked(firestore.getDocs).mockResolvedValue({ docs: [] } as unknown as Awaited<
			ReturnType<typeof firestore.getDocs>
		>);
		vi.mocked(firestore.getDoc).mockResolvedValue({
			exists: () => false,
		} as unknown as Awaited<ReturnType<typeof firestore.getDoc>>);
		vi.mocked(firestore.query).mockReturnValue({} as unknown as ReturnType<typeof firestore.query>);
		vi.mocked(firestore.where).mockReturnValue({} as unknown as ReturnType<typeof firestore.where>);
		vi.mocked(firestore.collection).mockReturnValue(
			{} as unknown as ReturnType<typeof firestore.collection>
		);

		// Act
		await syncAll(USER_ID);

		// Assert — batch.set must have been called
		expect(mockSet).toHaveBeenCalled();

		// Every document passed to batch.set must not contain undefined values
		for (const docData of capturedDocs) {
			const hasUndefined = Object.values(docData).some((v) => v === undefined);
			expect(hasUndefined).toBe(false);
		}
	});
});

describe("syncAll — optional field clearing", () => {
	const USER_ID = "sync-cleared-fields-test-user";

	beforeEach(async () => {
		await db.accounts.where("userId").equals(USER_ID).delete();
		await db.categories.where("userId").equals(USER_ID).delete();
		await db.transactions.where("userId").equals(USER_ID).delete();
		await db.syncMeta.bulkDelete(coreSyncMetaKeys());
	});

	it("syncAll_MissingOptionalFields_WritesNullsSoMergeClearsRemoteValues", async () => {
		await db.categories.put({
			id: "cat-shared",
			userId: USER_ID,
			title: "Groceries",
			type: "Expense",
			updatedAt: 2_000,
		});
		await db.transactions.put({
			id: "txn-expense",
			userId: USER_ID,
			type: "Expense",
			date: 2_000,
			amount: 100,
			accountId: "acc-1",
			updatedAt: 2_000,
		});

		const { mockSet } = await configureEmptySyncMocks();

		await syncAll(USER_ID);

		const categoryWrite = mockSet.mock.calls.find(
			([ref]) => (ref as { path?: string }).path === `users/${USER_ID}/categories/cat-shared`
		);
		const transactionWrite = mockSet.mock.calls.find(
			([ref]) => (ref as { path?: string }).path === `users/${USER_ID}/transactions/txn-expense`
		);

		expect(categoryWrite?.[1]).toMatchObject({
			currency: null,
			icon: null,
			color: null,
			parentId: null,
			deletedAt: null,
		});
		expect(transactionWrite?.[1]).toMatchObject({
			categoryId: null,
			toAccountId: null,
			description: null,
			tags: null,
			place: null,
			travelCurrency: null,
			deletedAt: null,
		});
	});

	it("syncAll_RemoteNullOptionalFields_PullsAsUndefinedLocally", async () => {
		const { firestore } = await configureEmptySyncMocks();

		vi.mocked(firestore.getDocs).mockImplementation(async (ref: unknown) => {
			const path = (ref as { path?: string }).path;
			if (path === `users/${USER_ID}/categories`) {
				return {
					docs: [
						{
							data: () => ({
								id: "cat-remote-shared",
								userId: USER_ID,
								title: "Groceries",
								type: "Expense",
								currency: null,
								updatedAt: 10_000,
							}),
						},
					],
				} as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
			}

			if (path === `users/${USER_ID}/transactions`) {
				return {
					docs: [
						{
							data: () => ({
								id: "txn-remote-expense",
								userId: USER_ID,
								type: "Expense",
								date: 10_000,
								amount: 100,
								accountId: "acc-1",
								categoryId: null,
								toAccountId: null,
								updatedAt: 10_000,
							}),
						},
					],
				} as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
			}

			return { docs: [] } as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
		});

		await syncAll(USER_ID);

		const category = await db.categories.get("cat-remote-shared");
		const transaction = await db.transactions.get("txn-remote-expense");

		expect(category?.currency).toBeUndefined();
		expect(Object.prototype.hasOwnProperty.call(category ?? {}, "currency")).toBe(false);
		expect(transaction?.categoryId).toBeUndefined();
		expect(Object.prototype.hasOwnProperty.call(transaction ?? {}, "categoryId")).toBe(false);
		expect(transaction?.toAccountId).toBeUndefined();
		expect(Object.prototype.hasOwnProperty.call(transaction ?? {}, "toAccountId")).toBe(false);
	});
});

describe("syncAll — source IDs and budgets", () => {
	const USER_ID = "sync-source-budget-test-user";

	beforeEach(async () => {
		await db.accounts.where("userId").equals(USER_ID).delete();
		await db.categories.where("userId").equals(USER_ID).delete();
		await db.transactions.where("userId").equals(USER_ID).delete();
		await db.budgets.where("userId").equals(USER_ID).delete();
		await db.syncMeta.bulkDelete(coreSyncMetaKeys());
	});

	it("syncAll_SourceId_SurvivesPushPullRoundTrip", async () => {
		await db.accounts.put({
			id: "acc-source",
			userId: USER_ID,
			title: "HK Cash",
			openingBalance: 0,
			currency: "PKR",
			isArchived: false,
			sourceId: "hk:PKR:account:19",
			updatedAt: 10_000,
		});

		const { firestore, mockSet } = await configureEmptySyncMocks();
		let syncAttempt = 1;
		const pushedAccount: { current?: Record<string, unknown> } = {};

		vi.mocked(firestore.getDocs).mockImplementation(async (ref: unknown) => {
			const path = (ref as { path?: string }).path;
			if (syncAttempt === 2 && path === `users/${USER_ID}/accounts` && pushedAccount.current) {
				return {
					docs: [
						{
							id: "acc-source",
							data: () => ({
								...pushedAccount.current,
								syncedAt: firestoreTimestamp(2_000),
							}),
						},
					],
				} as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
			}

			return { docs: [] } as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
		});

		await syncAll(USER_ID);

		const accountWrite = mockSet.mock.calls.find(
			([ref]) => (ref as { path?: string }).path === `users/${USER_ID}/accounts/acc-source`
		);
		pushedAccount.current = accountWrite?.[1] as Record<string, unknown> | undefined;
		expect(pushedAccount.current).toMatchObject({ sourceId: "hk:PKR:account:19" });

		await db.accounts.delete("acc-source");
		syncAttempt = 2;
		mockSet.mockClear();

		await syncAll(USER_ID);

		expect(await db.accounts.get("acc-source")).toMatchObject({
			sourceId: "hk:PKR:account:19",
			pendingSync: false,
		});
	});

	it("syncAll_Budgets_PushesAndPullsThroughCoreSync", async () => {
		await markAllTableMigrationsDone();
		await db.budgets.put({
			id: "budget-local",
			userId: USER_ID,
			categoryId: "cat-food",
			period: "2026-10",
			amount: 15_000,
			currency: "PKR",
			active: true,
			sourceId: "hk:PKR:budget:17",
			updatedAt: 20_000,
		});

		const { firestore, mockSet } = await configureEmptySyncMocks();
		vi.mocked(firestore.getDocs).mockImplementation(async (ref: unknown) => {
			const path = (ref as { path?: string }).path;
			if (path === `users/${USER_ID}/budgets`) {
				return {
					docs: [
						{
							id: "budget-remote",
							data: () => ({
								id: "budget-remote",
								userId: USER_ID,
								categoryId: "cat-rent",
								period: "2026-11",
								amount: 40_000,
								active: false,
								sourceId: "hk:PKR:budget:18",
								updatedAt: 21_000,
								syncedAt: firestoreTimestamp(3_000),
							}),
						},
					],
				} as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
			}

			return { docs: [] } as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
		});

		const result = await syncAll(USER_ID);

		expect(result.tables?.budgets).toMatchObject({ pushed: 1, pulled: 1 });
		expect(mockSet).toHaveBeenCalledWith(
			expect.objectContaining({ path: `users/${USER_ID}/budgets/budget-local` }),
			expect.objectContaining({
				sourceId: "hk:PKR:budget:17",
				currency: "PKR",
				period: "2026-10",
			}),
			{ merge: true }
		);
		expect(await db.budgets.get("budget-remote")).toMatchObject({
			amount: 40_000,
			sourceId: "hk:PKR:budget:18",
			pendingSync: false,
		});
	});

	it("syncAll_RecordWithoutSourceId_OmitsSourceIdAndPullsAsBefore", async () => {
		await markAllTableMigrationsDone();
		await db.accounts.put({
			id: "acc-no-source",
			userId: USER_ID,
			title: "Manual Cash",
			openingBalance: 25,
			currency: "AED",
			isArchived: false,
			updatedAt: 30_000,
		});

		const { firestore, mockSet } = await configureEmptySyncMocks();
		vi.mocked(firestore.getDocs).mockImplementation(async (ref: unknown) => {
			const path = (ref as { path?: string }).path;
			if (path === `users/${USER_ID}/categories`) {
				return {
					docs: [
						{
							id: "cat-no-source",
							data: () => ({
								id: "cat-no-source",
								userId: USER_ID,
								title: "Manual Food",
								type: "Expense",
								updatedAt: 31_000,
								syncedAt: firestoreTimestamp(4_000),
							}),
						},
					],
				} as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
			}

			return { docs: [] } as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
		});

		await syncAll(USER_ID);

		const accountWrite = mockSet.mock.calls.find(
			([ref]) => (ref as { path?: string }).path === `users/${USER_ID}/accounts/acc-no-source`
		);
		expect(accountWrite?.[1]).not.toHaveProperty("sourceId");

		const category = await db.categories.get("cat-no-source");
		expect(category).toMatchObject({ title: "Manual Food" });
		expect(category).not.toHaveProperty("sourceId");
	});
});

describe("syncAll — per-table watermarks", () => {
	const USER_ID = "sync-watermark-test-user";

	beforeEach(async () => {
		await db.accounts.where("userId").equals(USER_ID).delete();
		await db.categories.where("userId").equals(USER_ID).delete();
		await db.transactions.where("userId").equals(USER_ID).delete();
		await db.syncMeta.bulkDelete(coreSyncMetaKeys());
	});

	it("syncAll_PartialFailure_DoesNotRepushSucceededTablesOnRetry", async () => {
		await db.accounts.put({
			id: "acc-1",
			userId: USER_ID,
			title: "Cash",
			openingBalance: 0,
			currency: "PKR",
			isArchived: false,
			updatedAt: 1_000,
		});
		await db.categories.put({
			id: "cat-1",
			userId: USER_ID,
			title: "Food",
			type: "Expense",
			updatedAt: 1_000,
		});
		await db.transactions.put({
			id: "txn-1",
			userId: USER_ID,
			type: "Expense",
			date: 1_000,
			amount: 100,
			accountId: "acc-1",
			categoryId: "cat-1",
			updatedAt: 1_000,
		});

		const { getFirestoreForUser } = await import("@/lib/db/firebase");
		const firestore = await import("firebase/firestore");
		const firstAttemptWrites: Record<string, number> = {
			accounts: 0,
			categories: 0,
			transactions: 0,
		};
		const secondAttemptWrites: Record<string, number> = {
			accounts: 0,
			categories: 0,
			transactions: 0,
		};
		let attempt = 1;
		const batchState = new WeakMap<
			object,
			{ table: keyof typeof firstAttemptWrites; writes: number }
		>();

		vi.mocked(getFirestoreForUser).mockResolvedValue(
			{} as Awaited<ReturnType<typeof getFirestoreForUser>>
		);
		vi.mocked(firestore.collection).mockImplementation(((_db: unknown, path: string) => ({
			path,
		})) as typeof firestore.collection);
		vi.mocked(firestore.query).mockImplementation(
			((ref: unknown) => ref) as typeof firestore.query
		);
		vi.mocked(firestore.where).mockReturnValue({} as unknown as ReturnType<typeof firestore.where>);
		vi.mocked(firestore.getDocs).mockResolvedValue({ docs: [] } as unknown as Awaited<
			ReturnType<typeof firestore.getDocs>
		>);
		vi.mocked(firestore.getDoc).mockResolvedValue({
			exists: () => false,
		} as unknown as Awaited<ReturnType<typeof firestore.getDoc>>);
		vi.mocked(firestore.doc).mockImplementation(((_db: unknown, ...segments: string[]) => ({
			path: segments.join("/"),
		})) as typeof firestore.doc);
		vi.mocked(firestore.writeBatch).mockImplementation((() => {
			const batch = {
				set: vi.fn((ref: { path: string }) => {
					const [, , tableSegment] = ref.path.split("/");
					if (!tableSegment) {
						throw new Error(`Unexpected Firestore path: ${ref.path}`);
					}
					const table = tableSegment as keyof typeof firstAttemptWrites;
					const current = batchState.get(batch);
					if (current) {
						current.writes += 1;
					} else {
						batchState.set(batch, { table, writes: 1 });
					}
				}),
				commit: vi.fn(async () => {
					const current = batchState.get(batch);
					if (!current) return;
					const writes = current.writes;
					if (attempt === 1) {
						firstAttemptWrites[current.table] = (firstAttemptWrites[current.table] ?? 0) + writes;
						if (current.table === "transactions") {
							throw Object.assign(new Error("Quota exceeded."), {
								code: "resource-exhausted",
								name: "FirebaseError",
							});
						}
					} else {
						secondAttemptWrites[current.table] = (secondAttemptWrites[current.table] ?? 0) + writes;
					}
				}),
			};
			return batch as unknown as ReturnType<typeof firestore.writeBatch>;
		}) as typeof firestore.writeBatch);

		const firstResult = await syncAll(USER_ID);
		expect(firstResult.status).toBe("partial");
		expect(firstResult.errors).toEqual([
			expect.objectContaining({
				scope: "transactions",
				phase: "migration",
				code: "resource-exhausted",
				quotaExceeded: true,
				message: FIRESTORE_DAILY_QUOTA_EXCEEDED_MESSAGE,
			}),
		]);
		expect(firstAttemptWrites).toEqual({ accounts: 1, categories: 1, transactions: 1 });
		expect(await db.syncMeta.get("lastSync:accounts")).toBeTruthy();
		expect(await db.syncMeta.get("lastSync:categories")).toBeTruthy();
		expect(await db.syncMeta.get("lastSync:transactions")).toBeUndefined();

		attempt = 2;
		await syncAll(USER_ID);

		expect(secondAttemptWrites).toEqual({ accounts: 0, categories: 0, transactions: 1 });
	});

	it("syncAll_LegacyGlobalLastSync_BackfillsLocalRecordsForServerCursorMigration", async () => {
		const legacyLastSync = 5_000;
		await db.syncMeta.put({ id: "lastSync", timestamp: legacyLastSync });
		await db.accounts.put({
			id: "acc-old",
			userId: USER_ID,
			title: "Old Cash",
			openingBalance: 0,
			currency: "PKR",
			isArchived: false,
			updatedAt: legacyLastSync - 100,
		});
		await db.categories.put({
			id: "cat-old",
			userId: USER_ID,
			title: "Old Food",
			type: "Expense",
			updatedAt: legacyLastSync - 100,
		});
		await db.transactions.put({
			id: "txn-old",
			userId: USER_ID,
			type: "Expense",
			date: legacyLastSync - 100,
			amount: 50,
			accountId: "acc-old",
			categoryId: "cat-old",
			updatedAt: legacyLastSync - 100,
		});

		const { mockSet } = await configureEmptySyncMocks();

		await syncAll(USER_ID);

		expect(mockSet).toHaveBeenCalledTimes(3);
		for (const table of CORE_SYNC_TABLES) {
			const meta = await db.syncMeta.get(`lastSync:${table}`);
			expect(meta?.timestamp).toBe(0);
			expect(await db.syncMeta.get(`syncedAtMigration:${table}:v1`)).toBeTruthy();
		}
	});
});

describe("syncAll — server syncedAt cursors", () => {
	const USER_ID = "sync-server-cursor-test-user";

	beforeEach(async () => {
		await db.accounts.where("userId").equals(USER_ID).delete();
		await db.categories.where("userId").equals(USER_ID).delete();
		await db.transactions.where("userId").equals(USER_ID).delete();
		await db.syncMeta.bulkDelete(coreSyncMetaKeys());
	});

	async function markMigrationDone() {
		await db.syncMeta.bulkPut(
			CORE_SYNC_TABLES.map((table) => ({
				id: `syncedAtMigration:${table}:v1`,
				timestamp: 1,
			}))
		);
	}

	it("syncAll_RemoteUpdatedAtBehindLocalCursor_PullsByServerSyncedAt", async () => {
		await markMigrationDone();
		await db.syncMeta.put({ id: "lastSync:accounts", timestamp: 1_000 });
		const { firestore } = await configureEmptySyncMocks();

		vi.mocked(firestore.getDocs).mockImplementation(async (ref: unknown) => {
			const path = (ref as { path?: string }).path;
			if (path === `users/${USER_ID}/accounts`) {
				return {
					docs: [
						{
							id: "acc-android",
							data: () => ({
								id: "acc-android",
								userId: USER_ID,
								title: "Android Cash",
								openingBalance: 500,
								currency: "PKR",
								isArchived: false,
								updatedAt: 940,
								syncedAt: firestoreTimestamp(1_200),
							}),
						},
					],
				} as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
			}

			return { docs: [] } as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
		});

		const result = await syncAll(USER_ID);

		expect(result.status).toBe("success");
		expect(await db.accounts.get("acc-android")).toMatchObject({
			openingBalance: 500,
			updatedAt: 940,
			pendingSync: false,
		});
		expect((await db.syncMeta.get("lastSync:accounts"))?.timestamp).toBe(1_200);
	});

	it("syncAll_PulledFutureClockRecord_DoesNotRepushOnNextSync", async () => {
		await markMigrationDone();
		const { firestore, mockSet } = await configureEmptySyncMocks();
		let syncAttempt = 1;

		vi.mocked(firestore.getDocs).mockImplementation(async (ref: unknown) => {
			const path = (ref as { path?: string }).path;
			if (syncAttempt === 1 && path === `users/${USER_ID}/transactions`) {
				return {
					docs: [
						{
							id: "txn-future-clock",
							data: () => ({
								id: "txn-future-clock",
								userId: USER_ID,
								type: "Expense",
								date: 1_000,
								amount: 75,
								accountId: "acc-1",
								updatedAt: 999_999,
								syncedAt: firestoreTimestamp(2_000),
							}),
						},
					],
				} as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
			}

			return { docs: [] } as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
		});

		await syncAll(USER_ID);
		syncAttempt = 2;
		mockSet.mockClear();
		await syncAll(USER_ID);

		expect(mockSet).not.toHaveBeenCalled();
		expect(await db.transactions.get("txn-future-clock")).toMatchObject({
			amount: 75,
			pendingSync: false,
		});
	});

	it("syncAll_CategoriesPullFailure_DoesNotBlockTransactionsOrAdvanceCategoryCursor", async () => {
		await markMigrationDone();
		await db.syncMeta.bulkPut([
			{ id: "lastSync:categories", timestamp: 10 },
			{ id: "lastSync:transactions", timestamp: 10 },
		]);
		const { firestore } = await configureEmptySyncMocks();

		vi.mocked(firestore.getDocs).mockImplementation(async (ref: unknown) => {
			const path = (ref as { path?: string }).path;
			if (path === `users/${USER_ID}/categories`) {
				throw new Error("Sync timed out while pulling categories");
			}
			if (path === `users/${USER_ID}/transactions`) {
				return {
					docs: [
						{
							id: "txn-after-category-failure",
							data: () => ({
								id: "txn-after-category-failure",
								userId: USER_ID,
								type: "Income",
								date: 2_000,
								amount: 300,
								accountId: "acc-1",
								updatedAt: 2_000,
								syncedAt: firestoreTimestamp(20),
							}),
						},
					],
				} as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
			}

			return { docs: [] } as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
		});

		const result = await syncAll(USER_ID);

		expect(result.status).toBe("partial");
		expect(result.errors).toEqual([
			expect.objectContaining({
				scope: "categories",
				phase: "pull",
				message: "Sync timed out while pulling categories",
			}),
		]);
		expect(await db.transactions.get("txn-after-category-failure")).toMatchObject({
			amount: 300,
		});
		expect((await db.syncMeta.get("lastSync:categories"))?.timestamp).toBe(10);
		expect((await db.syncMeta.get("lastSync:transactions"))?.timestamp).toBe(20);
	});

	it("syncAll_ServerCursorMigration_IsIdempotentAndPreservesSoftDeletes", async () => {
		await db.accounts.put({
			id: "acc-remote-deleted",
			userId: USER_ID,
			title: "Old Local",
			openingBalance: 100,
			currency: "PKR",
			isArchived: false,
			updatedAt: 1_000,
		});
		await db.accounts.put({
			id: "acc-local-deleted",
			userId: USER_ID,
			title: "Local Tombstone",
			openingBalance: 0,
			currency: "PKR",
			isArchived: false,
			updatedAt: 3_000,
			deletedAt: 3_000,
		});

		const { firestore, mockSet } = await configureEmptySyncMocks();
		let accountMigrationCalls = 0;
		vi.mocked(firestore.getDocs).mockImplementation(async (ref: unknown) => {
			const path = (ref as { path?: string }).path;
			if (path === `users/${USER_ID}/accounts` && accountMigrationCalls === 0) {
				accountMigrationCalls++;
				return {
					docs: [
						{
							id: "acc-remote-deleted",
							data: () => ({
								id: "acc-remote-deleted",
								userId: USER_ID,
								title: "Remote Tombstone",
								openingBalance: 100,
								currency: "PKR",
								isArchived: false,
								updatedAt: 2_000,
								deletedAt: 2_000,
							}),
						},
					],
				} as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
			}

			return { docs: [] } as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
		});

		await syncAll(USER_ID);
		const firstWriteCount = mockSet.mock.calls.length;
		mockSet.mockClear();
		await syncAll(USER_ID);

		expect(firstWriteCount).toBe(2);
		expect(mockSet).not.toHaveBeenCalled();
		expect(await db.accounts.get("acc-remote-deleted")).toMatchObject({
			title: "Remote Tombstone",
			deletedAt: 2_000,
			pendingSync: false,
		});
		expect(await db.accounts.get("acc-local-deleted")).toMatchObject({
			deletedAt: 3_000,
			pendingSync: false,
		});
		expect(await db.syncMeta.get("syncedAtMigration:accounts:v1")).toBeTruthy();
	});
});

describe("syncAll — dashboard stats sync", () => {
	const USER_ID = "sync-dashboard-stats-test-user";

	beforeEach(async () => {
		await db.dashboardStats.delete(USER_ID);
	});

	it("syncAll_LocalDashboardStatsWithMissingRemote_PushesStatsToFirestore", async () => {
		const localStats = {
			id: USER_ID,
			updatedAt: 10_000,
			balances: { "acc-1": 123 },
			perCurrency: {
				PKR: {
					monthIncome: 100,
					monthExpense: 50,
					trend: [],
				},
			},
			recent: [],
		};
		await db.dashboardStats.put(localStats);

		const { firestore } = await configureEmptySyncMocks();
		const setDocSpy = vi.mocked(firestore.setDoc).mockResolvedValue(undefined);

		await syncAll(USER_ID);

		expect(setDocSpy).toHaveBeenCalledWith(
			expect.objectContaining({ path: `users/${USER_ID}/analytics/dashboard` }),
			localStats
		);
	});

	it("syncAll_RemoteDashboardStatsNewerThanLocal_PullsStatsWithoutRepushing", async () => {
		await db.dashboardStats.put({
			id: USER_ID,
			updatedAt: 5_000,
			balances: { "acc-1": 10 },
			perCurrency: {
				PKR: {
					monthIncome: 10,
					monthExpense: 5,
					trend: [],
				},
			},
			recent: [],
		});

		const remoteStats = {
			id: USER_ID,
			updatedAt: 9_000,
			balances: { "acc-1": 999 },
			perCurrency: {
				PKR: {
					monthIncome: 200,
					monthExpense: 100,
					trend: [],
				},
			},
			recent: [],
		};

		const { firestore } = await configureEmptySyncMocks();
		vi.mocked(firestore.getDoc).mockImplementation(async (ref: { path?: string }) => {
			if (ref.path === `users/${USER_ID}/analytics/dashboard`) {
				return {
					exists: () => true,
					data: () => remoteStats,
				} as unknown as Awaited<ReturnType<typeof firestore.getDoc>>;
			}

			return {
				exists: () => false,
			} as unknown as Awaited<ReturnType<typeof firestore.getDoc>>;
		});
		const setDocSpy = vi.mocked(firestore.setDoc).mockResolvedValue(undefined);

		await syncAll(USER_ID);

		expect(await db.dashboardStats.get(USER_ID)).toEqual(remoteStats);
		expect(setDocSpy).not.toHaveBeenCalled();
	});
});

// ─── triggerSync: error code handling ────────────────────────────────────────

describe("triggerSync — error code messages", () => {
	it("triggerSync_ResourceExhausted_SurfacesFriendlyQuotaMessage", async () => {
		// Regression: before fix, resource-exhausted showed the raw Firebase SDK message.
		// After fix, the store surfaces a human-readable message about daily quota.
		const { getFirestoreForUser } = await import("@/lib/db/firebase");

		const quotaError = Object.assign(new Error("Quota exceeded."), {
			code: "resource-exhausted",
			name: "FirebaseError",
		});
		vi.mocked(getFirestoreForUser).mockRejectedValueOnce(quotaError);

		// Reset store state before test
		useSyncStore.setState({ syncing: false, error: null, lastSync: null });

		await useSyncStore.getState().triggerSync("user-quota-test");

		const { syncing, error } = useSyncStore.getState();
		expect(syncing).toBe(false);
		expect(error).toBe(FIRESTORE_DAILY_QUOTA_EXCEEDED_MESSAGE);
	});

	it("triggerSync_PermissionDenied_SurfacesFriendlyPermissionMessage", async () => {
		const { getFirestoreForUser } = await import("@/lib/db/firebase");

		const permError = Object.assign(new Error("Missing or insufficient permissions."), {
			code: "permission-denied",
			name: "FirebaseError",
		});
		vi.mocked(getFirestoreForUser).mockRejectedValueOnce(permError);

		useSyncStore.setState({ syncing: false, error: null, lastSync: null });

		await useSyncStore.getState().triggerSync("user-perm-test");

		const { error } = useSyncStore.getState();
		expect(error).toContain("permission denied");
	});
});

// ─── syncAll: progress counts ────────────────────────────────────────────────

describe("syncAll — progress counts", () => {
	it("syncAll_NoConfig_ReturnsZeroCounts", async () => {
		const { getFirestoreForUser } = await import("@/lib/db/firebase");
		vi.mocked(getFirestoreForUser).mockResolvedValueOnce(null);

		const result = await syncAll("user-no-cfg");
		expect(result.synced).toBe(false);
		expect(result.totalPushed).toBe(0);
		expect(result.totalPulled).toBe(0);
	});

	it("triggerSync_Success_StoresLastSyncResultWithCounts", async () => {
		// After a successful sync, lastSyncResult in the store must reflect the
		// pushed/pulled counts returned by syncAll.
		const { getFirestoreForUser } = await import("@/lib/db/firebase");
		vi.mocked(getFirestoreForUser).mockReset();
		await configureEmptySyncMocks();

		useSyncStore.setState({ syncing: false, error: null, lastSync: null, lastSyncResult: null });

		await useSyncStore.getState().triggerSync("user-counts-test");

		const { lastSyncResult } = useSyncStore.getState();
		expect(lastSyncResult).not.toBeNull();
		expect(typeof lastSyncResult?.totalPushed).toBe("number");
		expect(typeof lastSyncResult?.totalPulled).toBe("number");
	});
});
