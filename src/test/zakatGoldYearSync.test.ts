/**
 * Cross-device sync regression tests for the per-year gold table (`zakatGoldYears`).
 *
 * Only inputs are persisted — the price per gram the owner typed for a year, the date it
 * was taken on, and an optional grams snapshot — so these tests check that a year's price
 * survives a push/pull round trip intact, that a cleared snapshot travels as an explicit
 * null instead of reading as "unchanged", and that a reset propagates as a tombstone.
 */
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db/local";
import { CORE_SYNC_TABLES, syncAll } from "@/lib/db/sync";
import {
	clearZakatGoldYear,
	clearZakatGoldYearGrams,
	getZakatGoldYearPrices,
	saveZakatGoldYearGrams,
	saveZakatGoldYearPrices,
} from "@/lib/zakatGoldYearRepository";

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

function configureRemoteGoldYears(
	firestore: typeof FirestoreModule,
	userId: string,
	docs: { id: string; data: Record<string, unknown> }[]
) {
	vi.mocked(firestore.getDocs).mockImplementation(async (ref: unknown) => {
		const path = (ref as { path?: string }).path;
		if (path === `users/${userId}/zakatGoldYears`) {
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

describe("syncAll — per-year gold prices", () => {
	const USER_ID = "zakat-gold-year-sync-user";

	beforeEach(async () => {
		await db.zakatGoldYears.where("userId").equals(USER_ID).delete();
		await db.syncMeta.bulkDelete(coreSyncMetaKeys());
	});

	it("registers zakatGoldYears as a core sync table", () => {
		expect(CORE_SYNC_TABLES).toContain("zakatGoldYears");
	});

	it("pushes a year's price per gram to Firestore", async () => {
		await markAllTableMigrationsDone();
		const priceDate = new Date(2023, 2, 23).getTime();
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: "PKR",
			islamicYear: 1444,
			pricesByPurity: { "21k": 18_846.3 },
			priceDate,
		});

		const { mockSet } = await configureEmptySyncMocks();

		const result = await syncAll(USER_ID);

		expect(result.status).toBe("success");
		expect(result.tables?.zakatGoldYears).toMatchObject({ pushed: 1 });
		expect(findWrite(mockSet, `users/${USER_ID}/zakatGoldYears/${USER_ID}:PKR:1444`)).toMatchObject(
			{
				islamicYear: 1444,
				currency: "PKR",
				pricesByPurity: { "21k": 18_846.3 },
				priceDate,
				gramsByPurity: null,
				deletedAt: null,
			}
		);
		expect(await db.zakatGoldYears.get(`${USER_ID}:PKR:1444`)).toMatchObject({
			pendingSync: false,
		});
	});

	it("pulls a remote year's price into Dexie, ready to value that year's gold", async () => {
		await markAllTableMigrationsDone();
		const { firestore } = await configureEmptySyncMocks();

		configureRemoteGoldYears(firestore, USER_ID, [
			{
				id: `${USER_ID}:PKR:1443`,
				data: {
					id: `${USER_ID}:PKR:1443`,
					userId: USER_ID,
					currency: "PKR",
					islamicYear: 1443,
					pricesByPurity: { "21k": 16_778.12 },
					gramsByPurity: null,
					priceDate: new Date(2022, 3, 4).getTime(),
					deletedAt: null,
					updatedAt: 50_000,
					syncedAt: firestoreTimestamp(5_000),
				},
			},
		]);

		const result = await syncAll(USER_ID);

		expect(result.status).toBe("success");
		expect(result.tables?.zakatGoldYears).toMatchObject({ pulled: 1 });

		const stored = await db.zakatGoldYears.get(`${USER_ID}:PKR:1443`);
		expect(stored).toMatchObject({
			islamicYear: 1443,
			currency: "PKR",
			pricesByPurity: { "21k": 16_778.12 },
			pendingSync: false,
		});
		expect(Object.prototype.hasOwnProperty.call(stored ?? {}, "gramsByPurity")).toBe(false);
		expect(getZakatGoldYearPrices(stored)).toEqual({ "21k": 16_778.12 });
		expect((await db.syncMeta.get("lastSync:zakatGoldYears"))?.timestamp).toBe(5_000);
	});

	/**
	 * An optional field that is simply absent reads as "unchanged" on the other device, so
	 * un-pinning a year's weight has to travel as an explicit null. That only happens if
	 * the field is registered in `OPTIONAL_SYNC_FIELDS`.
	 */
	it("writes an un-pinned weight as null rather than omitting it", async () => {
		await markAllTableMigrationsDone();
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: "PKR",
			islamicYear: 1445,
			pricesByPurity: { "21k": 20_000 },
		});
		await saveZakatGoldYearGrams({
			userId: USER_ID,
			currency: "PKR",
			islamicYear: 1445,
			gramsByPurity: { "21k": 170.52 },
		});
		await clearZakatGoldYearGrams(USER_ID, "PKR", 1445);

		const { mockSet } = await configureEmptySyncMocks();

		await syncAll(USER_ID);

		expect(findWrite(mockSet, `users/${USER_ID}/zakatGoldYears/${USER_ID}:PKR:1445`)).toMatchObject(
			{
				pricesByPurity: { "21k": 20_000 },
				gramsByPurity: null,
			}
		);
	});

	it("propagates a cleared year as a tombstone instead of resurrecting the price", async () => {
		await markAllTableMigrationsDone();
		await saveZakatGoldYearPrices({
			userId: USER_ID,
			currency: "PKR",
			islamicYear: 1446,
			pricesByPurity: { "21k": 22_000 },
		});
		await clearZakatGoldYear(USER_ID, "PKR", 1446);

		const { mockSet } = await configureEmptySyncMocks();

		await syncAll(USER_ID);

		const pushed = findWrite(mockSet, `users/${USER_ID}/zakatGoldYears/${USER_ID}:PKR:1446`);
		expect(pushed?.deletedAt).toBeGreaterThan(0);
	});
});
