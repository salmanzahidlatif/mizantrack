import { describe, expect, it } from "vitest";

import { pinTokenSubToProvider, resolveSessionUserId } from "@/lib/auth/session";

describe("resolveSessionUserId", () => {
	it("tokenSubPresent_ReturnsTokenSub", () => {
		expect(resolveSessionUserId({ sub: "google-oauth-user-id" })).toBe("google-oauth-user-id");
	});

	it("tokenSubMissing_ReturnsNull", () => {
		expect(resolveSessionUserId({})).toBeNull();
	});
});

describe("pinTokenSubToProvider", () => {
	it("onSignIn_PinsTokenSubToProviderAccountId", () => {
		// Regression: NextAuth v5 beta sets user.id = crypto.randomUUID() on every sign-in
		// instead of the Google account sub. Without pinning, local dev and production
		// each get different UUIDs as userId, breaking cross-environment Firestore sync.
		// account is non-null only on initial OAuth sign-in.
		const token = { sub: "d351689b-7c79-4f3c-9d13-5b4041cdcc23" }; // UUID NextAuth generated
		const account = { providerAccountId: "118402808840027279814" }; // Google's stable sub

		const pinned = pinTokenSubToProvider(token, account);

		expect(resolveSessionUserId(pinned)).toBe("118402808840027279814");
	});

	it("onSubsequentRequest_NullAccount_PreservesExistingTokenSub", () => {
		// After sign-in, account is null on every JWT refresh.
		// token.sub must remain as the pinned Google ID, not be overwritten.
		const token = { sub: "118402808840027279814" };

		const result = pinTokenSubToProvider(token, null);

		expect(resolveSessionUserId(result)).toBe("118402808840027279814");
	});

	it("sameGoogleAccount_LocalAndProduction_ProduceSameUserId", () => {
		// Simulates two independent sign-ins (local dev + production) for the same
		// Google account. Both start with different random UUIDs from NextAuth,
		// but after pinning they must produce the same userId.
		const localToken = { sub: "d351689b-7c79-4f3c-9d13-5b4041cdcc23" };
		const productionToken = { sub: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" };
		const account = { providerAccountId: "118402808840027279814" };

		const localPinned = pinTokenSubToProvider(localToken, account);
		const productionPinned = pinTokenSubToProvider(productionToken, account);

		expect(resolveSessionUserId(localPinned)).toBe(resolveSessionUserId(productionPinned));
	});
});
