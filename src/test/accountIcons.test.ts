import { describe, expect, it } from "vitest";

import { DEFAULT_ACCOUNT_ICON, getAccountIcon, resolveAccountIcon } from "@/lib/accountIcons";

describe("account icon resolver", () => {
	it("matches UAE and Pakistani banks only for their currencies", () => {
		expect(resolveAccountIcon("Meezan - Current", { currency: "PKR" })).toBe("🕌");
		expect(resolveAccountIcon("Meezan - Current", { currency: "AED" })).not.toBe("🕌");
		expect(resolveAccountIcon("EIB - Savings", { currency: "AED" })).toBe("🕌");
		expect(resolveAccountIcon("EIB - Savings", { currency: "PKR" })).not.toBe("🕌");
	});

	it("keeps global brands currency-neutral", () => {
		expect(resolveAccountIcon("Wise", { currency: "AED" })).toBe("🌍");
		expect(resolveAccountIcon("Paypal (usd)", { currency: "PKR" })).toBe("💳");
	});

	it("uses explicit icons before inferred matches", () => {
		expect(resolveAccountIcon("Cash", { explicitIcon: "⭐", currency: "AED" })).toBe("⭐");
		expect(getAccountIcon({ title: "Cash", icon: "💎", currency: "PKR" })).toBe("💎");
	});

	it("falls back to a stable neutral default", () => {
		expect(resolveAccountIcon("Unrecognised account", { currency: "AED" })).toBe(
			DEFAULT_ACCOUNT_ICON
		);
	});
});
