import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import { pinTokenSubToProvider, resolveSessionUserId } from "@/lib/auth/session";
import { GOOGLE_DRIVE_FILE_SCOPE } from "@/lib/sheets/constants";

type GoogleSheetsTokenUpdate =
	| {
			type: "set";
			accessToken: string;
			expiresAt: number;
			refreshToken?: string;
			scope?: string;
	  }
	| { type: "clear" };

function hasDriveFileScope(scope: unknown): boolean {
	return typeof scope === "string" && scope.split(/\s+/).includes(GOOGLE_DRIVE_FILE_SCOPE);
}

function applyGoogleSheetsTokenUpdate(
	token: Record<string, unknown>,
	update: GoogleSheetsTokenUpdate
) {
	if (update.type === "clear") {
		delete token.googleSheetsAccessToken;
		delete token.googleSheetsRefreshToken;
		delete token.googleSheetsExpiresAt;
		delete token.googleSheetsScope;
		token.googleSheetsTokenError = "RequiresReconnect";
		return;
	}
	token.googleSheetsAccessToken = update.accessToken;
	if (update.refreshToken) token.googleSheetsRefreshToken = update.refreshToken;
	token.googleSheetsExpiresAt = update.expiresAt;
	if (update.scope) token.googleSheetsScope = update.scope;
	delete token.googleSheetsTokenError;
}

export const { handlers, signIn, signOut, auth, unstable_update } = NextAuth({
	providers: [
		GoogleProvider({
			clientId: process.env.AUTH_GOOGLE_ID!,
			clientSecret: process.env.AUTH_GOOGLE_SECRET!,
			authorization: { params: { prompt: "select_account" } },
		}),
	],
	callbacks: {
		authorized({ auth, request: { nextUrl } }) {
			const isLoggedIn = !!auth?.user;
			const isOnLoginPage = nextUrl.pathname.startsWith("/login");
			if (!isLoggedIn && !isOnLoginPage) {
				return Response.redirect(new URL("/login", nextUrl));
			}
			return true;
		},
		jwt({ token, account, trigger, session }) {
			// NextAuth v5 sets user.id = crypto.randomUUID() on every sign-in — NOT the
			// Google account sub. Without this callback, token.sub is a fresh UUID on every
			// new session, so local dev and production generate different userIds for the
			// same Google account, breaking cross-environment Firestore sync.
			// Fix: pin token.sub to account.providerAccountId (Google's stable numeric sub)
			// on initial sign-in. Subsequent requests have account=null; token.sub persists.
			const pinnedToken = pinTokenSubToProvider(token, account) as typeof token;
			if (trigger === "update") {
				const update = (session as { googleSheetsTokenUpdate?: GoogleSheetsTokenUpdate } | null)
					?.googleSheetsTokenUpdate;
				if (update?.type === "set" || update?.type === "clear") {
					applyGoogleSheetsTokenUpdate(pinnedToken, update);
				}
			}
			if (hasDriveFileScope(account?.scope)) {
				if (account?.access_token) pinnedToken.googleSheetsAccessToken = account.access_token;
				if (account?.refresh_token) pinnedToken.googleSheetsRefreshToken = account.refresh_token;
				if (account?.expires_at) pinnedToken.googleSheetsExpiresAt = account.expires_at * 1000;
				pinnedToken.googleSheetsScope = account?.scope;
				delete pinnedToken.googleSheetsTokenError;
			}
			return pinnedToken;
		},
		session({ session, token }) {
			if (session.user) {
				session.user.id = resolveSessionUserId(token) ?? "";
				// Explicitly forward profile fields from the JWT token.
				// Google OAuth stores the profile image as token.picture.
				session.user.name = (token.name as string | null | undefined) ?? session.user.name;
				session.user.email = (token.email as string | null | undefined) ?? session.user.email;
				session.user.image =
					(token.picture as string | null | undefined) ??
					(token.image as string | null | undefined) ??
					session.user.image;
			}
			session.googleSheets = {
				// Intentionally truthiness, not nullish: an empty token string means
				// not connected.
				connected:
					Boolean(token.googleSheetsRefreshToken) || Boolean(token.googleSheetsAccessToken),
				needsReconnect: token.googleSheetsTokenError === "RequiresReconnect",
			};
			return session;
		},
	},
	pages: { signIn: "/login", error: "/login" },
});
