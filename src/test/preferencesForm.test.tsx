import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PreferencesForm } from "@/components/settings/PreferencesForm";
import { db } from "@/lib/db/local";
import { listFiscalYearOptions } from "@/lib/reports/reportFiscalYears";

const USER_ID = "preferences-form-user";
const UTC_OFFSET_MINUTES = 0;

vi.mock("next-themes", () => ({
	useTheme: () => ({ theme: "system", setTheme: vi.fn() }),
}));

vi.mock("@/components/shared/CurrencyPicker", () => ({
	CurrencyPicker: ({ onChange }: { onChange: (codes: string[]) => void }) => (
		<button type="button" onClick={() => onChange(["AED"])}>
			pick AED
		</button>
	),
}));

beforeAll(() => {
	Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: () => {},
	});
});

beforeEach(async () => {
	await db.dbConfig.clear();
});

afterEach(() => {
	cleanup();
});

/**
 * A record written before the gold API key and the fiscal-month control were dropped:
 * an April fiscal year, a stored key and the dead price cache.
 */
async function seedLegacyConfig() {
	await db.dbConfig.put({
		id: USER_ID,
		firebaseConfig: "",
		enabled: false,
		currency: "PKR",
		fiscalYearStartMonth: 4,
		enabledCurrencies: ["PKR"],
		goldApiKey: "legacy-gold-api-key",
		lastGoldPricePerGram: 18_846.3,
		lastGoldPriceFetchedAt: 1_700_000_000_000,
	});
}

/** Triggers the only remaining write path: changing the enabled currencies. */
async function saveFromTheForm() {
	fireEvent.click(await screen.findByRole("button", { name: "pick AED" }));
	await waitFor(
		async () => {
			expect((await db.dbConfig.get(USER_ID))?.currency).toBe("AED");
		},
		{ timeout: 3000 }
	);
}

describe("PreferencesForm — removed controls", () => {
	it("no longer offers a gold price API key field", async () => {
		await seedLegacyConfig();
		render(<PreferencesForm userId={USER_ID} />);

		await screen.findByText("Preferences");

		expect(screen.queryByLabelText(/gold price api key/i)).toBeNull();
		expect(screen.queryByPlaceholderText(/goldapi\.io/i)).toBeNull();
		expect(screen.queryByText(/live gold prices/i)).toBeNull();
	});

	it("no longer offers a fiscal year start month control", async () => {
		await seedLegacyConfig();
		render(<PreferencesForm userId={USER_ID} />);

		await screen.findByText("Preferences");

		expect(screen.queryByText(/fiscal year start month/i)).toBeNull();
		expect(screen.queryByRole("combobox")).toBeNull();
		for (const month of ["January", "April", "July", "October"]) {
			expect(screen.queryByText(month)).toBeNull();
		}
	});
});

describe("PreferencesForm — stored values the form no longer edits", () => {
	it("leaves a non-July fiscal month and the legacy gold fields untouched on save", async () => {
		await seedLegacyConfig();
		render(<PreferencesForm userId={USER_ID} />);
		await saveFromTheForm();

		const config = await db.dbConfig.get(USER_ID);
		expect(config?.fiscalYearStartMonth).toBe(4);
		expect(config?.goldApiKey).toBe("legacy-gold-api-key");
		expect(config?.lastGoldPricePerGram).toBe(18_846.3);
		expect(config?.lastGoldPriceFetchedAt).toBe(1_700_000_000_000);
	});

	it("creates a record with a valid fiscal month when none exists yet", async () => {
		render(<PreferencesForm userId={USER_ID} />);
		await saveFromTheForm();

		const config = await db.dbConfig.get(USER_ID);
		expect(config?.fiscalYearStartMonth).toBe(7);
		expect(config?.goldApiKey).toBeUndefined();
	});
});

describe("a stored fiscal month is still honoured once it is no longer settable", () => {
	it("drives the reports fiscal-year options from the stored April value", async () => {
		await seedLegacyConfig();
		render(<PreferencesForm userId={USER_ID} />);
		await saveFromTheForm();

		const stored = await db.dbConfig.get(USER_ID);
		const options = listFiscalYearOptions({
			fiscalYearStartMonth: stored?.fiscalYearStartMonth ?? 7,
			earliestTransactionMs: Date.UTC(2022, 5, 1),
			now: new Date(Date.UTC(2024, 2, 15)),
			timeZoneOffsetMinutes: UTC_OFFSET_MINUTES,
		});

		// April start ⇒ the year holding 15 Mar 2024 runs 1 Apr 2023 – 31 Mar 2024.
		expect(options[0]?.label).toBe("2023 - 2024");
		expect(options[0]?.fromMs).toBe(Date.UTC(2023, 3, 1));
		expect(options[0]?.toMs).toBe(Date.UTC(2024, 3, 1) - 1);
		expect(options.map((option) => option.label)).toEqual(["2023 - 2024", "2022 - 2023"]);
	});

	it("produces different periods than the July default, proving the value is read", async () => {
		await seedLegacyConfig();
		const stored = await db.dbConfig.get(USER_ID);
		const shared = {
			now: new Date(Date.UTC(2024, 2, 15)),
			timeZoneOffsetMinutes: UTC_OFFSET_MINUTES,
		};

		const april = listFiscalYearOptions({
			fiscalYearStartMonth: stored?.fiscalYearStartMonth ?? 7,
			...shared,
		});
		const july = listFiscalYearOptions({ fiscalYearStartMonth: 7, ...shared });

		expect(april[0]?.fromMs).toBe(Date.UTC(2023, 3, 1));
		expect(july[0]?.fromMs).toBe(Date.UTC(2023, 6, 1));
		expect(april[0]?.fromMs).not.toBe(july[0]?.fromMs);
	});
});
