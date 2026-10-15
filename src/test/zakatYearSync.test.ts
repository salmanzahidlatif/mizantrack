/**
 * Cross-device sync regression tests for the zakat calendar anchor table (`zakatYears`).
 *
 * Only the 1 Ramaḍān anchor and its provenance are persisted — the twelve months are
 * always recomputed — so these tests check that the anchor survives a push/pull round
 * trip intact and that a reset propagates instead of resurrecting.
 */
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db/local";
import { CORE_SYNC_TABLES, syncAll } from "@/lib/db/sync";
import { buildZakatYearDefinition, toLocalDateKey } from "@/lib/zakatCalendar";
import { saveZakatYearOverride } from "@/lib/zakatYearRepository";

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

function configureRemoteZakatYears(
	firestore: typeof FirestoreModule,
	userId: string,
	docs: { id: string; data: Record<string, unknown> }[]
) {
	vi.mocked(firestore.getDocs).mockImplementation(async (ref: unknown) => {
		const path = (ref as { path?: string }).path;
		if (path === `users/${userId}/zakatYears`) {
			return {
				docs: docs.map((docSnap) => ({ id: docSnap.id, data: () => docSnap.data })),
			} as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
		}
		return { docs: [] } as unknown as Awaited<ReturnType<typeof firestore.getDocs>>;
	});
}

function findWrite(mockSet: ReturnType<typeof vi.fn>, path: string) {
	return mockSet.mock.calls.find(([ref]) => (ref as { path?: string }).path === path)?.[1] as
		| Record<string, unknown>
		| undefined;
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("syncAll — zakat calendar anchors", () => {
	const USER_ID = "zakat-year-sync-user";

	beforeEach(async () => {
		await db.zakatYears.where("userId").equals(USER_ID).delete();
		await db.syncMeta.bulkDelete(coreSyncMetaKeys());
	});

	it("registers zakatYears as a core sync table", () => {
		expect(CORE_SYNC_TABLES).toContain("zakatYears");
	});

	it("pushes a locally saved anchor to Firestore", async () => {
		await markAllTableMigrationsDone();
		await saveZakatYearOverride({
			userId: USER_ID,
			islamicYear: 1447,
			ramadanStart: new Date(2026, 1, 21),
		});

		const { mockSet } = await configureEmptySyncMocks();

		const result = await syncAll(USER_ID);

		expect(result.status).toBe("success");
		expect(result.tables?.zakatYears).toMatchObject({ pushed: 1 });
		expect(findWrite(mockSet, `users/${USER_ID}/zakatYears/${USER_ID}:1447`)).toMatchObject({
			islamicYear: 1447,
			ramadanStart: new Date(2026, 1, 21).getTime(),
			source: "manual",
			deletedAt: null,
		});
		expect(await db.zakatYears.get(`${USER_ID}:1447`)).toMatchObject({ pendingSync: false });
	});

	it("pulls a remote anchor into Dexie and rebuilds the year from it", async () => {
		await markAllTableMigrationsDone();
		const { firestore } = await configureEmptySyncMocks();
		const remoteAnchor = new Date(2027, 1, 11).getTime();

		configureRemoteZakatYears(firestore, USER_ID, [
			{
				id: `${USER_ID}:1448`,
				data: {
					id: `${USER_ID}:1448`,
					userId: USER_ID,
					islamicYear: 1448,
					ramadanStart: remoteAnchor,
					source: "manual",
					deletedAt: null,
					updatedAt: 50_000,
					syncedAt: firestoreTimestamp(5_000),
				},
			},
		]);

		const result = await syncAll(USER_ID);

		expect(result.status).toBe("success");
		expect(result.tables?.zakatYears).toMatchObject({ pulled: 1 });

		const stored = await db.zakatYears.get(`${USER_ID}:1448`);
		expect(stored).toMatchObject({
			islamicYear: 1448,
			ramadanStart: remoteAnchor,
			source: "manual",
			pendingSync: false,
		});
		expect(Object.prototype.hasOwnProperty.call(stored ?? {}, "deletedAt")).toBe(false);
		expect((await db.syncMeta.get("lastSync:zakatYears"))?.timestamp).toBe(5_000);

		const definition = buildZakatYearDefinition(1448, new Date(stored!.ramadanStart));
		expect(toLocalDateKey(definition.months[0]!.startDate)).toBe("2027-02-11");
		expect(definition.months).toHaveLength(12);
	});

	it("propagates a reset as a tombstone instead of resurrecting the anchor", async () => {
		await markAllTableMigrationsDone();
		await db.zakatYears.put({
			id: `${USER_ID}:1449`,
			userId: USER_ID,
			islamicYear: 1449,
			ramadanStart: new Date(2028, 0, 30).getTime(),
			source: "manual",
			deletedAt: 61_000,
			updatedAt: 61_000,
		});

		const { mockSet } = await configureEmptySyncMocks();

		await syncAll(USER_ID);

		expect(findWrite(mockSet, `users/${USER_ID}/zakatYears/${USER_ID}:1449`)).toMatchObject({
			deletedAt: 61_000,
		});
	});
});
