import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import { resolveSessionUserId } from "@/lib/auth/session";

export const { handlers, signIn, signOut, auth } = NextAuth({
	providers: [
		GoogleProvider({
			clientId: process.env.AUTH_GOOGLE_ID!,
			clientSecret: process.env.AUTH_GOOGLE_SECRET!,
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
		session({ session, token }) {
			if (session.user) {
				session.user.id = resolveSessionUserId(token) ?? "";
			}

			return session;
		},
	},
	pages: { signIn: "/login" },
});
