import { describe, expect, it } from "vitest";

import {
	getTransactionAccountOptions,
	getTransactionCategoryOptions,
	getTransferDestinationAccounts,
} from "@/components/transactions/TransactionDrawer";
import { getTransactionFilterAccountOptions } from "@/components/transactions/TransactionFilters";

import type { Account, Category } from "@/types";

function account(id: string, currency: string): Account {
	return {
		id,
		userId: "user-1",
		title: id,
		openingBalance: 0,
		currency,
		isArchived: false,
		updatedAt: 1,
	};
}

function category(id: string, type: Category["type"], currency?: string): Category {
	return {
		id,
		userId: "user-1",
		title: id,
		type,
		currency,
		updatedAt: 1,
	};
}

function ids(records: Array<{ id: string }>) {
	return records.map((record) => record.id);
}

function expectUniqueIds(records: Array<{ id: string }>) {
	expect(new Set(ids(records)).size).toBe(records.length);
}

describe("TransactionDrawer option lists", () => {
	it("orders account options by recent usage with alphabetical tie-breaking", () => {
		const cash = account("cash", "PKR");
		const wallet = account("wallet", "PKR");
		const bank = account("bank", "PKR");

		const options = getTransactionAccountOptions([bank, wallet, cash], [], "PKR", undefined, {
			bank: 2,
			cash: 5,
			wallet: 5,
		});

		expect(ids(options)).toEqual(["cash", "wallet", "bank"]);
		expectUniqueIds(options);
	});

	it("deduplicates account options while preserving the edited selected account", () => {
		const selectedAccount = account("cash", "PKR");
		const otherAccount = account("bank", "PKR");
		const hiddenEditedAccount = account("wallet", "AED");

		const options = getTransactionAccountOptions(
			[selectedAccount, otherAccount, selectedAccount],
			[selectedAccount, hiddenEditedAccount, hiddenEditedAccount],
			"PKR",
			selectedAccount.id
		);

		expect(ids(options)).toEqual([selectedAccount.id, otherAccount.id]);
		expectUniqueIds(options);

		const hiddenOptions = getTransactionAccountOptions(
			[selectedAccount, otherAccount],
			[hiddenEditedAccount],
			"PKR",
			hiddenEditedAccount.id
		);

		expect(ids(hiddenOptions)).toEqual([
			selectedAccount.id,
			otherAccount.id,
			hiddenEditedAccount.id,
		]);
		expectUniqueIds(hiddenOptions);
	});

	it("keeps currency filtering and appends an edited out-of-filter account without duplicates", () => {
		const pkrAccount = account("cash", "PKR");
		const anotherPkrAccount = account("bank", "PKR");
		const hiddenEditedAccount = account("wallet", "AED");

		const options = getTransactionAccountOptions(
			[pkrAccount, anotherPkrAccount, hiddenEditedAccount],
			[hiddenEditedAccount],
			"PKR",
			hiddenEditedAccount.id,
			{ wallet: 99, bank: 3, cash: 1 }
		);

		expect(ids(options)).toEqual(["bank", "cash", "wallet"]);
		expectUniqueIds(options);
	});

	it("orders category options by recent usage with stable tie-breaking", () => {
		const groceries = category("groceries", "Expense", "PKR");
		const fuel = category("fuel", "Expense", "PKR");
		const zakat = category("zakat", "Expense", "PKR");

		const options = getTransactionCategoryOptions(
			[zakat, fuel, groceries],
			null,
			undefined,
			"Expense",
			{ fuel: 3, groceries: 7, zakat: 3 }
		);

		expect(ids(options)).toEqual(["groceries", "fuel", "zakat"]);
		expectUniqueIds(options);
	});

	it("deduplicates category options when the edited category is already in the filtered list", () => {
		const selectedCategory = category("groceries", "Expense", "PKR");
		const sharedCategory = category("food", "Expense");
		const incomeCategory = category("salary", "Income", "PKR");

		const options = getTransactionCategoryOptions(
			[selectedCategory, sharedCategory, selectedCategory, incomeCategory],
			selectedCategory,
			selectedCategory.id,
			"Expense"
		);

		expect(ids(options)).toEqual([selectedCategory.id, sharedCategory.id]);
		expectUniqueIds(options);

		const hiddenEditedCategory = category("travel", "Expense", "AED");
		const hiddenOptions = getTransactionCategoryOptions(
			[selectedCategory, sharedCategory],
			hiddenEditedCategory,
			hiddenEditedCategory.id,
			"Expense"
		);

		expect(ids(hiddenOptions)).toEqual([
			selectedCategory.id,
			sharedCategory.id,
			hiddenEditedCategory.id,
		]);
		expectUniqueIds(hiddenOptions);
	});

	it("preserves an edited out-of-filter category after ranked in-filter options", () => {
		const groceries = category("groceries", "Expense", "PKR");
		const food = category("food", "Expense");
		const hiddenEditedCategory = category("travel", "Expense", "AED");

		const options = getTransactionCategoryOptions(
			[groceries, food],
			hiddenEditedCategory,
			hiddenEditedCategory.id,
			"Expense",
			{ travel: 99, food: 5, groceries: 1 }
		);

		expect(ids(options)).toEqual(["food", "groceries", "travel"]);
		expectUniqueIds(options);
	});

	it("orders transfer destinations by usage while excluding cross-currency accounts", () => {
		const source = account("source-pkr", "PKR");
		const cash = account("cash-pkr", "PKR");
		const bank = account("bank-pkr", "PKR");
		const crossCurrency = account("wallet-aed", "AED");

		const options = getTransferDestinationAccounts(
			[source, cash, bank, crossCurrency],
			[],
			source.id,
			undefined,
			{ "wallet-aed": 99, "cash-pkr": 2, "bank-pkr": 5 }
		);

		expect(ids(options)).toEqual(["bank-pkr", "cash-pkr"]);
		expectUniqueIds(options);
	});

	it("deduplicates transfer destinations while preserving a selected legacy destination", () => {
		const source = account("source-pkr", "PKR");
		const destination = account("destination-pkr", "PKR");
		const legacyDestination = account("destination-aed", "AED");

		const options = getTransferDestinationAccounts(
			[source, destination, destination],
			[source, destination, legacyDestination, legacyDestination],
			source.id,
			legacyDestination.id
		);

		expect(ids(options)).toEqual([destination.id, legacyDestination.id]);
		expectUniqueIds(options);
	});
});

