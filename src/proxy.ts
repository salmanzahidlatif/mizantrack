import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";

export default auth((req) => {
	const isLoggedIn = !!req.auth;
	const isLoginPage = req.nextUrl.pathname.startsWith("/login");

	if (!isLoggedIn && !isLoginPage) {
		return NextResponse.redirect(new URL("/login", req.nextUrl));
	}

	if (isLoggedIn && isLoginPage) {
		return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
	}

	return NextResponse.next();
});

export const config = {
	// Exclude: API routes, Next.js internals, static files, public assets, auth pages, and the offline fallback
	matcher: [
		"/((?!api|_next/static|_next/image|_next/data|favicon\\.ico|manifest\\.json|icon-.*\\.png|sw\\.js|workbox-.*\\.js|offline|login).*)",
	],
};
