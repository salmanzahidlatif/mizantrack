/**
 * The Past Remaining control: where the carried figure came from, the override, the
 * reset, and the visual split between an amount still owed and an overpayment.
 *
 * Rendering is checked against the owner's 2024 numbers, so the figures on screen are the
 * same ones `src/test/zakatReconciliation.test.ts` pins the engine to.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ZakatCarryForwardControl } from "@/components/zakat/ZakatCarryForwardControl";
import { calculateZakatAssessment } from "@/lib/zakatEngine";

import type { ZakatCarryForward } from "@/lib/zakatCarryForward";

const saveZakatPastRemainingOverride = vi.fn().mockResolvedValue(undefined);
const clearZakatPastRemainingOverride = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/zakatYearRepository", () => ({
	saveZakatPastRemainingOverride: (...args: unknown[]) =>
		saveZakatPastRemainingOverride(...args) as Promise<void>,
	clearZakatPastRemainingOverride: (...args: unknown[]) =>
		clearZakatPastRemainingOverride(...args) as Promise<void>,
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

function makeAssessment(pastRemaining: number, paid = 285_500) {
	return calculateZakatAssessment({
		monthlyTotals: [2_628_184.68],
		basis: "minimum",
		goldItems: [{ weight: 170.52, purity: "21k" }],
		goldPrices: { priceDate: "2023-03-24", pricesByPurity: { "21k": 18_846.3 } },
		ratePercent: 2.5,
		pastRemaining,
		payments: [{ amount: paid }],
	});
}

function renderControl(carryForward: Partial<ZakatCarryForward> = {}, paid = 285_500) {
	const resolved: ZakatCarryForward = {
		islamicYear: 1444,
		pastRemaining: 88_058,
		source: "auto",
		automatic: 88_058,
		carriedFromIslamicYear: 1443,
		...carryForward,
	};

	return render(
		<ZakatCarryForwardControl
			userId="user-1"
			islamicYear={resolved.islamicYear}
			yearLabel="2024 (1444–1445)"
			currency="PKR"
			carryForward={resolved}
			assessment={makeAssessment(resolved.pastRemaining, paid)}
		/>
	);
}

describe("ZakatCarryForwardControl", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("says which year the figure was carried from", () => {
		renderControl();

		expect(screen.getByText("Carried forward")).toBeInTheDocument();
		expect(screen.getByText(/Carried from the 1443–1444 Balance\/Excess/)).toBeInTheDocument();
		expect(screen.getByLabelText("Past Remaining (PKR)")).toHaveValue(88_058);
	});

	it("carries nothing, and says so, for the earliest year on record", () => {
		renderControl({
			islamicYear: 1440,
			pastRemaining: 0,
			automatic: 0,
			carriedFromIslamicYear: undefined,
		});

		expect(screen.getByText(/first year on record/)).toBeInTheDocument();
		expect(screen.getByLabelText("Past Remaining (PKR)")).toHaveValue(null);
	});

	it("saves a typed figure as an override", async () => {
		renderControl();

		fireEvent.change(screen.getByLabelText("Past Remaining (PKR)"), {
			target: { value: "90000" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() =>
			expect(saveZakatPastRemainingOverride).toHaveBeenCalledWith({
				userId: "user-1",
				islamicYear: 1444,
				pastRemaining: 90_000,
			})
		);
	});

	it("shows the carried figure behind an override, and resets back to it", async () => {
		renderControl({ pastRemaining: 90_000, source: "manual", automatic: 88_057.5221 });

		expect(screen.getByText("Manual")).toBeInTheDocument();
		expect(screen.getByText(/Carried value was/)).toBeInTheDocument();
		expect(screen.getByText(/88,057.52/)).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: /reset to the carried value/i }));

		await waitFor(() =>
			expect(clearZakatPastRemainingOverride).toHaveBeenCalledWith("user-1", 1444)
		);
	});

	it("distinguishes an overpayment from an amount still owed", () => {
		const { unmount } = renderControl();

		// 146,046.3939 + 88,058 - 285,500 = -51,395.6061, i.e. overpaid.
		expect(screen.getByText(/Excess — overpaid/)).toBeInTheDocument();
		expect(screen.getByText(/51,395.61/)).toBeInTheDocument();
		expect(screen.queryByText(/still to pay/i)).not.toBeInTheDocument();
		unmount();

		renderControl({}, 100_000);
		expect(screen.getByText(/Balance — still to pay/)).toBeInTheDocument();
		expect(screen.getByText(/134,104.39/)).toBeInTheDocument();
		expect(screen.queryByText(/overpaid/i)).not.toBeInTheDocument();
	});

	it("shows Total To Pay as this year's zakat plus the carried figure", () => {
		renderControl();

		expect(screen.getByText("Total To Pay")).toBeInTheDocument();
		expect(screen.getByText(/234,104.39/)).toBeInTheDocument();
		expect(screen.getByText(/146,046.39/)).toBeInTheDocument();
	});
});
