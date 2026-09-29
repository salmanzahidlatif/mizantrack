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
		await db.syncMeta.bulkDelete([
			"lastSync",
			...CORE_SYNC_TABLES.map((table) => `lastSync:${table}`),
		]);
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
		await db.syncMeta.bulkDelete([
			"lastSync",
			...CORE_SYNC_TABLES.map((table) => `lastSync:${table}`),
		]);
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

describe("syncAll — per-table watermarks", () => {
	const USER_ID = "sync-watermark-test-user";

	beforeEach(async () => {
		await db.accounts.where("userId").equals(USER_ID).delete();
		await db.categories.where("userId").equals(USER_ID).delete();
		await db.transactions.where("userId").equals(USER_ID).delete();
		await db.syncMeta.bulkDelete([
			"lastSync",
			...CORE_SYNC_TABLES.map((table) => `lastSync:${table}`),
		]);
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

		await expect(syncAll(USER_ID)).rejects.toMatchObject({ code: "resource-exhausted" });
		expect(firstAttemptWrites).toEqual({ accounts: 1, categories: 1, transactions: 1 });
		expect(await db.syncMeta.get("lastSync:accounts")).toBeTruthy();
		expect(await db.syncMeta.get("lastSync:categories")).toBeTruthy();
		expect(await db.syncMeta.get("lastSync:transactions")).toBeUndefined();

		attempt = 2;
		await syncAll(USER_ID);

		expect(secondAttemptWrites).toEqual({ accounts: 0, categories: 0, transactions: 1 });
	});

	it("syncAll_LegacyGlobalLastSync_SeedsPerTableWatermarksWithoutMassResync", async () => {
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

		expect(mockSet).not.toHaveBeenCalled();
		for (const table of CORE_SYNC_TABLES) {
			const meta = await db.syncMeta.get(`lastSync:${table}`);
			expect(meta?.timestamp).toBeGreaterThanOrEqual(legacyLastSync);
		}
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
