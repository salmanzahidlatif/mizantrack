import type { GoogleSheetsErrorCode } from "@/types";

const GOOGLE_SHEETS_ERROR_MESSAGES = {
	Offline: "You're offline. Connect to the internet, then run the Google Sheets backup again.",
	Unauthorized: "Sign in to MizanTrack again, then reconnect Google Sheets from Settings.",
	NotConnected:
		"Connect Google Sheets from Settings and approve the Drive file permission before backing up.",
	RequiresReconnect:
		"Your Google Sheets connection expired or was revoked. Reconnect Google Sheets. If this happened after about 7 days, set OAuth consent / Google Auth Platform → Audience → Publishing status to In production.",
	SheetMissing:
		"The backup spreadsheet was moved or deleted. Run backup again so MizanTrack can create or find its spreadsheet.",
	SheetForeign:
		"MizanTrack will not write to a spreadsheet it did not create. Disconnect Google Sheets, reconnect, and let MizanTrack create the backup sheet.",
	ConcurrentBackup:
		"A Google Sheets backup is already running. Wait for it to finish, then try again.",
	QuotaExceeded:
		"Google is rate-limiting this backup. Wait a few minutes, then run Back up now again.",
	PayloadTooLarge:
		"One row is too large for Google Sheets. Shorten very long notes, tags, or imported metadata, then try again.",
	PartialWrite:
		"Google accepted only part of the backup. No success was recorded; run Back up now again.",
	GoogleServerError:
		"Google Sheets is temporarily unavailable. Wait a few minutes, then run Back up now again.",
	GoogleApiError:
		"Google rejected the backup request. Make sure Google Sheets API and Google Drive API are enabled, then reconnect Google Sheets if needed.",
	SheetTooLarge:
		"The backup spreadsheet reached a Google Sheets size limit. Move or rename the old backup sheet, then run backup again to create a new one.",
} as const satisfies Record<GoogleSheetsErrorCode, string>;

export function getGoogleSheetsErrorCodeMessage(code: GoogleSheetsErrorCode): string {
	return GOOGLE_SHEETS_ERROR_MESSAGES[code];
}

export class GoogleSheetsBackupError extends Error {
	constructor(
		public readonly code: GoogleSheetsErrorCode,
		message = getGoogleSheetsErrorCodeMessage(code),
		public readonly status?: number
	) {
		super(message || getGoogleSheetsErrorCodeMessage(code));
		this.name = "GoogleSheetsBackupError";
	}
}

export function getGoogleSheetsErrorMessage(error: unknown): string {
	if (error instanceof GoogleSheetsBackupError) {
		return error.message || getGoogleSheetsErrorCodeMessage(error.code);
	}
	if (error instanceof Error) return error.message;
	return "Google Sheets backup failed.";
}
