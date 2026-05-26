/**
 * Sprint 6 E2E skeleton tests — require a running dev server.
 * Run with: npx playwright test (after `npm run dev`)
 */
import { expect, test } from "@playwright/test";

// These tests assume the user is authenticated.
// In CI, wire up a test session or use the login flow.

test.describe("Navigation", () => {
	test("login page loads", async ({ page }) => {
		await page.goto("/login");
		await expect(page).toHaveTitle(/MizanTrack/i);
	});

	test("redirects unauthenticated users to login", async ({ page }) => {
		await page.goto("/dashboard");
		// Should end up on /login if not authenticated
		await expect(page).toHaveURL(/login/);
	});
});

test.describe("PWA manifest", () => {
	test("manifest.json is accessible", async ({ page }) => {
		const response = await page.goto("/manifest.json");
		expect(response?.status()).toBe(200);
	});
});
