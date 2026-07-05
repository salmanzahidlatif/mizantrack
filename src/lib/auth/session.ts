interface TokenLike {
	sub?: string | null;
}

interface AccountLike {
	providerAccountId?: string | null;
}

/**
 * Regex that matches the UUID v4 format NextAuth uses as a fallback userId
 * when `account.providerAccountId` is not pinned.
 * e.g. "4459f110-d978-4cd9-9c59-1dad559fab79"
 */
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function resolveSessionUserId(token: TokenLike): string | null {
	if (typeof token.sub !== "string") return null;

	const trimmed = token.sub.trim();
	if (!trimmed) return null;

	// UUID-format IDs are stale sessions from before the providerAccountId fix was deployed.
	// Returning null forces `session.user.id = ""` → layout redirects to /login for a fresh
	// sign-in, which will correctly pin token.sub = account.providerAccountId (Google numeric ID).
	if (UUID_REGEX.test(trimmed)) return null;

	return trimmed;
}

/**
 * Pins token.sub to the OAuth provider's stable account ID on initial sign-in.
 *
 * NextAuth v5 intentionally sets user.id = crypto.randomUUID() rather than the
 * OAuth profile id (see @auth/core callback.js). Without this function, every new
 * browser session generates a different UUID as token.sub, so local dev and
 * production environments produce different userIds for the same Google account.
 *
 * Call this from the NextAuth `jwt` callback. `account` is only non-null on the
 * initial sign-in; subsequent requests leave token.sub unchanged.
 */
export function pinTokenSubToProvider(token: TokenLike, account: AccountLike | null | undefined): TokenLike {
	if (account?.providerAccountId && typeof account.providerAccountId === "string") {
		return { ...token, sub: account.providerAccountId };
	}
	return token;
}
