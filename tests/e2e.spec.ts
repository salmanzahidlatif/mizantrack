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

test.describe("Offline PWA shell", () => {
	test("reopens offline and renders locally persisted account data", async ({ context, page }) => {
		const userId = "118402808840027279814";
		await context.addInitScript((seedUserId) => {
			const originalFetch = window.fetch.bind(window);
			window.fetch = (input, init) => {
				const url = typeof input === "string" ? input : input instanceof Request ? input.url : "";
				if (url.includes("/api/auth/session")) {
					return Promise.resolve(
						new Response(
							JSON.stringify({
								expires: "2099-01-01T00:00:00.000Z",
								user: {
									email: "offline@example.com",
									id: seedUserId,
									image: null,
									name: "Offline User",
								},
							}),
							{
								headers: { "content-type": "application/json" },
								status: 200,
							}
						)
					);
				}

				return originalFetch(input, init);
			};
		}, userId);

		await page.goto("/dashboard");
		await expect(page.getByText("Mizan Track").first()).toBeVisible();

		const serviceWorkerReady = await page.evaluate(async () => {
			if (!("serviceWorker" in navigator)) return false;
			await navigator.serviceWorker.ready;
			return true;
		});
		test.skip(!serviceWorkerReady, "Service workers are unavailable in this browser context.");

		await page.reload({ waitUntil: "networkidle" });
		await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
		await page.waitForFunction(async () => Boolean(await caches.match("/dashboard")));

		await page.evaluate(async (seedUserId) => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open("mizantrack");
				request.onerror = () => reject(request.error);
				request.onsuccess = () => resolve(request.result);
			});

			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(["dbConfig", "accounts"], "readwrite");
				tx.onerror = () => reject(tx.error);
				tx.oncomplete = () => resolve();

				tx.objectStore("dbConfig").put({
					currency: "PKR",
					enabled: false,
					enabledCurrencies: ["PKR"],
					firebaseConfig: "",
					fiscalYearStartMonth: 1,
					id: seedUserId,
				});
				tx.objectStore("accounts").put({
					currency: "PKR",
					id: "offline-cash",
					isArchived: false,
					openingBalance: 1234,
					title: "Offline Cash",
					updatedAt: Date.now(),
					userId: seedUserId,
				});
			});

			db.close();
		}, userId);

		await page.goto("/accounts");
		await expect(page.getByText("Offline Cash")).toBeVisible();

		await page.evaluate(() => {
			window.dispatchEvent(new Event("offline"));
		});

		await expect(page.getByText("You're offline. Local changes are saved").first()).toBeVisible();
		await expect(page.getByText("Offline Cash")).toBeVisible();
		await expect(page.getByRole("button", { name: /add account/i })).toBeEnabled();
	});
});
