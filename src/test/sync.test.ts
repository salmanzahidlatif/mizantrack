/**
 * Regression tests for src/lib/db/sync.ts and src/store/sync-store.ts
 * Covers: getFirestoreUsage returns null when Firestore throws (permission-denied)
 *         syncAll strips undefined fields before Firestore WriteBatch.set()
 *         triggerSync surfaces resource-exhausted as a user-friendly message
 */
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db/local";
import { getFirestoreUsage, syncAll } from "@/lib/db/sync";
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
	query: vi.fn(),
	where: vi.fn(),
}));

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
		await db.syncMeta.delete("lastSync");
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

		const mockCommit = vi.fn().mockResolvedValue(undefined);
		const capturedDocs: Record<string, unknown>[] = [];
		const mockSet = vi.fn((ref: unknown, data: unknown) => {
			capturedDocs.push(data as Record<string, unknown>);
		});
		const mockBatch = { set: mockSet, commit: mockCommit };

		const { getFirestoreForUser } = await import("@/lib/db/firebase");
		const firestore = await import("firebase/firestore");

		vi.mocked(getFirestoreForUser).mockResolvedValue(
			{} as Awaited<ReturnType<typeof getFirestoreForUser>>
		);
		vi.mocked(firestore.writeBatch).mockReturnValue(mockBatch as unknown as ReturnType<typeof firestore.writeBatch>);
		// Return empty snapshot for pull step
		vi.mocked(firestore.getDocs).mockResolvedValue({ docs: [] } as unknown as Awaited<ReturnType<typeof firestore.getDocs>>);
		vi.mocked(firestore.query).mockReturnValue({} as unknown as ReturnType<typeof firestore.query>);
		vi.mocked(firestore.where).mockReturnValue({} as unknown as ReturnType<typeof firestore.where>);
		vi.mocked(firestore.collection).mockReturnValue({} as unknown as ReturnType<typeof firestore.collection>);

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
		expect(error).toContain("quota exceeded");
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
