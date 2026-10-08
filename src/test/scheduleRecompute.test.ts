import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics/computeDashboardStats", () => ({
	computeDashboardStats: vi.fn(),
}));

vi.mock("@/lib/db/firebase", () => ({
	getFirestoreForUser: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
	doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join("/") })),
	setDoc: vi.fn(),
}));

import { computeDashboardStats } from "@/lib/analytics/computeDashboardStats";
import {
	flushAnalyticsRecompute,
	scheduleAnalyticsRecompute,
} from "@/lib/analytics/scheduleRecompute";
import { getFirestoreForUser } from "@/lib/db/firebase";
import { db } from "@/lib/db/local";

describe("scheduleAnalyticsRecompute", () => {
	beforeEach(async () => {
		await db.dashboardStats.clear();
		vi.clearAllMocks();
		vi.mocked(getFirestoreForUser).mockResolvedValue(null);
		vi.mocked(computeDashboardStats).mockResolvedValue({
			id: "debounce-user",
			updatedAt: 123,
			balances: { "acc-1": 42 },
			perCurrency: {
				"": { monthIncome: 1, monthExpense: 2, trend: [] },
			},
			recent: [],
		});
	});

	it("debounces rapid calls into a single recompute", async () => {
		scheduleAnalyticsRecompute("debounce-user");
		scheduleAnalyticsRecompute("debounce-user");
		scheduleAnalyticsRecompute("debounce-user");

		expect(computeDashboardStats).not.toHaveBeenCalled();

		await flushAnalyticsRecompute("debounce-user");

		expect(computeDashboardStats).toHaveBeenCalledTimes(1);
		expect(await db.dashboardStats.get("debounce-user")).toMatchObject({
			id: "debounce-user",
			balances: { "acc-1": 42 },
		});
	});

	it("records recompute failures and allows a later app start to retry", async () => {
		await db.dashboardStats.put({
			id: "debounce-user",
			updatedAt: 1,
			cacheStatus: "valid",
			balances: { "acc-1": 999 },
			perCurrency: {},
			recent: [],
		});
		vi.mocked(computeDashboardStats)
			.mockRejectedValueOnce(new Error("indexeddb write failed"))
			.mockResolvedValueOnce({
				id: "debounce-user",
				updatedAt: 456,
				balances: { "acc-1": 42 },
				perCurrency: {
					"": { monthIncome: 1, monthExpense: 2, trend: [] },
				},
				recent: [],
			});

		scheduleAnalyticsRecompute("debounce-user");
		await expect(flushAnalyticsRecompute("debounce-user")).rejects.toThrow(
			"indexeddb write failed"
		);
		expect(await db.dashboardStats.get("debounce-user")).toMatchObject({
			cacheStatus: "failed",
			cacheError: "indexeddb write failed",
			balances: { "acc-1": 999 },
		});

		scheduleAnalyticsRecompute("debounce-user");
		await flushAnalyticsRecompute("debounce-user");

		expect(computeDashboardStats).toHaveBeenCalledTimes(2);
		const healed = await db.dashboardStats.get("debounce-user");
		expect(healed).toMatchObject({
			balances: { "acc-1": 42 },
		});
		expect(healed?.cacheStatus).not.toBe("failed");
	});
});
