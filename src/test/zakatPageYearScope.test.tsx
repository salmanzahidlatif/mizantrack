/**
 * The zakat year is chosen ONCE, above the tabs, and every tab answers for it.
 *
 * The owner's complaint was concrete: "Zakat Year Calendar section is only being shared
 * in calculator and monthly view, it is not showing in history and payments section even
 * though it reflects data based on zakat year selected." A control that scopes the whole
 * page does not belong inside two of the four views it scopes, so it was lifted out — and
 * what these tests pin is that it is rendered once, above the tab bar, and that changing
 * the year there reaches the calculator, the month grid, the payments and the history.
 *
 * They also pin what a saved calculation records: only the accounts the year was actually
 * assessed on. A snapshot is evidence of a determination, so listing every account in the
 * currency would have it claim that accounts the owner excluded took part in the figure.
 *
 * Nothing here computes tax. Zakat is a religious obligation.
 */
import "fake-indexeddb/auto";

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db/local";
import { getZakatYearDefinitionByIslamicYear } from "@/lib/zakatEngine";
import { prepareZakatYearAssessmentContext } from "@/lib/zakatYearAssessment";

import type * as ZakatGoldYearItemRepositoryModule from "@/lib/zakatGoldYearItemRepository";
import type { ZakatYearAssessmentContext } from "@/lib/zakatYearAssessment";
import type * as ZakatYearRepositoryModule from "@/lib/zakatYearRepository";
import type { Account, Transaction } from "@/types";

type ZakatGoldYearItemRepository = typeof ZakatGoldYearItemRepositoryModule;
type ZakatYearRepository = typeof ZakatYearRepositoryModule;

const USER_ID = "zakat-page-year-scope-user";
const CURRENCY = "PKR";
/** 1444 opens on 23 Mar 2023; its twelve months run into Mar 2024. */
const SELECTED_ISLAMIC_YEAR = 1444;

let assessmentContext: ZakatYearAssessmentContext | undefined;

vi.mock("@/components/auth/OfflineAuthProvider", () => ({
	useCurrentUser: () => ({ id: USER_ID }),
}));

vi.mock("@/hooks/useDbConfig", () => ({
	useDbConfig: () => ({ id: USER_ID, currency: CURRENCY, updatedAt: 0 }),
}));

vi.mock("@/hooks/useZakatYearAssessments", () => ({
	useZakatYearAssessmentContext: () => assessmentContext,
}));

vi.mock("@/lib/zakatYearRepository", async (importOriginal) => ({
	...(await importOriginal<ZakatYearRepository>()),
	saveZakatYearOverride: vi.fn().mockResolvedValue(undefined),
	clearZakatYearOverride: vi.fn().mockResolvedValue(undefined),
	saveZakatYearAccountSelection: vi.fn().mockResolvedValue(undefined),
	saveZakatYearShowArchivedAccounts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/zakatGoldYearItemRepository", async (importOriginal) => ({
	...(await importOriginal<ZakatGoldYearItemRepository>()),
	pinZakatGoldYearItems: vi.fn().mockResolvedValue([]),
}));

vi.mock("sonner", () => ({
	toast: { success: vi.fn(), error: vi.fn() },
}));

// The tab bodies are stubbed down to the one thing these tests ask of them: which zakat
// year they were handed. Each is exercised in full by its own test file.
vi.mock("@/components/zakat/ZakatGoldYearPricing", () => ({
	ZakatGoldYearPricing: ({ islamicYear }: { islamicYear: number }) => (
		<div data-testid="gold-pricing">pricing {islamicYear}</div>
	),
}));

vi.mock("@/components/zakat/ZakatGoldYearInventory", () => ({
	ZakatGoldYearInventory: ({ islamicYear }: { islamicYear: number }) => (
		<div data-testid="gold-inventory">inventory {islamicYear}</div>
	),
}));

vi.mock("@/components/zakat/GoldItemsManager", () => ({
	GoldItemsManager: () => <div data-testid="gold-manager" />,
}));

vi.mock("@/components/zakat/ZakatCarryForwardControl", () => ({
	ZakatCarryForwardControl: ({ islamicYear }: { islamicYear: number }) => (
		<div data-testid="carry-forward">carry {islamicYear}</div>
	),
}));

