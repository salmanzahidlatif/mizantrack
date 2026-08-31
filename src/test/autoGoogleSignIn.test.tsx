import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AutoGoogleSignIn } from "@/components/auth/AutoGoogleSignIn";

const mocks = vi.hoisted(() => ({
	signIn: vi.fn(),
}));

vi.mock("next-auth/react", () => ({
	signIn: mocks.signIn,
}));

describe("AutoGoogleSignIn", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.signIn.mockResolvedValue(undefined);
	});

	it("AutoGoogleSignIn_OnLoad_DoesNotAutoRedirect", () => {
		// Browsers (notably iOS Safari / PWA standalone) block navigation that isn't
		// triggered by a real user gesture, so we must never call signIn() on mount.
		render(<AutoGoogleSignIn />);
		expect(mocks.signIn).not.toHaveBeenCalled();
	});

	it("AutoGoogleSignIn_OnButtonClick_CallsSignIn", async () => {
		render(<AutoGoogleSignIn />);

		fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));

		await waitFor(() => expect(mocks.signIn).toHaveBeenCalledTimes(1));
		expect(mocks.signIn).toHaveBeenCalledWith("google", { redirectTo: "/dashboard" });
		expect(screen.getByText("Redirecting to Google…")).toBeInTheDocument();
	});
});
