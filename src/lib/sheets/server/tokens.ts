import "server-only";

import { GoogleSheetsBackupError } from "@/lib/sheets/errors";

export interface GoogleOAuthTokenResponse {
	accessToken: string;
	expiresAt: number;
	scope?: string;
	refreshToken?: string;
}

interface GoogleOAuthErrorResponse {
	error?: string;
	error_description?: string;
}

export async function refreshGoogleSheetsAccessToken(
	refreshToken: string
): Promise<GoogleOAuthTokenResponse> {
	const response = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			client_id: process.env.AUTH_GOOGLE_ID ?? "",
			client_secret: process.env.AUTH_GOOGLE_SECRET ?? "",
			grant_type: "refresh_token",
			refresh_token: refreshToken,
		}),
		cache: "no-store",
	});
	const data = (await response.json().catch(() => ({}))) as Partial<
		GoogleOAuthTokenResponse & {
			access_token: string;
			expires_in: number;
			refresh_token: string;
		} & GoogleOAuthErrorResponse
	>;

	if (!response.ok) {
		if (data.error === "invalid_grant") {
			throw new GoogleSheetsBackupError(
				"RequiresReconnect",
				"Your Google Sheets refresh token expired or was revoked. Reconnect Google Sheets. If this happened after about 7 days, set OAuth consent / Google Auth Platform → Audience → Publishing status to In production.",
				response.status
			);
		}
		throw new GoogleSheetsBackupError(
			"GoogleApiError",
			data.error_description ?? data.error ?? "Google rejected the token refresh request.",
			response.status
		);
	}

	if (!data.access_token || !data.expires_in) {
		throw new GoogleSheetsBackupError(
			"GoogleApiError",
			"Google returned an incomplete token refresh response."
		);
	}

	return {
		accessToken: data.access_token,
		expiresAt: Date.now() + data.expires_in * 1000,
		scope: typeof data.scope === "string" ? data.scope : undefined,
		refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
	};
}
