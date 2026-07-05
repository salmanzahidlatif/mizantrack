import { describe, it, expect } from "vitest";

import { hashPin, verifyPin } from "@/lib/pinCrypto";

describe("pinCrypto", () => {
	it("hashPin_produces64CharHex", async () => {
		const hash = await hashPin("1234");
		expect(hash).toHaveLength(64);
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
	});

	it("hashPin_isDeterministic", async () => {
		const h1 = await hashPin("1234");
		const h2 = await hashPin("1234");
		expect(h1).toBe(h2);
	});

	it("hashPin_differentInputsDifferentHashes", async () => {
		const h1 = await hashPin("1234");
		const h2 = await hashPin("5678");
		expect(h1).not.toBe(h2);
	});

	it("hashPin_emptyStringReturnsValidHash", async () => {
		const hash = await hashPin("");
		expect(hash).toHaveLength(64);
	});

	it("verifyPin_matchingPinReturnsTrue", async () => {
		const hash = await hashPin("1234");
		expect(await verifyPin("1234", hash)).toBe(true);
	});

	it("verifyPin_wrongPinReturnsFalse", async () => {
		const hash = await hashPin("1234");
		expect(await verifyPin("9999", hash)).toBe(false);
	});

	it("verifyPin_emptyPinReturnsFalse", async () => {
		const hash = await hashPin("1234");
		expect(await verifyPin("", hash)).toBe(false);
	});

	it("verifyPin_emptyHashReturnsFalse", async () => {
		expect(await verifyPin("1234", "")).toBe(false);
	});

	it("verifyPin_caseInsensitiveHashComparison", async () => {
		const hash = await hashPin("1234");
		// verifyPin should normalise hash to lowercase before comparing
		expect(await verifyPin("1234", hash.toUpperCase())).toBe(true);
	});
});
