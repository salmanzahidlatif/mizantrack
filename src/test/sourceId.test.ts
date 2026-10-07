import { describe, expect, it } from "vitest";

import { buildHysabKytabSourceId, parseSourceId } from "@/lib/import/sourceId";

describe("Hysab Kytab source IDs", () => {
	it("builds and parses currency-scoped source IDs", () => {
		const sourceId = buildHysabKytabSourceId("pkr", "account", 19);

		expect(sourceId).toBe("hk:PKR:account:19");
		expect(parseSourceId(sourceId)).toEqual({
			namespace: "hk",
			currency: "PKR",
			entity: "account",
			id: "19",
		});
	});

	it("keeps identical source table IDs distinct across currencies", () => {
		expect(buildHysabKytabSourceId("PKR", "account", 19)).not.toBe(
			buildHysabKytabSourceId("AED", "account", 19)
		);
	});

	it("round-trips all supported source entities", () => {
		const cases = [
			["PKR", "account", "19"],
			["PKR", "category", "42"],
			["PKR", "voucher", "1791209290738"],
			["PKR", "budget", "17"],
		] as const;

		for (const [currency, entity, id] of cases) {
			const sourceId = buildHysabKytabSourceId(currency, entity, id);
			expect(parseSourceId(sourceId)).toMatchObject({ currency, entity, id });
		}
	});
});
