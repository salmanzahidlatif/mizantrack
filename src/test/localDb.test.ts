import { describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db/local";

describe("local Dexie database events", () => {
	it("versionchange handler leaves the database reopenable", async () => {
		await db.open();
		await db.accounts.count();

		const closeSpy = vi.spyOn(db, "close");
		try {
			db.on("versionchange").fire({
				oldVersion: 30,
				newVersion: 40,
			} as IDBVersionChangeEvent);

			expect(closeSpy).toHaveBeenCalled();
			expect(closeSpy.mock.calls.every(([options]) => options?.disableAutoOpen === false)).toBe(
				true
			);
			await expect(db.accounts.count()).resolves.toEqual(expect.any(Number));
		} finally {
			closeSpy.mockRestore();
		}
	});
});
