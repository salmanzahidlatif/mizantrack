import { describe, expect, it } from "vitest";

import {
	getPureGoldWeightGrams,
	getZakatAccountsForCurrency,
	getZakatGoldItemsForCurrency,
} from "@/components/zakat/ZakatPageClientEnhanced";

import type { Account, GoldItem } from "@/types";

function account(id: string, currency: string, openingBalance: number): Account {
	return {
		id,
		userId: "zakat-currency-test-user",
		title: id,
		openingBalance,
		currency,
		isArchived: false,
		updatedAt: 1_000,
	};
}

function goldItem(id: string, currency: string, weight: number): GoldItem {
	return {
		id,
		userId: "zakat-currency-test-user",
		currency,
		title: id,
		weight,
		purity: "24k",
		updatedAt: 1_000,
	};
}

describe("zakat currency scoping", () => {
	it("filters account and gold totals to one currency before calculating", () => {
		const accounts = [account("pkr-cash", "PKR", 100_000), account("aed-cash", "AED", 50_000)];
		const goldItems = [goldItem("pkr-gold", "PKR", 10), goldItem("aed-gold", "AED", 20)];

		const pkrAccounts = getZakatAccountsForCurrency(accounts, "PKR");
		const pkrGoldItems = getZakatGoldItemsForCurrency(goldItems, "PKR");

		expect(pkrAccounts.map((item) => item.id)).toEqual(["pkr-cash"]);
		expect(getPureGoldWeightGrams(pkrGoldItems)).toBe(10);
		expect(pkrAccounts.reduce((sum, item) => sum + item.openingBalance, 0)).toBe(100_000);
	});
});
