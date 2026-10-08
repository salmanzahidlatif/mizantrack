import { GoogleSheetsBackupError } from "@/lib/sheets/errors";

export interface BrokeredGoogleAccessToken {
	accessToken: string;
	expiresAt: number;
	scope?: string;
}

export async function fetchGoogleSheetsAccessToken(): Promise<BrokeredGoogleAccessToken> {
	const response = await fetch("/api/google-sheets/token", { cache: "no-store" });
	const data = (await response.json().catch(() => ({}))) as Partial<
		BrokeredGoogleAccessToken & { code: string; error: string }
	>;
	if (!response.ok) {
		throw new GoogleSheetsBackupError(
			(data.code as GoogleSheetsBackupError["code"]) ?? "NotConnected",
			data.error ?? "Connect Google Sheets before backing up.",
			response.status
		);
	}
	if (!data.accessToken || !data.expiresAt) {
		throw new GoogleSheetsBackupError(
			"GoogleApiError",
			"The token broker returned an incomplete response."
		);
	}
	return {
		accessToken: data.accessToken,
		expiresAt: data.expiresAt,
		scope: data.scope,
	};
}
