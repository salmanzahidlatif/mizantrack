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

function scopeMissingError() {
	return jsonError(
		"Google Sheets permission was not granted. Reconnect Google Sheets and approve https://www.googleapis.com/auth/drive.file only.",
		"NotConnected",
		409
	);
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
	const hasFreshAccessToken =
		typeof accessToken === "string" &&
		typeof expiresAt === "number" &&
		expiresAt > Date.now() + EXPIRY_SKEW_MS;

	if (hasFreshAccessToken && hasDriveScope) {
		return Response.json({ accessToken, expiresAt, scope });
	}
	if (hasFreshAccessToken && !hasDriveScope) {
		return scopeMissingError();
	}
	if (typeof refreshToken !== "string") {
		return jsonError("Connect Google Sheets before backing up.", "NotConnected", 409);
	}

	try {
		const refreshed = await refreshGoogleSheetsAccessToken(refreshToken);
		const refreshedScope = refreshed.scope ?? scope;
		if (
			typeof refreshedScope !== "string" ||
			!refreshedScope.split(/\s+/).includes(GOOGLE_DRIVE_FILE_SCOPE)
		) {
			return scopeMissingError();
		}
		await setGoogleSheetsAccessToken({
			accessToken: refreshed.accessToken,
			expiresAt: refreshed.expiresAt,
			refreshToken: refreshed.refreshToken ?? refreshToken,
			scope: refreshedScope,
		});
		return Response.json({
			accessToken: refreshed.accessToken,
			expiresAt: refreshed.expiresAt,
			scope: refreshedScope,
		});
	} catch (error) {
		if (error instanceof GoogleSheetsBackupError && error.code === "RequiresReconnect") {
			await clearGoogleSheetsTokens();
			return jsonError(error.message, error.code, 409);
		}
		throw error;
	}
}
