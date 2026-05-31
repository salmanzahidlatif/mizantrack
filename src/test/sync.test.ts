/**
 * Regression tests for src/lib/db/sync.ts
 * Covers: getFirestoreUsage returns null when Firestore throws (permission-denied)
 */
import { describe, expect, it, vi } from "vitest";

import { getFirestoreUsage } from "@/lib/db/sync";

// Mock the firebase module so tests don't need a real Firebase project
vi.mock("@/lib/db/firebase", () => ({
	getFirestoreForUser: vi.fn(),
}));

// Mock firebase/firestore so we can control what getCountFromServer returns
vi.mock("firebase/firestore", () => ({
	collection: vi.fn((_db: unknown, path: string) => ({ path })),
	getCountFromServer: vi.fn(),
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
