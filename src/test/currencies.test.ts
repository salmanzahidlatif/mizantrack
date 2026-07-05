import { describe, it, expect } from "vitest";

import { searchCurrencies, getCurrencyByCode, CURRENCIES } from "@/lib/currencies";

describe("currencies", () => {
	it("CURRENCIES_hasAtLeast150Entries", () => {
		expect(CURRENCIES.length).toBeGreaterThanOrEqual(150);
	});

	it("searchCurrencies_emptyQueryReturnsAll", () => {
		expect(searchCurrencies("").length).toBe(CURRENCIES.length);
	});

	it("searchCurrencies_matchesByCode", () => {
		const results = searchCurrencies("PKR");
		expect(results.some((c) => c.code === "PKR")).toBe(true);
	});

	it("searchCurrencies_caseInsensitiveByCode", () => {
		const results = searchCurrencies("pkr");
		expect(results.some((c) => c.code === "PKR")).toBe(true);
	});

	it("searchCurrencies_matchesByCountry", () => {
		const results = searchCurrencies("pak");
		expect(results.some((c) => c.code === "PKR")).toBe(true);
	});

	it("searchCurrencies_matchesByName", () => {
		const results = searchCurrencies("rupee");
		expect(results.some((c) => c.code === "PKR")).toBe(true);
	});

	it("searchCurrencies_noMatchReturnsEmpty", () => {
		expect(searchCurrencies("xxxxxxxxxxx")).toHaveLength(0);
	});

	it("getCurrencyByCode_returnsCorrectEntry", () => {
		const entry = getCurrencyByCode("PKR");
		expect(entry).toBeDefined();
		expect(entry!.name).toBe("Pakistani Rupee");
		expect(entry!.flag).toBe("🇵🇰");
	});

	it("getCurrencyByCode_caseInsensitive", () => {
		expect(getCurrencyByCode("pkr")).toBeDefined();
		expect(getCurrencyByCode("PKR")).toBeDefined();
	});

	it("getCurrencyByCode_unknownCodeReturnsUndefined", () => {
		expect(getCurrencyByCode("ZZZ")).toBeUndefined();
	});

	it("allEntriesHaveRequiredFields", () => {
		for (const entry of CURRENCIES) {
			expect(entry.code).toBeTruthy();
			expect(entry.name).toBeTruthy();
			expect(entry.country).toBeTruthy();
			expect(entry.flag).toBeTruthy();
		}
	});
});
