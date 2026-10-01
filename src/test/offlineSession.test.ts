import { describe, expect, it, vi } from "vitest";

import {
	OFFLINE_SESSION_STORAGE_KEY,
	clearOfflineSessionSnapshot,
	createOfflineSessionSnapshot,
	parseOfflineSessionSnapshot,
	readOfflineSessionSnapshot,
	writeOfflineSessionSnapshot,
} from "@/lib/auth/offline-session";

function createMemoryStorage() {
	const values = new Map<string, string>();
	return {
		getItem: vi.fn((key: string) => values.get(key) ?? null),
		removeItem: vi.fn((key: string) => {
			values.delete(key);
		}),
		setItem: vi.fn((key: string, value: string) => {
			values.set(key, value);
		}),
	};
}

describe("offline session snapshots", () => {
	it("creates a snapshot only from a verified NextAuth session user", () => {
		const snapshot = createOfflineSessionSnapshot(
			{
				user: {
					email: "user@example.com",
					id: "118402808840027279814",
					image: "https://example.com/avatar.png",
					name: "Test User",
				},
			},
			123
		);

		expect(snapshot).toEqual({
			user: {
				email: "user@example.com",
				id: "118402808840027279814",
				image: "https://example.com/avatar.png",
				name: "Test User",
			},
			verifiedAt: 123,
		});
	});

	it("rejects missing, blank, and stale UUID user ids", () => {
		expect(createOfflineSessionSnapshot(null)).toBeNull();
		expect(createOfflineSessionSnapshot({ user: { id: "" } })).toBeNull();
		expect(
			createOfflineSessionSnapshot({
				user: { id: "d351689b-7c79-4f3c-9d13-5b4041cdcc23" },
			})
		).toBeNull();
	});

	it("round-trips valid snapshots through storage", () => {
		const storage = createMemoryStorage();
		const snapshot = {
			user: { email: "user@example.com", id: "google-sub", image: null, name: "User" },
			verifiedAt: 456,
		};

		writeOfflineSessionSnapshot(snapshot, storage);
		expect(storage.setItem).toHaveBeenCalledWith(
			OFFLINE_SESSION_STORAGE_KEY,
			JSON.stringify(snapshot)
		);
		expect(readOfflineSessionSnapshot(storage)).toEqual(snapshot);

		clearOfflineSessionSnapshot(storage);
		expect(storage.removeItem).toHaveBeenCalledWith(OFFLINE_SESSION_STORAGE_KEY);
	});

	it("does not parse forged-looking malformed local records", () => {
		expect(parseOfflineSessionSnapshot("not-json")).toBeNull();
		expect(parseOfflineSessionSnapshot(JSON.stringify({ user: { id: "google-sub" } }))).toBeNull();
		expect(
			parseOfflineSessionSnapshot(JSON.stringify({ user: { id: "" }, verifiedAt: 1 }))
		).toBeNull();
	});
});
