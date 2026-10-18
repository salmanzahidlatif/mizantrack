/**
 * Selling a gold piece, on the screen the owner does it from.
 *
 * Selling and removing are different acts and must look different. Selling says the piece
 * left the holding FROM this zakat year on — the owner sold a 10 g piece and bought 14 g
 * of 22k instead, so the replacement serves the year of the sale — and it stays on the
 * record, marked, with the last year that counts it named. Removing is how a mis-typed
 * entry is corrected: it touches one year and leaves no trace.
 *
 * Nothing here computes tax. Zakat is a religious obligation.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ZakatGoldYearInventory } from "@/components/zakat/ZakatGoldYearInventory";

import type * as ZakatGoldYearItemRepositoryModule from "@/lib/zakatGoldYearItemRepository";
import type { GoldPurity, ZakatGoldYearItem } from "@/types";

type ZakatGoldYearItemRepository = typeof ZakatGoldYearItemRepositoryModule;

const USER_ID = "zakat-gold-sold-ui-user";
const CURRENCY = "PKR";
const YEAR_LABEL = "2026 (1446–1447)";

const markZakatGoldYearItemSold = vi.fn().mockResolvedValue(undefined);
const clearZakatGoldYearItemSold = vi.fn().mockResolvedValue(undefined);
const deleteZakatGoldYearItem = vi.fn().mockResolvedValue(undefined);

vi.mock("@/lib/zakatGoldYearItemRepository", async (importOriginal) => ({
	...(await importOriginal<ZakatGoldYearItemRepository>()),
	applyZakatGoldYearItemsToRange: vi.fn().mockResolvedValue([]),
	copyZakatGoldYearItems: vi.fn().mockResolvedValue([]),
	ensureZakatGoldYearItems: vi.fn().mockResolvedValue({ items: [], origin: "empty" }),
	saveZakatGoldYearItem: vi.fn().mockResolvedValue(undefined),
	markZakatGoldYearItemSold: (...args: unknown[]) =>
		markZakatGoldYearItemSold(...args) as Promise<void>,
	clearZakatGoldYearItemSold: (...args: unknown[]) =>
		clearZakatGoldYearItemSold(...args) as Promise<void>,
	deleteZakatGoldYearItem: (...args: unknown[]) =>
		deleteZakatGoldYearItem(...args) as Promise<void>,
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

function item(
	islamicYear: number,
	lineageId: string,
	patch: Partial<ZakatGoldYearItem> = {}
): ZakatGoldYearItem {
	return {
		id: `${USER_ID}:${CURRENCY}:${islamicYear}:${lineageId}`,
		userId: USER_ID,
		currency: CURRENCY,
		islamicYear,
		lineageId,
		title: "Chain",
		weight: 10,
		purity: "21k" as GoldPurity,
		createdAt: 1_000,
		updatedAt: 2_000,
		...patch,
	};
}

function renderInventory({
	islamicYear = 1446,
	ledgerItems,
	soldLineages = new Map<string, number>(),
}: {
	islamicYear?: number;
	ledgerItems: ZakatGoldYearItem[];
	soldLineages?: Map<string, number>;
}) {
	const held = ledgerItems.filter((piece) => {
		const soldFrom = soldLineages.get(piece.lineageId);
		return soldFrom === undefined || islamicYear < soldFrom;
	});

	return render(
		<ZakatGoldYearInventory
			userId={USER_ID}
			currency={CURRENCY}
			islamicYear={islamicYear}
			yearLabel={YEAR_LABEL}
			items={held}
			ledgerItems={ledgerItems}
			itemsByYear={new Map([[islamicYear, held]])}
			soldLineages={soldLineages}
			availableIslamicYears={[1444, 1445, 1446, 1447]}
			pricesByPurity={{ "21k": 18_846.3 }}
		/>
	);
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("marking a gold piece sold", () => {
	it("records the sale against the year on screen", async () => {
		renderInventory({ ledgerItems: [item(1446, "chain")] });

		fireEvent.click(screen.getByLabelText(`Mark Chain sold in ${YEAR_LABEL}`));

		await waitFor(() => {
			expect(markZakatGoldYearItemSold).toHaveBeenCalledWith({
				userId: USER_ID,
				currency: CURRENCY,
				islamicYear: 1446,
				lineageId: "chain",
			});
		});
	});

	it("keeps the sold piece on screen, marked, with the last year that counts it", () => {
		renderInventory({
			ledgerItems: [item(1446, "chain", { soldInIslamicYear: 1446 })],
			soldLineages: new Map([["chain", 1446]]),
		});

		const row = screen.getByText("Chain").closest("[data-sold]")!;
		expect(within(row as HTMLElement).getByText("Sold")).toBeInTheDocument();
		expect(screen.getByText(/Sold in 1446 • last counted in 1445/)).toBeInTheDocument();
		expect(screen.getByText(/not counted this year/)).toBeInTheDocument();
	});

	it("says a piece is sold later while the year on screen still counts it", () => {
		renderInventory({
			islamicYear: 1445,
			ledgerItems: [item(1445, "chain")],
			soldLineages: new Map([["chain", 1446]]),
		});

		expect(screen.getByText("Chain").closest("[data-sold]")).toBeNull();
		expect(screen.getByText(/Sold in 1446 • last counted in 1445/)).toBeInTheDocument();
		// Still counted here: this year's total is the piece's weight.
		expect(screen.getByText("10.00g")).toBeInTheDocument();
	});

	it("leaves a sold piece out of the year's total", () => {
		renderInventory({
			ledgerItems: [
				item(1446, "chain", { soldInIslamicYear: 1446 }),
				item(1446, "bangles", { title: "Bangles", weight: 58.4 }),
			],
			soldLineages: new Map([["chain", 1446]]),
		});

		expect(screen.getByText("58.40g")).toBeInTheDocument();
	});

	it("offers taking the sale back instead of a removal", async () => {
		renderInventory({
			ledgerItems: [item(1446, "chain", { soldInIslamicYear: 1446 })],
			soldLineages: new Map([["chain", 1446]]),
		});

		expect(screen.queryByLabelText(`Remove Chain from ${YEAR_LABEL}`)).not.toBeInTheDocument();
		fireEvent.click(screen.getByLabelText("Take back the sale of Chain"));

		await waitFor(() => {
			expect(clearZakatGoldYearItemSold).toHaveBeenCalledWith({
				userId: USER_ID,
				currency: CURRENCY,
				lineageId: "chain",
			});
		});
	});
});

describe("removing a gold piece", () => {
	it("stays available, and separate from selling", async () => {
		renderInventory({ ledgerItems: [item(1446, "chain")] });

		expect(screen.getByLabelText(`Mark Chain sold in ${YEAR_LABEL}`)).toBeInTheDocument();
		fireEvent.click(screen.getByLabelText(`Remove Chain from ${YEAR_LABEL}`));

		await waitFor(() => {
			expect(deleteZakatGoldYearItem).toHaveBeenCalledWith(USER_ID, CURRENCY, 1446, "chain");
		});
		expect(markZakatGoldYearItemSold).not.toHaveBeenCalled();
	});
});
