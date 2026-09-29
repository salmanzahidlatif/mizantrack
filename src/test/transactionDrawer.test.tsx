import { describe, expect, it } from "vitest";

import {
	getTransactionAccountOptions,
	getTransactionCategoryOptions,
	getTransferDestinationAccounts,
} from "@/components/transactions/TransactionDrawer";

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
