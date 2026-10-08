import { getToken } from "next-auth/jwt";

import { auth, unstable_update } from "@/lib/auth";
import { GOOGLE_DRIVE_FILE_SCOPE } from "@/lib/sheets/constants";
import { GoogleSheetsBackupError } from "@/lib/sheets/errors";
import { refreshGoogleSheetsAccessToken } from "@/lib/sheets/server/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const EXPIRY_SKEW_MS = 60_000;

function jsonError(error: string, code: string, status: number) {
	return Response.json({ error, code }, { status });
}

async function clearGoogleSheetsTokens() {
	await unstable_update({ googleSheetsTokenUpdate: { type: "clear" } } as never);
}

async function setGoogleSheetsAccessToken(args: {
	accessToken: string;
	expiresAt: number;
	refreshToken?: string;
	scope?: string;
}) {
	await unstable_update({ googleSheetsTokenUpdate: { type: "set", ...args } } as never);
}

export async function GET(request: Request) {
	const session = await auth();
	if (!session?.user?.id) return jsonError("Unauthorized", "Unauthorized", 401);
	const token = await getToken({
		req: request,
		secret: process.env.AUTH_SECRET,
		secureCookie: process.env.NODE_ENV === "production",
	});
	if (!token?.sub || token.sub !== session.user.id) {
		return jsonError("Unauthorized", "Unauthorized", 401);
	}

	const accessToken = token.googleSheetsAccessToken;
	const refreshToken = token.googleSheetsRefreshToken;
	const expiresAt = token.googleSheetsExpiresAt;
	const scope = token.googleSheetsScope;
	const hasDriveScope =
		typeof scope === "string" && scope.split(/\s+/).includes(GOOGLE_DRIVE_FILE_SCOPE);

	if (
		typeof accessToken === "string" &&
		typeof expiresAt === "number" &&
		expiresAt > Date.now() + EXPIRY_SKEW_MS &&
		hasDriveScope
	) {
		return Response.json({ accessToken, expiresAt, scope });
	}
	if (typeof refreshToken !== "string") {
		return jsonError("Connect Google Sheets before backing up.", "NotConnected", 409);
	}

	try {
		const refreshed = await refreshGoogleSheetsAccessToken(refreshToken);
		await setGoogleSheetsAccessToken({
			accessToken: refreshed.accessToken,
			expiresAt: refreshed.expiresAt,
			refreshToken: refreshed.refreshToken ?? refreshToken,
			scope: refreshed.scope ?? scope,
		});
		return Response.json({
			accessToken: refreshed.accessToken,
			expiresAt: refreshed.expiresAt,
			scope: refreshed.scope ?? scope,
		});
	} catch (error) {
		if (error instanceof GoogleSheetsBackupError && error.code === "RequiresReconnect") {
			await clearGoogleSheetsTokens();
			return jsonError(error.message, error.code, 409);
		}
		throw error;
	}
}
