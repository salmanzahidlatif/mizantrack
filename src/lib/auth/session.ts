interface TokenLike {
	sub?: string | null;
}

interface AccountLike {
	providerAccountId?: string | null;
}

export function resolveSessionUserId(token: TokenLike): string | null {
	if (typeof token.sub !== "string") return null;

	const trimmed = token.sub.trim();
	return trimmed.length > 0 ? trimmed : null;
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
