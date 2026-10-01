import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RegisterSW from "@/components/layout/RegisterSW";

const toastMock = vi.hoisted(() => ({
	toast: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: toastMock.toast,
}));

describe("RegisterSW", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("registers /sw.js with cache-bypassing update checks", async () => {
		const register = vi.fn().mockResolvedValue({
			addEventListener: vi.fn(),
			update: vi.fn(),
			waiting: null,
		});
		const addEventListener = vi.fn();
		const removeEventListener = vi.fn();

		Object.defineProperty(navigator, "serviceWorker", {
			configurable: true,
			value: {
				addEventListener,
				controller: null,
				register,
				removeEventListener,
			},
		});

		render(<RegisterSW />);

		await waitFor(() => {
			expect(register).toHaveBeenCalledWith("/sw.js", { updateViaCache: "none" });
		});
		expect(addEventListener).toHaveBeenCalledWith("controllerchange", expect.any(Function));
	});

	it("does not reload on first service worker control", async () => {
		let controllerChange: (() => void) | undefined;
		Object.defineProperty(navigator, "serviceWorker", {
			configurable: true,
			value: {
				addEventListener: vi.fn((event, handler) => {
					if (event === "controllerchange") controllerChange = handler;
				}),
				controller: null,
				register: vi.fn().mockResolvedValue({
					addEventListener: vi.fn(),
					update: vi.fn(),
					waiting: null,
				}),
				removeEventListener: vi.fn(),
			},
		});

		render(<RegisterSW />);
		await waitFor(() => expect(controllerChange).toBeDefined());

		controllerChange?.();

		expect(toastMock.toast).not.toHaveBeenCalled();
	});
});