vi.mock("@/components/zakat/ZakatMonthlyBalances", () => ({
	ZakatMonthlyBalances: ({ grid }: { grid?: { year: { islamicYear: number } } }) => (
		<div data-testid="monthly">monthly {grid?.year.islamicYear ?? "none"}</div>
	),
}));

vi.mock("@/components/zakat/ZakatHistory", () => ({
	ZakatHistory: ({ islamicYear }: { islamicYear?: string }) => (
		<div data-testid="history">history {islamicYear}</div>
	),
}));

vi.mock("@/components/zakat/ZakatPayments", () => ({
	ZakatPayments: ({ islamicYear }: { islamicYear: string }) => (
		<div data-testid="payments">payments {islamicYear}</div>
	),
}));

const { ZakatPageClientEnhanced } = await import("@/components/zakat/ZakatPageClientEnhanced");

function account(id: string, title: string, patch: Partial<Account> = {}): Account {
	return {
		id,
		userId: USER_ID,
		title,
		openingBalance: 0,
		currency: CURRENCY,
		isArchived: false,
		updatedAt: 1_000,
		...patch,
	};
}

function transaction(id: string, accountId: string, amount: number): Transaction {
	return {
		id,
		userId: USER_ID,
		accountId,
		type: "income",
		amount,
		currency: CURRENCY,
		// Inside the 1444 zakat year, so it reaches every month-end total.
		date: Date.UTC(2023, 3, 1),
		updatedAt: 1_000,
	};
}

/**
 * Four accounts in the currency. Only two are chosen for 1444, and one of the two that
 * are not is archived — which is exactly the pair a snapshot must not claim.
 */
const ACCOUNTS = [
	account("counted-1", "Meezan Current"),
	account("counted-2", "HBL Savings"),
	account("excluded", "Daughter's Account"),
	account("archived", "Alfalah Closed", { isArchived: true }),
];

const TRANSACTIONS = ACCOUNTS.map((a, index) => transaction(`txn-${index}`, a.id, 100_000));

function buildContext(selectedAccountIds: string[]): ZakatYearAssessmentContext {
	return prepareZakatYearAssessmentContext({
		userId: USER_ID,
		referenceCurrency: CURRENCY,
		accounts: ACCOUNTS,
		transactions: TRANSACTIONS,
		goldItems: [],
		goldYears: [],
		goldYearItems: [],
		yearOverrides: [
			{
				id: `${USER_ID}:${SELECTED_ISLAMIC_YEAR}`,
				userId: USER_ID,
				islamicYear: SELECTED_ISLAMIC_YEAR,
				selectedAccountIds,
				showArchivedAccounts: false,
				updatedAt: 1_000,
			},
		],
		payments: [],
	});
}

function renderPage() {
	return render(<ZakatPageClientEnhanced userId={USER_ID} />);
}

/** Moves the lifted year selector back one year, without entering a tab. */
function stepToPreviousYear() {
	fireEvent.click(screen.getByLabelText("Previous zakat year"));
}

/** The zakat year currently on screen, read off the calculator's own stub. */
function shownIslamicYear(): number {
	return Number(screen.getByTestId("gold-pricing").textContent!.replace("pricing ", ""));
}

/** Steps back to one year, so the assertions do not depend on today's date. */
async function goToIslamicYear(target: number) {
	for (let guard = 0; guard < 20 && shownIslamicYear() > target; guard += 1) {
		stepToPreviousYear();
		await waitFor(() => {
			expect(screen.getByTestId("gold-pricing")).toBeInTheDocument();
		});
	}
	await waitFor(() => {
		expect(shownIslamicYear()).toBe(target);
	});
}

beforeEach(async () => {
	vi.clearAllMocks();
	await db.zakatCalculations.where("userId").equals(USER_ID).delete();
	assessmentContext = buildContext(["counted-1", "counted-2", "archived"]);
});