describe("TransactionDrawer transfer destinations", () => {
	it("excludes cross-currency destination accounts for new transfers", () => {
		const source = account("source-pkr", "PKR");
		const sameCurrencyDestination = account("destination-pkr", "PKR");
		const crossCurrencyDestination = account("destination-aed", "AED");

		const destinations = getTransferDestinationAccounts(
			[source, sameCurrencyDestination, crossCurrencyDestination],
			[],
			source.id,
			undefined
		);

		expect(destinations.map((destination) => destination.id)).toEqual([sameCurrencyDestination.id]);
	});

	it("keeps a selected legacy cross-currency destination available while editing", () => {
		const source = account("source-pkr", "PKR");
		const sameCurrencyDestination = account("destination-pkr", "PKR");
		const legacyCrossCurrencyDestination = account("destination-aed", "AED");

		const destinations = getTransferDestinationAccounts(
			[source, sameCurrencyDestination],
			[source, legacyCrossCurrencyDestination],
			source.id,
			legacyCrossCurrencyDestination.id
		);

		expect(destinations.map((destination) => destination.id)).toEqual([
			sameCurrencyDestination.id,
			legacyCrossCurrencyDestination.id,
		]);
	});
});

describe("TransactionFilters option lists", () => {
	it("orders filter account options by usage with stable tie-breaking", () => {
		const cash = account("cash", "PKR");
		const wallet = account("wallet", "PKR");
		const bank = account("bank", "PKR");

		const options = getTransactionFilterAccountOptions([wallet, bank, cash], {
			bank: 1,
			cash: 4,
			wallet: 4,
		});

		expect(ids(options)).toEqual(["cash", "wallet", "bank"]);
		expectUniqueIds(options);
	});
});
