interface TokenLike {
	sub?: string | null;
}

export function resolveSessionUserId(token: TokenLike): string | null {
	if (typeof token.sub !== "string") return null;

	const trimmed = token.sub.trim();
	return trimmed.length > 0 ? trimmed : null;
}
