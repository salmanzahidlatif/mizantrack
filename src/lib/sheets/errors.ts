import type { GoogleSheetsErrorCode } from "@/types";

export class GoogleSheetsBackupError extends Error {
	constructor(
		public readonly code: GoogleSheetsErrorCode,
		message: string,
		public readonly status?: number
	) {
		super(message);
		this.name = "GoogleSheetsBackupError";
	}
}

export function getGoogleSheetsErrorMessage(error: unknown): string {
	if (error instanceof GoogleSheetsBackupError) return error.message;
	if (error instanceof Error) return error.message;
	return "Google Sheets backup failed.";
}
