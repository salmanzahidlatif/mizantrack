"use server";

import { signIn } from "@/lib/auth";
import { GOOGLE_SHEETS_INCREMENTAL_SCOPE } from "@/lib/sheets/constants";

export async function connectGoogleSheetsAction() {
	await signIn(
		"google",
		{ redirectTo: "/settings?sheets=connected" },
		{
			scope: GOOGLE_SHEETS_INCREMENTAL_SCOPE,
			access_type: "offline",
			prompt: "consent",
			include_granted_scopes: "true",
		}
	);
}
