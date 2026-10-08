import "next-auth";

declare module "next-auth" {
	interface Session {
		user: {
			id: string;
			name?: string | null;
			email?: string | null;
			image?: string | null;
		};
		googleSheets?: {
			connected: boolean;
			needsReconnect: boolean;
		};
	}
}

declare module "next-auth/jwt" {
	interface JWT {
		googleSheetsAccessToken?: string;
		googleSheetsRefreshToken?: string;
		googleSheetsExpiresAt?: number;
		googleSheetsScope?: string;
		googleSheetsTokenError?: "RequiresReconnect";
	}
}
