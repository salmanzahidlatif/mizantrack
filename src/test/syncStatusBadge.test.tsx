import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { SyncStatusBadge } from "@/components/layout/SyncStatusBadge";
import { useSyncStore } from "@/store/sync-store";

describe("SyncStatusBadge", () => {
	beforeEach(() => {
		useSyncStore.setState({
			error: "Sync timed out while pulling categories. Check your connection and try again.",
			lastSync: Date.now() - 60_000,
			lastSyncResult: null,
			lastSyncUserId: "user-1",
			suppressAutoSyncUntil: null,
			syncErrorDetails: {
				message: "Sync timed out while pulling categories. Check your connection and try again.",
				occurredAt: Date.now(),
				lastSuccessfulSync: Date.now() - 60_000,
				quotaExceeded: false,
				tableFailures: [
					{
						table: "categories",
						message: "Timed out while pulling categories",
					},
				],
			},
			syncProgress: null,
			syncing: false,
		});
	});

	it("reveals sync error details on activation", async () => {
		render(<SyncStatusBadge />);

		fireEvent.click(screen.getByRole("button", { name: /sync error/i }));

		await waitFor(() =>
			expect(
				screen.getByText(
					"Sync timed out while pulling categories. Check your connection and try again."
				)
			).toBeInTheDocument()
		);
		expect(screen.getByText("categories")).toBeInTheDocument();
		expect(screen.getByText("Timed out while pulling categories")).toBeInTheDocument();
		expect(screen.getByText(/Last successful sync:/i)).toBeInTheDocument();
		expect(screen.getByRole("button", { name: /retry sync/i })).toBeInTheDocument();
	});
});
