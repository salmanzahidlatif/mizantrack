import { describe, expect, it } from "vitest";

import { DEFAULT_CATEGORY_ICON, getCategoryIcon, resolveCategoryIcon } from "@/lib/categoryIcons";

describe("category icon resolver", () => {
	it("maps imported personal-finance category names to emoji icons", () => {
		expect(resolveCategoryIcon("Food & Drink")).toBe("🍽️");
		expect(resolveCategoryIcon("Grocery")).toBe("🛒");
		expect(resolveCategoryIcon("Transport")).toBe("🚗");
		expect(resolveCategoryIcon("Fuel & Maintenance")).toBe("⛽");
		expect(resolveCategoryIcon("Bills & Utilities")).toBe("⚡");
		expect(resolveCategoryIcon("Rent Paid")).toBe("🏠");
		expect(resolveCategoryIcon("Gifts")).toBe("🎁");
		expect(resolveCategoryIcon("Family")).toBe("👪");
		expect(resolveCategoryIcon("Other Expenses")).toBe("📦");
	});

	it("matches keywords case-insensitively on word boundaries", () => {
		expect(resolveCategoryIcon("monthly ZAKAT payment")).toBe("🤲");
		expect(resolveCategoryIcon("Supermarket Run")).toBe("🛒");
		expect(resolveCategoryIcon("Healthcare")).toBe("🏥");
	});

	it("respects explicitly-set icons", () => {
		expect(resolveCategoryIcon("Groceries", "🌟")).toBe("🌟");
		expect(getCategoryIcon({ title: "Transport", icon: "🚕" })).toBe("🚕");
	});

	it("falls back to a neutral default for unknown names", () => {
		expect(resolveCategoryIcon("Salman")).toBe(DEFAULT_CATEGORY_ICON);
		expect(getCategoryIcon({ title: "Custom name" })).toBe(DEFAULT_CATEGORY_ICON);
	});
});
