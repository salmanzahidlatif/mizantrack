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
});
