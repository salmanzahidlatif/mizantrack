import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HomePage from "@/app/page";
import PrivacyPage from "@/app/privacy/page";
import TermsOfServicePage from "@/app/terms-of-service/page";
import { OFFLINE_SESSION_STORAGE_KEY } from "@/lib/auth/offline-session";

const router = vi.hoisted(() => ({
	replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useRouter: () => router,
}));

describe("public pages", () => {
	beforeEach(() => {
		localStorage.clear();
		router.replace.mockClear();
	});

	afterEach(() => {
		localStorage.clear();
	});

	it("renders the landing page for an anonymous visitor and explains the app", () => {
		render(<HomePage />);

		expect(
			screen.getByRole("heading", {
				name: /personal finance and zakat tracking without a central data silo/i,
			})
		).toBeInTheDocument();
		expect(screen.getByText(/offline-first PWA/i)).toBeInTheDocument();
		expect(screen.getByText(/accounts and transactions/i)).toBeInTheDocument();
		expect(screen.getByText(/hysab kytab imports/i)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: /sign in with google/i })).toHaveAttribute(
			"href",
			"/login"
		);
		expect(router.replace).not.toHaveBeenCalled();
	});

	it("routes an authenticated visitor from the landing page to the dashboard", async () => {
		localStorage.setItem(
			OFFLINE_SESSION_STORAGE_KEY,
			JSON.stringify({
				user: {
					id: "google-user-1",
					name: "Authenticated User",
					email: "user@example.com",
					image: "https://example.com/avatar.png",
				},
				verifiedAt: Date.now(),
			})
		);

		render(<HomePage />);

		await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
	});

	it("renders the privacy policy without authentication", () => {
		render(<PrivacyPage />);

		expect(screen.getByRole("heading", { name: "Privacy Policy" })).toBeInTheDocument();
		expect(screen.getByText(/indexeddb through dexie/i)).toBeInTheDocument();
		expect(screen.getByText(/drive\.file/i)).toBeInTheDocument();
		expect(router.replace).not.toHaveBeenCalled();
	});

	it("renders the terms of service without authentication", () => {
		render(<TermsOfServicePage />);

		expect(screen.getByRole("heading", { name: "Terms of Service" })).toBeInTheDocument();
		expect(screen.getByText(/provided as is and as available/i)).toBeInTheDocument();
		expect(screen.getByText(/not religious, financial, tax, or legal advice/i)).toBeInTheDocument();
		expect(router.replace).not.toHaveBeenCalled();
	});
});
