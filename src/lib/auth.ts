import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import { pinTokenSubToProvider, resolveSessionUserId } from "@/lib/auth/session";

export const { handlers, signIn, signOut, auth } = NextAuth({
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
		jwt({ token, account }) {
			// NextAuth v5 sets user.id = crypto.randomUUID() on every sign-in — NOT the
			// Google account sub. Without this callback, token.sub is a fresh UUID on every
			// new session, so local dev and production generate different userIds for the
			// same Google account, breaking cross-environment Firestore sync.
			// Fix: pin token.sub to account.providerAccountId (Google's stable numeric sub)
			// on initial sign-in. Subsequent requests have account=null; token.sub persists.
			return pinTokenSubToProvider(token, account) as typeof token;
		},
		session({ session, token }) {
			if (session.user) {
				session.user.id = resolveSessionUserId(token) ?? "";
			}

			return session;
		},
	},
	pages: { signIn: "/login" },
});
