import { describe, expect, it } from "vitest";

import {
	mapHysabKytabBoxIcon,
	normalizeHysabKytabColor,
	resolveHysabKytabAccountIcon,
	resolveHysabKytabCategoryIcon,
} from "@/lib/import/hysabKytabIcons";

describe("Hysab Kytab icon and color helpers", () => {
	it("normalizes HK ARGB colors and drops unusable black values", () => {
		expect(normalizeHysabKytabColor("#ff03a9f4")).toBe("#03a9f4");
		expect(normalizeHysabKytabColor("#ff00c853")).toBe("#00c853");
		expect(normalizeHysabKytabColor("#33691E")).toBe("#33691e");
		expect(normalizeHysabKytabColor("#000")).toBeUndefined();
		expect(normalizeHysabKytabColor("#000000")).toBeUndefined();
		expect(normalizeHysabKytabColor("")).toBeUndefined();
	});

	it("maps semantic BOXICON names to emoji and ignores generic swatches", () => {
		expect(mapHysabKytabBoxIcon("salary_inactive")).toBe("💼");
		expect(mapHysabKytabBoxIcon("bt_grocery")).toBe("🛒");
		expect(mapHysabKytabBoxIcon("Meezan", "account")).toBe("🕌");
		expect(mapHysabKytabBoxIcon("SCB", "account")).toBe("🏦");
		expect(mapHysabKytabBoxIcon("@drawable/bt_1")).toBeUndefined();
		expect(mapHysabKytabBoxIcon("income_salary", "account")).toBeUndefined();
	});

	it("uses HK icons with title and bank metadata fallbacks", () => {
		expect(resolveHysabKytabCategoryIcon("Medical", "expense_medical")).toBe("🏥");
		expect(resolveHysabKytabCategoryIcon("Gifts", "bt_107")).toBe("🎁");
		expect(
			resolveHysabKytabAccountIcon("MCB iSave Saving", {
				boxIcon: "mcb",
				accountType: "Bank",
				bankName: "MCB Bank",
				currency: "PKR",
			})
		).toBe("🏦");
	});
});
