import { describe, expect, it } from "vitest";

import {
	ACCOUNT_ICON_KEYS,
	DEFAULT_ACCOUNT_ICON,
	getAccountIcon,
	isAccountIconKey,
	resolveAccountIcon,
} from "@/lib/accountIcons";

const BRAND_SAMPLES = [
	{ currency: "AED", expected: "bank.adib", title: "ADIB Current" },
	{ currency: "AED", expected: "bank.cbd", title: "Commercial Bank of Dubai" },
	{ currency: "AED", expected: "bank.eib", title: "Emirates Islamic Savings" },
	{ currency: "AED", expected: "bank.enbd", title: "Emirates NBD Current" },
	{ currency: "AED", expected: "bank.fab", title: "First Abu Dhabi Bank" },
	{ currency: "AED", expected: "bank.mashreq", title: "Mashreq Neo" },
	{ currency: "AED", expected: "bank.rakbank", title: "RAKBANK Account" },
	{ currency: "PKR", expected: "bank.alfalah", title: "Bank Alfalah Savings" },
	{ currency: "PKR", expected: "bank.hbl", title: "HBL Current" },
	{ currency: "PKR", expected: "bank.mcb", title: "MCB iSave Saving" },
	{ currency: "PKR", expected: "bank.meezan", title: "Meezan - Current" },
	{ currency: "PKR", expected: "bank.scb", title: "Standard Chartered Credit Card" },
];

describe("account icon resolver", () => {
	it("gives every supported bank its own distinct icon key", () => {
		const resolved = BRAND_SAMPLES.map((sample) =>
			resolveAccountIcon(sample.title, { currency: sample.currency })
		);

		expect(resolved).toEqual(BRAND_SAMPLES.map((sample) => sample.expected));
		expect(new Set(resolved).size).toBe(BRAND_SAMPLES.length);
		expect(resolved.every((key) => isAccountIconKey(key))).toBe(true);
	});

	it("separates the wallets that used to share one emoji", () => {
		const resolved = [
			resolveAccountIcon("PayPal (usd)", { currency: "PKR" }),
			resolveAccountIcon("Wise", { currency: "AED" }),
			resolveAccountIcon("Payoneer", { currency: "AED" }),
			resolveAccountIcon("Careem Pay", { currency: "AED" }),
			resolveAccountIcon("EasyPaisa", { currency: "PKR" }),
			resolveAccountIcon("SadaPay", { currency: "PKR" }),
			resolveAccountIcon("NayaPay", { currency: "PKR" }),
		];

		expect(resolved).toEqual([
			"wallet.paypal",
			"wallet.wise",
			"wallet.payoneer",
			"wallet.careem",
			"wallet.easypaisa",
			"wallet.sadapay",
			"wallet.nayapay",
		]);
		expect(new Set(resolved).size).toBe(resolved.length);
	});

	it("matches UAE and Pakistani banks only for their currencies", () => {
		expect(resolveAccountIcon("Meezan - Current", { currency: "PKR" })).toBe("bank.meezan");
		expect(resolveAccountIcon("Meezan - Current", { currency: "AED" })).not.toBe("bank.meezan");
		expect(resolveAccountIcon("EIB - Savings", { currency: "AED" })).toBe("bank.eib");
		expect(resolveAccountIcon("EIB - Savings", { currency: "PKR" })).not.toBe("bank.eib");
		expect(resolveAccountIcon("EasyPaisa", { currency: "AED" })).not.toBe("wallet.easypaisa");
	});

	it("keeps global brands currency-neutral", () => {
		expect(resolveAccountIcon("Wise", { currency: "AED" })).toBe("wallet.wise");
		expect(resolveAccountIcon("Wise", { currency: "PKR" })).toBe("wallet.wise");
		expect(resolveAccountIcon("Paypal (usd)", { currency: "PKR" })).toBe("wallet.paypal");
	});

	it("keeps the brand → type → title precedence", () => {
		expect(resolveAccountIcon("Salary Account", { accountType: "Cash", currency: "AED" })).toBe(
			"generic.cash"
		);
		expect(
			resolveAccountIcon("Salary Account", {
				accountType: "Cash",
				bankName: "Mashreq",
				currency: "AED",
			})
		).toBe("bank.mashreq");
		expect(resolveAccountIcon("Solar Panels", { currency: "AED" })).toBe("generic.solar");
	});

	it("uses explicit icons before inferred matches", () => {
		expect(resolveAccountIcon("Cash", { explicitIcon: "generic.crypto", currency: "AED" })).toBe(
			"generic.crypto"
		);
		expect(getAccountIcon({ title: "Meezan", icon: "generic.gift", currency: "PKR" })).toBe(
			"generic.gift"
		);
	});

	it("returns legacy emoji icons untouched so synced records keep working", () => {
		expect(resolveAccountIcon("Cash", { explicitIcon: "⭐", currency: "AED" })).toBe("⭐");
		expect(getAccountIcon({ title: "Cash", icon: "💎", currency: "PKR" })).toBe("💎");
		expect(isAccountIconKey("💎")).toBe(false);
	});

	it("falls back to a stable neutral default", () => {
		expect(resolveAccountIcon("Unrecognised account", { currency: "AED" })).toBe(
			DEFAULT_ACCOUNT_ICON
		);
		expect(ACCOUNT_ICON_KEYS).toContain(DEFAULT_ACCOUNT_ICON);
	});

	it("keeps every icon key unique", () => {
		expect(new Set(ACCOUNT_ICON_KEYS).size).toBe(ACCOUNT_ICON_KEYS.length);
	});
});
