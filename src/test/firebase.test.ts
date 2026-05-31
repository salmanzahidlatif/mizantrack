/**
 * Regression tests for src/lib/db/firebase.ts
 * Covers: concurrent getFirestoreForUser calls do not race-delete each other's app
 */
import "fake-indexeddb/auto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// We test the real module, but mock the Firebase SDK so no real network is used.
vi.mock("firebase/app", () => {
	let apps: { name: string; deleted: boolean }[] = [];

	return {
		initializeApp: vi.fn((config: unknown, name: string) => {
			const app = { name, deleted: false };
			apps.push(app);
			return app;
		}),
		deleteApp: vi.fn(async (app: { name: string; deleted: boolean }) => {
			app.deleted = true;
			apps = apps.filter((a) => a.name !== app.name);
		}),
		getApps: vi.fn(() => apps.filter((a) => !a.deleted)),
	};
});

vi.mock("firebase/firestore", () => ({
	getFirestore: vi.fn((app: unknown) => ({ app, _type: "firestore" })),
}));

describe("getFirestoreForUser", () => {
	beforeEach(async () => {
		vi.resetModules();
		const { db } = await import("@/lib/db/local");
		await db.dbConfig.clear();
		await db.dbConfig.put({
			id: "race-user",
			firebaseConfig: JSON.stringify({ apiKey: "k", projectId: "p" }),
			enabled: true,
			currency: "USD",
			fiscalYearStartMonth: 1,
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("concurrentCalls_OnlyInitializeOnce_NoAppDeleted", async () => {
		// Regression: before the promise-lock fix, two concurrent calls both entered
		// the init path; the second call deleteApp'd the first call's app, causing
		// the first call's Firestore instance to become "app/app-deleted".
		const { getFirestoreForUser, resetFirestoreForUser } = await import("@/lib/db/firebase");
		const { initializeApp, deleteApp } = await import("firebase/app");

		// Reset so the instanceMap is empty
		await resetFirestoreForUser("race-user");

		// Fire two concurrent calls — neither should delete the other's app
		const [fs1, fs2] = await Promise.all([
			getFirestoreForUser("race-user"),
			getFirestoreForUser("race-user"),
		]);

		expect(fs1).not.toBeNull();
		expect(fs2).not.toBeNull();
		// Both should be the same Firestore instance (second call awaited the first's promise)
		expect(fs1).toBe(fs2);
		// initializeApp called exactly once — no duplicate init
		expect(initializeApp).toHaveBeenCalledTimes(1);
		// deleteApp not called for the live instance (only for stale HMR instances)
		const deleteCalls = vi.mocked(deleteApp).mock.calls;
		// The live app should not have been deleted
		const liveAppName = `mizantrack-race-user`;
		const deletedLiveApp = deleteCalls.some(
			([app]) =>
				(app as unknown as { name: string }).name === liveAppName &&
				(app as unknown as { deleted: boolean }).deleted
		);
		expect(deletedLiveApp).toBe(false);
	});
});
