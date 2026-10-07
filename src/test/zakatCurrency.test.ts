import { describe, expect, it } from "vitest";

import {
	getPureGoldWeightGrams,
	getZakatAccountsForCurrency,
	getZakatGoldItemsForCurrency,
} from "@/components/zakat/ZakatPageClientEnhanced";
import { computeAccountBalances } from "@/lib/analytics/balanceMath";

import type { Account, GoldItem, Transaction } from "@/types";

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
		const accounts = [
			account("pkr-cash", "PKR", 100_000),
			account("lower-pkr-cash", " pkr ", 25_000),
			account("aed-cash", "AED", 50_000),
		];
		const goldItems = [
			goldItem("pkr-gold", "PKR", 10),
			goldItem("lower-pkr-gold", " pkr ", 5),
			goldItem("aed-gold", "AED", 20),
		];

		const pkrAccounts = getZakatAccountsForCurrency(accounts, "pkr");
		const pkrGoldItems = getZakatGoldItemsForCurrency(goldItems, "pkr");

		expect(pkrAccounts.map((item) => item.id)).toEqual(["pkr-cash", "lower-pkr-cash"]);
		expect(getPureGoldWeightGrams(pkrGoldItems)).toBe(15);
		expect(pkrAccounts.reduce((sum, item) => sum + item.openingBalance, 0)).toBe(125_000);
	});

	it("computes balances from all accounts before displaying the selected currency", () => {
		const accounts = [account("pkr-cash", "PKR", 100_000), account("aed-cash", "AED", 50_000)];
		const transactions: Transaction[] = [
			{
				id: "pkr-to-aed-transfer",
				userId: "zakat-currency-test-user",
				type: "Transfer",
				date: 1_000,
				amount: 5_000,
				accountId: "pkr-cash",
				toAccountId: "aed-cash",
				updatedAt: 1_000,
			},
		];

		const balances = computeAccountBalances(
			"zakat-currency-test-user",
			accounts,
			transactions
		).balances;
		const pkrAccounts = getZakatAccountsForCurrency(accounts, "PKR");
		const displayedPkrTotal = pkrAccounts.reduce(
			(sum, item) => sum + (balances.get(item.id) ?? item.openingBalance),
			0
		);

		expect(balances.get("pkr-cash")).toBe(95_000);
		expect(balances.get("aed-cash")).toBe(55_000);
		expect(displayedPkrTotal).toBe(95_000);
		expect(displayedPkrTotal).not.toBe(150_000);
	});
});
