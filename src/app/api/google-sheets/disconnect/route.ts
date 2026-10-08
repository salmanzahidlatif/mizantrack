import { getToken } from "next-auth/jwt";

import { auth, unstable_update } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function revokeGoogleToken(token: string): Promise<void> {
	await fetch("https://oauth2.googleapis.com/revoke", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ token }),
		cache: "no-store",
	}).catch(() => undefined);
}

export async function POST(request: Request) {
	const session = await auth();
	if (!session?.user?.id) {
		return Response.json({ error: "Unauthorized", code: "Unauthorized" }, { status: 401 });
	}
	const token = await getToken({
		req: request,
		secret: process.env.AUTH_SECRET,
		secureCookie: process.env.NODE_ENV === "production",
	});
	if (!token?.sub || token.sub !== session.user.id) {
		return Response.json({ error: "Unauthorized", code: "Unauthorized" }, { status: 401 });
	}
	const revokeToken = token.googleSheetsRefreshToken ?? token.googleSheetsAccessToken;
	if (typeof revokeToken === "string") await revokeGoogleToken(revokeToken);
	await unstable_update({ googleSheetsTokenUpdate: { type: "clear" } } as never);
	return Response.json({ ok: true });
}
