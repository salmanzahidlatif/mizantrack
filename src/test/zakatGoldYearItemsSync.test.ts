/**
 * Cross-device sync regression tests for the per-year gold holdings table
 * (`zakatGoldYearItems`).
 *
 * The holding a year was assessed on is data the owner typed, so it has to survive a
 * push/pull round trip intact: a piece sold in one year must travel as a tombstone
 * rather than reading as "unchanged" on the other device, a piece's lineage must arrive
 * unaltered so the same necklace stays the same necklace, and the provenance of a piece
 * seeded from the shared holding must not be cleared by a merge.
 */
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db/local";
import { CORE_SYNC_TABLES, syncAll } from "@/lib/db/sync";
import {
	clearZakatGoldYearItemSold,
	deleteZakatGoldYearItem,
	listZakatGoldYearItemsForYear,
	listZakatGoldYearItemsHeldInYear,
	markZakatGoldYearItemSold,
	saveZakatGoldYearItem,
} from "@/lib/zakatGoldYearItemRepository";

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

function configureRemoteGoldYearItems(
	firestore: typeof FirestoreModule,
	userId: string,
	docs: { id: string; data: Record<string, unknown> }[]
) {
	vi.mocked(firestore.getDocs).mockImplementation(async (ref: unknown) => {
		const path = (ref as { path?: string }).path;
		if (path === `users/${userId}/zakatGoldYearItems`) {
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

describe("syncAll — gold held by year", () => {
	const USER_ID = "zakat-gold-year-items-sync-user";

	beforeEach(async () => {
		await db.zakatGoldYearItems.where("userId").equals(USER_ID).delete();
		await db.syncMeta.bulkDelete(coreSyncMetaKeys());
	});

	it("registers zakatGoldYearItems as a core sync table", () => {
		expect(CORE_SYNC_TABLES).toContain("zakatGoldYearItems");
	});

	it("pushes a year's holding to Firestore, lineage and all", async () => {
		await markAllTableMigrationsDone();
		await saveZakatGoldYearItem({
			userId: USER_ID,
			currency: "PKR",
			islamicYear: 1444,
			lineageId: "wedding-set",
			title: "Wedding Set",
			weight: 100,
			purity: "21k",
		});

		const { mockSet } = await configureEmptySyncMocks();

		const result = await syncAll(USER_ID);

		expect(result.status).toBe("success");
		expect(result.tables?.zakatGoldYearItems).toMatchObject({ pushed: 1 });
		expect(
			findWrite(mockSet, `users/${USER_ID}/zakatGoldYearItems/${USER_ID}:PKR:1444:wedding-set`)
		).toMatchObject({
			islamicYear: 1444,
			currency: "PKR",
			lineageId: "wedding-set",
			title: "Wedding Set",
			weight: 100,
			purity: "21k",
			notes: null,
			deletedAt: null,
		});
		expect(await db.zakatGoldYearItems.get(`${USER_ID}:PKR:1444:wedding-set`)).toMatchObject({
			pendingSync: false,
		});
	});

	it("pulls a remote year's holding into Dexie, ready to value that year", async () => {
		await markAllTableMigrationsDone();
		const { firestore } = await configureEmptySyncMocks();

		configureRemoteGoldYearItems(firestore, USER_ID, [
			{
				id: `${USER_ID}:PKR:1443:bangles`,
				data: {
					id: `${USER_ID}:PKR:1443:bangles`,
					userId: USER_ID,
					currency: "PKR",
					islamicYear: 1443,
					lineageId: "bangles",
					title: "Bangles",
					weight: 68.4,
					purity: "21k",
					notes: null,
					sourceGoldItemId: null,
					createdAt: 10_000,
					deletedAt: null,
					updatedAt: 50_000,
					syncedAt: firestoreTimestamp(5_000),
				},
			},
		]);

		const result = await syncAll(USER_ID);

		expect(result.status).toBe("success");
		expect(result.tables?.zakatGoldYearItems).toMatchObject({ pulled: 1 });

		const stored = await db.zakatGoldYearItems.get(`${USER_ID}:PKR:1443:bangles`);
		expect(stored).toMatchObject({
			islamicYear: 1443,
			currency: "PKR",
			lineageId: "bangles",
			weight: 68.4,
			pendingSync: false,
		});
		// Absent optional fields arrive absent, not as a null the readers have to guard.
		expect(Object.prototype.hasOwnProperty.call(stored ?? {}, "notes")).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(stored ?? {}, "sourceGoldItemId")).toBe(false);
		expect((await db.syncMeta.get("lastSync:zakatGoldYearItems"))?.timestamp).toBe(5_000);
	});

	/**
	 * A piece sold in one year has to travel as an explicit tombstone. An absent field
	 * reads as "unchanged" on the other device, which would leave gold on its books that
	 * the owner no longer holds — and the other years that DID hold it stay untouched.
	 */
	it("propagates a sold piece as a tombstone, leaving the other years alone", async () => {
		await markAllTableMigrationsDone();
		for (const islamicYear of [1443, 1446]) {
			await saveZakatGoldYearItem({
				userId: USER_ID,
				currency: "PKR",
				islamicYear,
				lineageId: "chain",
				title: "Chain",
				weight: 10,
				purity: "21k",
			});
		}
		await deleteZakatGoldYearItem(USER_ID, "PKR", 1446, "chain");

		const { mockSet } = await configureEmptySyncMocks();

		await syncAll(USER_ID);

		const sold = findWrite(
			mockSet,
			`users/${USER_ID}/zakatGoldYearItems/${USER_ID}:PKR:1446:chain`
		);
		expect(sold?.deletedAt).toBeGreaterThan(0);
		const kept = findWrite(
			mockSet,
			`users/${USER_ID}/zakatGoldYearItems/${USER_ID}:PKR:1443:chain`
		);
		expect(kept?.deletedAt).toBeNull();
		expect(await listZakatGoldYearItemsForYear(USER_ID, "PKR", 1443)).toHaveLength(1);
	});

	/**
	 * Where a piece came from is provenance, like `sourceId` on an account: it is never
	 * pushed as a null and an incoming null never lands as one, so a merge cannot cut a
	 * piece loose from the holding it was seeded from.
	 */
	it("never writes the provenance of a piece as null", async () => {
		await markAllTableMigrationsDone();
		await db.zakatGoldYearItems.bulkPut([
			{
				id: `${USER_ID}:PKR:1445:gold-1`,
				userId: USER_ID,
				currency: "PKR",
				islamicYear: 1445,
				lineageId: "gold-1",
				title: "Wedding Set",
				weight: 100,
				purity: "21k",
				sourceGoldItemId: "gold-1",
				createdAt: 10_000,
				updatedAt: 20_000,
				pendingSync: true,
			},
			{
				id: `${USER_ID}:PKR:1445:typed-in`,
				userId: USER_ID,
				currency: "PKR",
				islamicYear: 1445,
				lineageId: "typed-in",
				title: "New Bangle",
				weight: 14,
				purity: "22k",
				createdAt: 11_000,
				updatedAt: 20_000,
				pendingSync: true,
			},
		]);

		const { firestore, mockSet } = await configureEmptySyncMocks();
		configureRemoteGoldYearItems(firestore, USER_ID, [
			{
				id: `${USER_ID}:PKR:1446:pulled`,
				data: {
					id: `${USER_ID}:PKR:1446:pulled`,
					userId: USER_ID,
					currency: "PKR",
					islamicYear: 1446,
					lineageId: "pulled",
					title: "Chain",
					weight: 10,
					purity: "21k",
					sourceGoldItemId: null,
					createdAt: 12_000,
					deletedAt: null,
					updatedAt: 90_000,
					syncedAt: firestoreTimestamp(9_000),
				},
			},
		]);

		await syncAll(USER_ID);

		expect(
			findWrite(mockSet, `users/${USER_ID}/zakatGoldYearItems/${USER_ID}:PKR:1445:gold-1`)
		).toMatchObject({ sourceGoldItemId: "gold-1" });
		expect(
			findWrite(mockSet, `users/${USER_ID}/zakatGoldYearItems/${USER_ID}:PKR:1445:typed-in`)
		).not.toHaveProperty("sourceGoldItemId");

		const pulled = await db.zakatGoldYearItems.get(`${USER_ID}:PKR:1446:pulled`);
		expect(pulled).toMatchObject({ title: "Chain", weight: 10 });
		expect(pulled).not.toHaveProperty("sourceGoldItemId");
	});

	/**
	 * A sale is recorded once, on one row, and every later year reads it from there — so
	 * that row is the only thing that carries the sale to the owner's other devices. It
	 * has to arrive as a year, and taking the sale back has to arrive as an explicit null:
	 * an absent field reads as "unchanged" and would leave the gold off the other device's
	 * books with nothing on screen to explain why.
	 */
	it("carries the year a piece was sold in, and clears it as an explicit null", async () => {
		await markAllTableMigrationsDone();
		for (const islamicYear of [1445, 1446]) {
			await saveZakatGoldYearItem({
				userId: USER_ID,
				currency: "PKR",
				islamicYear,
				lineageId: "chain",
				title: "Chain",
				weight: 10,
				purity: "21k",
			});
		}
		await markZakatGoldYearItemSold({
			userId: USER_ID,
			currency: "PKR",
			islamicYear: 1446,
			lineageId: "chain",
		});

		const sold = await configureEmptySyncMocks();
		await syncAll(USER_ID);

		expect(
			findWrite(sold.mockSet, `users/${USER_ID}/zakatGoldYearItems/${USER_ID}:PKR:1446:chain`)
		).toMatchObject({ soldInIslamicYear: 1446, deletedAt: null });
		// The year that still holds it says so, rather than saying nothing.
		expect(
			findWrite(sold.mockSet, `users/${USER_ID}/zakatGoldYearItems/${USER_ID}:PKR:1445:chain`)
		).toMatchObject({ soldInIslamicYear: null });

		vi.clearAllMocks();
		await clearZakatGoldYearItemSold({ userId: USER_ID, currency: "PKR", lineageId: "chain" });

		const unsold = await configureEmptySyncMocks();
		await syncAll(USER_ID);

		expect(
			findWrite(unsold.mockSet, `users/${USER_ID}/zakatGoldYearItems/${USER_ID}:PKR:1446:chain`)
		).toMatchObject({ soldInIslamicYear: null });
	});

	it("pulls a remote sale and keeps the piece off the years that follow it", async () => {
		await markAllTableMigrationsDone();
		const { firestore } = await configureEmptySyncMocks();

		configureRemoteGoldYearItems(firestore, USER_ID, [
			{
				id: `${USER_ID}:PKR:1446:chain`,
				data: {
					id: `${USER_ID}:PKR:1446:chain`,
					userId: USER_ID,
					currency: "PKR",
					islamicYear: 1446,
					lineageId: "chain",
					title: "Chain",
					weight: 10,
					purity: "21k",
					notes: null,
					sourceGoldItemId: null,
					soldInIslamicYear: 1446,
					createdAt: 10_000,
					deletedAt: null,
					updatedAt: 50_000,
					syncedAt: firestoreTimestamp(5_000),
				},
			},
		]);

		await syncAll(USER_ID);

		expect(await db.zakatGoldYearItems.get(`${USER_ID}:PKR:1446:chain`)).toMatchObject({
			soldInIslamicYear: 1446,
			pendingSync: false,
		});
		expect(await listZakatGoldYearItemsHeldInYear(USER_ID, "PKR", 1446)).toEqual([]);
	});
});
