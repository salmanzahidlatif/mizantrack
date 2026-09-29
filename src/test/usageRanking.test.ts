import { describe, expect, it } from "vitest";

import { buildTransactionUsageRanking, sortRecordsByUsage } from "@/lib/usageRanking";

describe("usage ranking helpers", () => {
	it("counts category and account usage from transactions", () => {
		const ranking = buildTransactionUsageRanking([
			{ accountId: "cash", categoryId: "food" },
			{ accountId: "cash", categoryId: "food", toAccountId: "bank" },
			{ accountId: "bank", categoryId: "fuel" },
		]);

		expect(ranking.accountUsage).toEqual({ bank: 2, cash: 2 });
		expect(ranking.categoryUsage).toEqual({ food: 2, fuel: 1 });
	});

	it("sorts most-used records first and uses title/id tie-breakers", () => {
		const records = [
			{ id: "z", title: "Wallet" },
			{ id: "a", title: "Cash" },
			{ id: "b", title: "cash" },
			{ id: "m", title: "Bank" },
		];

		expect(sortRecordsByUsage(records, { a: 4, b: 4, m: 1 })).toEqual([
			{ id: "a", title: "Cash" },
			{ id: "b", title: "cash" },
			{ id: "m", title: "Bank" },
			{ id: "z", title: "Wallet" },
		]);
	});
});
