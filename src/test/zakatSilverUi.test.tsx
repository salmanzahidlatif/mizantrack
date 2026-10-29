/**
 * The silver inputs, on the screen the owner types them into.
 *
 * Silver sits beside the gold prices because it is priced the same day and belongs to
 * the same year: one weight, one price per gram, and separate totals so the owner can
 * see gold and silver apart before he reads the consolidated figure for the year.
 *
 * Nothing here computes tax. Zakat is a religious obligation.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ZakatGoldYearPricing } from "@/components/zakat/ZakatGoldYearPricing";

import type * as ZakatGoldYearRepositoryModule from "@/lib/zakatGoldYearRepository";
import type { GoldPurity } from "@/types";

type ZakatGoldYearRepository = typeof ZakatGoldYearRepositoryModule;

const USER_ID = "zakat-silver-ui-user";
const CURRENCY = "PKR";
const YEAR_LABEL = "2026 (1446–1447)";

const saveZakatGoldYearPrices = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/zakatGoldYearRepository", async (importOriginal) => ({
	...(await importOriginal<ZakatGoldYearRepository>()),
	clearZakatGoldYear: vi.fn().mockResolvedValue(undefined),
	saveZakatGoldYearPrices: (...args: unknown[]) =>
		saveZakatGoldYearPrices(...args) as Promise<void>,
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

function renderPricing(overrides: Partial<Parameters<typeof ZakatGoldYearPricing>[0]> = {}): void {
	const gramsByPurity = new Map<GoldPurity, number>([["21k", 170.52]]);
	render(
		<ZakatGoldYearPricing
			userId={USER_ID}
			currency={CURRENCY}
			islamicYear={1446}
			yearLabel={YEAR_LABEL}
			pricesByPurity={{ "21k": 18_846.3 }}
			gramsByPurity={gramsByPurity}
			silverGrams={0}
			silverPricePerGram={0}
			priceDate={new Date(2025, 2, 2)}
			goldValue={3_213_671.076}
			silverValue={0}
			totalZakatable={4_213_671.076}
			{...overrides}
		/>
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("the silver inputs", () => {
	it("names both metals in the heading, as the owner asked", () => {
		renderPricing();

		expect(screen.getByText(`Gold / Silver price per gram (${CURRENCY})`)).toBeInTheDocument();
	});

	it("saves the weight and the price per gram against this year", async () => {
		renderPricing();

		fireEvent.change(screen.getByLabelText("Silver held (grams)"), { target: { value: "500" } });
		fireEvent.change(screen.getByLabelText("Silver price per gram"), { target: { value: "210" } });
		fireEvent.click(screen.getByRole("button", { name: "Save" }));

		await waitFor(() => {
			expect(saveZakatGoldYearPrices).toHaveBeenCalledWith(
				expect.objectContaining({
					userId: USER_ID,
					currency: CURRENCY,
					islamicYear: 1446,
					silverGrams: 500,
					silverPricePerGram: 210,
				})
			);
		});
	});

	it("asks for the weight when only a price was typed", () => {
		renderPricing();

		fireEvent.change(screen.getByLabelText("Silver price per gram"), { target: { value: "210" } });

		expect(screen.getByText(/Enter the silver weight too/)).toBeInTheDocument();
	});

	it("shows gold and silver apart, then the year's consolidated total", () => {
		renderPricing({
			silverGrams: 500,
			silverPricePerGram: 210,
			silverValue: 105_000,
			totalZakatable: 4_318_671.076,
		});

		expect(screen.getByText("Gold • 170.52g")).toBeInTheDocument();
		expect(screen.getByText("Silver • 500.00g")).toBeInTheDocument();
		expect(screen.getByText(`Total for ${YEAR_LABEL}`)).toBeInTheDocument();
		expect(screen.getByText(/₨\s?105,000\.00/)).toBeInTheDocument();
		expect(screen.getByText(/₨\s?4,318,671\.08/)).toBeInTheDocument();
	});

	it("opens each year on its own silver rather than the last one typed", () => {
		const { rerender } = render(
			<ZakatGoldYearPricing
				userId={USER_ID}
				currency={CURRENCY}
				islamicYear={1446}
				yearLabel={YEAR_LABEL}
				pricesByPurity={{}}
				gramsByPurity={new Map<GoldPurity, number>()}
				silverGrams={500}
				silverPricePerGram={210}
				priceDate={new Date(2025, 2, 2)}
				goldValue={0}
				silverValue={105_000}
				totalZakatable={105_000}
			/>
		);
		expect(screen.getByLabelText("Silver held (grams)")).toHaveValue(500);

		rerender(
			<ZakatGoldYearPricing
				userId={USER_ID}
				currency={CURRENCY}
				islamicYear={1445}
				yearLabel="2025 (1445–1446)"
				pricesByPurity={{}}
				gramsByPurity={new Map<GoldPurity, number>()}
				silverGrams={0}
				silverPricePerGram={0}
				priceDate={new Date(2024, 2, 12)}
				goldValue={0}
				silverValue={0}
				totalZakatable={0}
			/>
		);
		expect(screen.getByLabelText("Silver held (grams)")).toHaveValue(null);
	});
});
