import { describe, expect, it } from "vitest";

import { getTransferDestinationAccounts } from "@/components/transactions/TransactionDrawer";

import type { Account } from "@/types";

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