describe("the zakat year calendar above the tabs", () => {
	it("renders once, outside every tab panel", () => {
		renderPage();

		const headings = screen.getAllByText("Zakat Year Calendar");
		expect(headings).toHaveLength(1);

		const panels = document.querySelectorAll('[role="tabpanel"]');
		expect(panels.length).toBeGreaterThan(0);
		for (const panel of panels) {
			expect(panel.contains(headings[0]!)).toBe(false);
		}

		// The selector itself is reachable without opening a tab.
		expect(screen.getByLabelText("Zakat Year")).toBeInTheDocument();
		expect(screen.getByLabelText("Previous zakat year")).toBeInTheDocument();
		expect(screen.getByLabelText("Next zakat year")).toBeInTheDocument();
	});

	it("says which currency the whole page is scoped to", () => {
		renderPage();

		const calendar = screen.getByText("Zakat Year Calendar").closest("div")!.parentElement!;
		expect(within(calendar).getByText(CURRENCY)).toBeInTheDocument();
	});

	it("keeps the Ramaḍān date and the sighting note out of the way on a phone", () => {
		renderPage();

		// One subtree, folded away on small screens and always open from `sm` up, so the
		// card cannot swallow the viewport before the tabs begin.
		const note = screen.getByText(/Month lengths always come from the Umm al-Qura calendar/);
		const details = note.parentElement!;
		expect(details.className).toContain("hidden");
		expect(details.className).toContain("sm:block");

		fireEvent.click(screen.getByLabelText("Adjust the Ramaḍān date"));
		expect(note.parentElement!.className).toContain("block");
	});
});

describe("changing the year above the tabs", () => {
	it("reaches the calculator, the monthly view, the history and the payments", async () => {
		renderPage();

		await goToIslamicYear(SELECTED_ISLAMIC_YEAR);

		const definition = getZakatYearDefinitionByIslamicYear(SELECTED_ISLAMIC_YEAR);
		expect(screen.getByTestId("gold-pricing")).toHaveTextContent("pricing 1444");
		expect(screen.getByTestId("gold-inventory")).toHaveTextContent("inventory 1444");

		const tabs: [string, string, string][] = [
			["Monthly View", "monthly", "monthly 1444"],
			["History", "history", `history ${definition.zakatYear}`],
			["Payments", "payments", `payments ${definition.zakatYear}`],
		];

		for (const [tab, testId, expected] of tabs) {
			const trigger = screen.getByRole("tab", { name: tab });
			fireEvent.mouseDown(trigger);
			fireEvent.focus(trigger);
			await waitFor(() => {
				expect(screen.getByTestId(testId)).toHaveTextContent(expected);
			});
			// Past Remaining lives with the month grid, and follows the same year.
			if (testId === "monthly") {
				expect(screen.getByTestId("carry-forward")).toHaveTextContent("carry 1444");
			}
			// And the year stays changeable from every one of them.
			expect(screen.getAllByText("Zakat Year Calendar")).toHaveLength(1);
			expect(screen.getByLabelText("Zakat Year")).toBeInTheDocument();
		}
	});

	it("names the year on the account picker it scopes", async () => {
		renderPage();

		await goToIslamicYear(SELECTED_ISLAMIC_YEAR);

		const { label } = getZakatYearDefinitionByIslamicYear(SELECTED_ISLAMIC_YEAR);
		expect(screen.getByText(`Zakatable Accounts • ${label}`)).toBeInTheDocument();
	});
});

describe("a saved calculation records what was assessed", () => {
	async function saveSelectedYear() {
		renderPage();
		await goToIslamicYear(SELECTED_ISLAMIC_YEAR);

		fireEvent.click(screen.getByText("Save This Calculation"));

		await waitFor(async () => {
			expect(await db.zakatCalculations.where("userId").equals(USER_ID).count()).toBe(1);
		});
		const [saved] = await db.zakatCalculations.where("userId").equals(USER_ID).toArray();
		return saved!;
	}

	it("lists only the accounts that were counted, not every account in the currency", async () => {
		const saved = await saveSelectedYear();

		expect(saved.accountBalances.map((a) => a.accountId).sort()).toEqual([
			"counted-1",
			"counted-2",
		]);
		expect(saved.accountBalances.every((a) => a.zakatable)).toBe(true);
	});

	it("leaves out an account the owner deliberately excluded", async () => {
		const saved = await saveSelectedYear();

		expect(saved.accountBalances.map((a) => a.accountTitle)).not.toContain("Daughter's Account");
	});

	it("leaves out a closed account the year's toggle keeps out", async () => {
		// "archived" IS selected for 1444, but the year counts no closed accounts, so it
		// took no part in MINIMUM or MAXIMUM and must take no part in the record either.
		const saved = await saveSelectedYear();

		expect(saved.accountBalances.map((a) => a.accountId)).not.toContain("archived");
	});
});
