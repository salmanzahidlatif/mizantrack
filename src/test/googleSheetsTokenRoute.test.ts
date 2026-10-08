import { getToken } from "next-auth/jwt";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/google-sheets/token/route";
import { auth, unstable_update } from "@/lib/auth";
import { refreshGoogleSheetsAccessToken } from "@/lib/sheets/server/tokens";

vi.mock("next-auth/jwt", () => ({
	getToken: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	auth: vi.fn(),
	unstable_update: vi.fn(),
}));

vi.mock("@/lib/sheets/server/tokens", () => ({
	refreshGoogleSheetsAccessToken: vi.fn(),
}));

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const authMock = vi.mocked(
	auth as unknown as () => Promise<{ user: { id: string }; expires: string }>
);

beforeEach(() => {
	vi.clearAllMocks();
	authMock.mockResolvedValue({
		user: { id: "google-user" },
		expires: new Date(Date.now() + 3_600_000).toISOString(),
	});
});

describe("/api/google-sheets/token", () => {
	it("returns only a browser-safe access token when the stored access token is fresh", async () => {
		vi.mocked(getToken).mockResolvedValue({
			sub: "google-user",
			googleSheetsAccessToken: "access-token",
			googleSheetsRefreshToken: "secret-refresh-token",
			googleSheetsExpiresAt: Date.now() + 3_600_000,
			googleSheetsScope: `openid email profile ${DRIVE_SCOPE}`,
		});

		const response = await GET(new Request("https://mizantrack.test/api/google-sheets/token"));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({
			accessToken: "access-token",
			expiresAt: expect.any(Number),
			scope: `openid email profile ${DRIVE_SCOPE}`,
		});
		expect(JSON.stringify(body)).not.toContain("secret-refresh-token");
	});

	it("does not return a refresh token even when Google rotates it during refresh", async () => {
		vi.mocked(getToken).mockResolvedValue({
			sub: "google-user",
			googleSheetsRefreshToken: "old-secret-refresh-token",
			googleSheetsExpiresAt: Date.now() - 1,
			googleSheetsScope: `openid email profile ${DRIVE_SCOPE}`,
		});
		vi.mocked(refreshGoogleSheetsAccessToken).mockResolvedValue({
			accessToken: "new-access-token",
			expiresAt: Date.now() + 3_600_000,
			scope: `openid email profile ${DRIVE_SCOPE}`,
			refreshToken: "new-secret-refresh-token",
		});

		const response = await GET(new Request("https://mizantrack.test/api/google-sheets/token"));
		const body = await response.json();

		expect(response.status).toBe(200);
		expect(body).toEqual({
			accessToken: "new-access-token",
			expiresAt: expect.any(Number),
			scope: `openid email profile ${DRIVE_SCOPE}`,
		});
		expect(JSON.stringify(body)).not.toContain("old-secret-refresh-token");
		expect(JSON.stringify(body)).not.toContain("new-secret-refresh-token");
		expect(unstable_update).toHaveBeenCalledWith({
			googleSheetsTokenUpdate: {
				type: "set",
				accessToken: "new-access-token",
				expiresAt: expect.any(Number),
				refreshToken: "new-secret-refresh-token",
				scope: `openid email profile ${DRIVE_SCOPE}`,
			},
		});
	});
});
