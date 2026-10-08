import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RebuildAnalyticsPanel } from "@/components/settings/RebuildAnalyticsPanel";
import { clearAnalyticsCache } from "@/lib/analytics/cache";
import { recomputeAnalyticsNow } from "@/lib/analytics/scheduleRecompute";

vi.mock("@/lib/analytics/cache", () => ({
	clearAnalyticsCache: vi.fn(),
}));

vi.mock("@/lib/analytics/scheduleRecompute", () => ({
	recomputeAnalyticsNow: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

describe("RebuildAnalyticsPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(clearAnalyticsCache).mockResolvedValue(undefined);
		vi.mocked(recomputeAnalyticsNow).mockResolvedValue(undefined);
	});

	it("clears and recomputes derived analytics from Settings", async () => {
		render(<RebuildAnalyticsPanel userId="owner-user" />);

		expect(screen.getByText(/does not edit financial records/i)).toBeInTheDocument();
		fireEvent.click(screen.getByRole("button", { name: /recalculate balances/i }));

		await waitFor(() => {
			expect(clearAnalyticsCache).toHaveBeenCalledWith("owner-user");
			expect(recomputeAnalyticsNow).toHaveBeenCalledWith("owner-user");
		});
		expect(toast.success).toHaveBeenCalledWith(
			"Analytics rebuilt. Balances were recalculated from your saved records."
		);
	});
});
