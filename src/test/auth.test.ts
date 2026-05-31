import { describe, expect, it } from "vitest";

import { resolveSessionUserId } from "@/lib/auth/session";

	describe("resolveSessionUserId", () => {
		it("tokenSubPresent_ReturnsTokenSub", () => {
			expect(resolveSessionUserId({ sub: "google-oauth-user-id" })).toBe(
				"google-oauth-user-id"
			);
		});

		it("tokenSubMissing_ReturnsNull", () => {
			expect(resolveSessionUserId({})).toBeNull();
		});
	});