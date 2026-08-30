import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTO_GOOGLE_SIGNIN_STORAGE_KEY, AutoGoogleSignIn } from "@/components/auth/AutoGoogleSignIn";

const mocks = vi.hoisted(() => ({
	signIn: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
	signIn: mocks.signIn,
}));

describe("AutoGoogleSignIn", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sessionStorage.clear();
		mocks.signIn.mockResolvedValue(undefined);
	});

	it("AutoGoogleSignIn_FirstVisit_AutoRedirectsAndSetsSessionGuard", async () => {
		render(<AutoGoogleSignIn />);

		await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(1));
		expect(mocks.signIn).toHaveBeenCalledWith("google", { redirectTo: "/dashboard" });
		expect(sessionStorage.getItem(AUTO_GOOGLE_SIGNIN_STORAGE_KEY)).toBe("1");
		expect(screen.getByText("Redirecting to Google…")).toBeInTheDocument();
	});

	it("AutoGoogleSignIn_WhenSessionGuardExists_SkipsAutoRedirectButAllowsManualRetry", async () => {
		sessionStorage.setItem(AUTO_GOOGLE_SIGNIN_STORAGE_KEY, "1");
		render(<AutoGoogleSignIn />);

		await waitFor(() => expect(screen.getByRole("button", { name: /continue with google/i })).toBeEnabled());
		expect(mocks.signIn).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));

		await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(1));
		expect(mocks.signIn).toHaveBeenCalledWith("google", { redirectTo: "/dashboard" });
	});
});
