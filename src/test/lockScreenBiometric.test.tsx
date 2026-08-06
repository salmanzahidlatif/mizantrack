import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LockScreen } from "@/components/layout/LockScreen";
import { useLockStore } from "@/store/lock-store";

import type { DbConfig } from "@/types";

const mocks = vi.hoisted(() => ({
	config: undefined as DbConfig | undefined,
	authenticateBiometric: vi.fn(),
	isBiometricAvailable: vi.fn(() => true),
}));

vi.mock("@/hooks/useDbConfig", () => ({
	useDbConfig: () => mocks.config,
}));

vi.mock("@/lib/webAuthn", () => ({
	authenticateBiometric: mocks.authenticateBiometric,
	isBiometricAvailable: mocks.isBiometricAvailable,
}));

vi.mock("@/lib/pinCrypto", () => ({
	verifyPin: vi.fn(async () => false),
	hashPin: vi.fn(async () => "hash"),
}));

const enrolledConfig = {
	userId: "user-1",
	appLockEnabled: true,
	pinHash: "hash",
	biometricEnabled: true,
	biometricCredentialId: "Y3JlZA==",
} as unknown as DbConfig;

function renderLockScreen(onUnlock = vi.fn()) {
	return { onUnlock, ...render(<LockScreen userId="user-1" onUnlock={onUnlock} />) };
}

describe("LockScreen biometric auto-prompt", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.isBiometricAvailable.mockReturnValue(true);
		mocks.config = undefined;
		useLockStore.getState().resetAttempts();
	});

	it("LockScreen_ConfigResolvesAfterMount_AutoTriggersBiometricPrompt", async () => {
		// Regression: the Dexie live query returns undefined on first render, so a
		// mount-only effect must not be what gates the automatic prompt.
		mocks.authenticateBiometric.mockResolvedValue(true);

		const onUnlock = vi.fn();
		const { rerender } = render(<LockScreen userId="user-1" onUnlock={onUnlock} />);
		expect(mocks.authenticateBiometric).not.toHaveBeenCalled();

		mocks.config = enrolledConfig;
		rerender(<LockScreen userId="user-1" onUnlock={onUnlock} />);

		await waitFor(() => expect(mocks.authenticateBiometric).toHaveBeenCalledTimes(1));
		expect(mocks.authenticateBiometric).toHaveBeenCalledWith("Y3JlZA==");
		await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
	});

	it("LockScreen_BiometricEnrolled_AutoPromptsOnlyOnce", async () => {
		mocks.config = enrolledConfig;
		mocks.authenticateBiometric.mockResolvedValue(false);

		const onUnlock = vi.fn();
		const { rerender } = render(<LockScreen userId="user-1" onUnlock={onUnlock} />);

		await waitFor(() => expect(mocks.authenticateBiometric).toHaveBeenCalledTimes(1));
		rerender(<LockScreen userId="user-1" onUnlock={onUnlock} />);

		expect(mocks.authenticateBiometric).toHaveBeenCalledTimes(1);
		expect(onUnlock).not.toHaveBeenCalled();
	});

	it("LockScreen_BiometricDismissed_ManualButtonRetriggersPrompt", async () => {
		mocks.config = enrolledConfig;
		mocks.authenticateBiometric.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

		const { onUnlock } = renderLockScreen();
		await waitFor(() => expect(mocks.authenticateBiometric).toHaveBeenCalledTimes(1));

		const button = await screen.findByRole("button", {
			name: /unlock with face id or fingerprint/i,
		});
		await waitFor(() => expect(button).toBeEnabled());

		await act(async () => {
			fireEvent.click(button);
		});

		await waitFor(() => expect(mocks.authenticateBiometric).toHaveBeenCalledTimes(2));
		await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1));
	});

	it("LockScreen_BiometricThrows_FallsBackToPinAndKeepsButtonUsable", async () => {
		mocks.config = enrolledConfig;
		mocks.authenticateBiometric.mockRejectedValue(new Error("no user activation"));

		const { onUnlock } = renderLockScreen();

		await waitFor(() => expect(mocks.authenticateBiometric).toHaveBeenCalledTimes(1));
		expect(onUnlock).not.toHaveBeenCalled();

		const button = await screen.findByRole("button", {
			name: /unlock with face id or fingerprint/i,
		});
		await waitFor(() => expect(button).toBeEnabled());
		expect(screen.getByRole("button", { name: "1" })).toBeEnabled();
	});

	it("LockScreen_BiometricDisabled_DoesNotPromptAndHidesButton", async () => {
		mocks.config = {
			...enrolledConfig,
			biometricEnabled: false,
			biometricCredentialId: undefined,
		} as unknown as DbConfig;

		renderLockScreen();

		await waitFor(() => expect(screen.getByRole("button", { name: "1" })).toBeEnabled());
		expect(mocks.authenticateBiometric).not.toHaveBeenCalled();
		expect(
			screen.getByRole("button", { name: /unlock with face id or fingerprint/i })
		).toBeDisabled();
	});

	it("LockScreen_WebAuthnUnavailable_DoesNotAutoPrompt", async () => {
		mocks.config = enrolledConfig;
		mocks.isBiometricAvailable.mockReturnValue(false);

		renderLockScreen();

		await waitFor(() => expect(screen.getByRole("button", { name: "1" })).toBeEnabled());
		expect(mocks.authenticateBiometric).not.toHaveBeenCalled();
	});
});
