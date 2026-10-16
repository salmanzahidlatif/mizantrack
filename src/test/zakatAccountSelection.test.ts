/**
 * The account selection belongs to the zakat year.
 *
 * Spec section 7 shows a different set of accounts in every sheet — `2020` includes a
 * closed Alfalah account that `2024` has no row for — so one global selection would
 * silently rewrite years the owner has already settled. The selection is therefore
 * stored per Islamic year, together with whether that year counts its closed accounts.
 *
 * The closed-accounts switch is an INCLUSION filter, not a view preference: with it off
 * an archived account stops counting towards the grid, the totals, MINIMUM and MAXIMUM,
 * while its stored selection is kept so switching it back on restores it.
 */
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import {
	applyZakatSelectAll,
	getZakatCountedAccountIds,
	getZakatSelectAllState,
	resolveZakatAccountSelection,
	ZAKAT_SHOW_ARCHIVED_ACCOUNTS_DEFAULT,
} from "@/components/zakat/ZakatPageClientEnhanced";
import { db } from "@/lib/db/local";
import { computeZakatYearGrid, getZakatYearDefinitionByIslamicYear } from "@/lib/zakatEngine";
import {
	buildZakatYearOverrideId,
	clearZakatYearAccountSelection,
	listZakatYearOverrides,
	saveZakatPastRemainingOverride,
	saveZakatYearAccountSelection,
	saveZakatYearShowArchivedAccounts,
	toZakatAccountSelectionMap,
	toZakatShowArchivedAccountsMap,
} from "@/lib/zakatYearRepository";

import type { Account, Transaction } from "@/types";

const USER_ID = "zakat-account-selection-user";
const YEAR = getZakatYearDefinitionByIslamicYear(1444);

function account(id: string, overrides: Partial<Account> = {}): Account {
	return {
		id,
		userId: USER_ID,
		title: id,
		openingBalance: 0,
		currency: "PKR",
		isArchived: false,
		accountType: "asset",
		updatedAt: 1_000,
		...overrides,
	};
}

const OPEN_ACCOUNT = account("meezan");
const CLOSED_ACCOUNT = account("alfalah", { title: "Alfalah", isArchived: true });
const LIABILITY = account("papa", { title: "Loan <-- (Papa)", accountType: "liability" });
const CURRENCY_ACCOUNTS = [OPEN_ACCOUNT, CLOSED_ACCOUNT, LIABILITY];

/** A balance in place before the zakat year opens, so every month shows it. */
function income(accountId: string, amount: number): Transaction {
	return {
		id: `${accountId}-opening`,
		userId: USER_ID,
		type: "Income",
		date: YEAR.months[0]!.startDate.getTime() - 86_400_000,
		amount,
		accountId,
		updatedAt: 1_000,
	};
}

async function storedSelection(islamicYear: number): Promise<string[] | undefined> {
	return toZakatAccountSelectionMap(await listZakatYearOverrides(USER_ID)).get(islamicYear);
}

async function storedShowArchived(islamicYear: number): Promise<boolean | undefined> {
	return toZakatShowArchivedAccountsMap(await listZakatYearOverrides(USER_ID)).get(islamicYear);
}

/** What the screen would resolve for a year after a reload. */
async function reloadSelection(islamicYear: number): Promise<Set<string>> {
	return resolveZakatAccountSelection({
		storedAccountIds: await storedSelection(islamicYear),
		currencyAccounts: CURRENCY_ACCOUNTS,
	});
}

beforeEach(async () => {
	await db.zakatYears.where("userId").equals(USER_ID).delete();
});

describe("account selection is stored per zakat year", () => {
	it("reloads the selection saved for a year", async () => {
		await saveZakatYearAccountSelection({
			userId: USER_ID,
			islamicYear: 1444,
			selectedAccountIds: ["meezan", "papa"],
		});

		expect([...(await reloadSelection(1444))].sort()).toEqual(["meezan", "papa"]);
	});

	it("keeps each year's selection distinct", async () => {
		await saveZakatYearAccountSelection({
			userId: USER_ID,
			islamicYear: 1440,
			selectedAccountIds: ["meezan", "alfalah"],
		});
		await saveZakatYearAccountSelection({
			userId: USER_ID,
			islamicYear: 1444,
			selectedAccountIds: ["meezan"],
		});

		expect([...(await reloadSelection(1440))].sort()).toEqual(["alfalah", "meezan"]);
		expect([...(await reloadSelection(1444))]).toEqual(["meezan"]);
	});

	it("pre-selects open asset accounts only for a year that was never touched", () => {
		const resolved = resolveZakatAccountSelection({
			storedAccountIds: undefined,
			currencyAccounts: CURRENCY_ACCOUNTS,
		});

		// Liabilities and closed accounts are offered, never assumed.
		expect([...resolved]).toEqual(["meezan"]);
	});

	it("lets an explicitly empty selection beat the select-all fallback", async () => {
		await saveZakatYearAccountSelection({
			userId: USER_ID,
			islamicYear: 1444,
			selectedAccountIds: [],
		});

		expect(await storedSelection(1444)).toEqual([]);
		expect([...(await reloadSelection(1444))]).toEqual([]);
	});

	it("keeps an archived account selected across a reload", async () => {
		await saveZakatYearAccountSelection({
			userId: USER_ID,
			islamicYear: 1444,
			selectedAccountIds: ["meezan", "alfalah"],
		});

		expect(await reloadSelection(1444)).toContain("alfalah");
	});

	it("drops an account that no longer exists rather than haunting the year", async () => {
		await saveZakatYearAccountSelection({
			userId: USER_ID,
			islamicYear: 1444,
			selectedAccountIds: ["meezan", "deleted-account"],
		});

		expect([...(await reloadSelection(1444))]).toEqual(["meezan"]);
	});

	it("round-trips through Dexie queued for sync, and keeps the Past Remaining beside it", async () => {
		await saveZakatPastRemainingOverride({
			userId: USER_ID,
			islamicYear: 1444,
			pastRemaining: 88_058,
		});
		await saveZakatYearAccountSelection({
			userId: USER_ID,
			islamicYear: 1444,
			selectedAccountIds: ["meezan", "alfalah"],
		});
		await saveZakatYearShowArchivedAccounts({
			userId: USER_ID,
			islamicYear: 1444,
			showArchivedAccounts: false,
		});

		const stored = await db.zakatYears.get(buildZakatYearOverrideId(USER_ID, 1444));

		expect(stored).toMatchObject({
			islamicYear: 1444,
			selectedAccountIds: ["meezan", "alfalah"],
			showArchivedAccounts: false,
			// The two inputs share a row without overwriting each other.
			pastRemainingOverride: 88_058,
			pendingSync: true,
		});
	});

	it("keeps the row alive when another input on it is reset", async () => {
		await saveZakatYearAccountSelection({
			userId: USER_ID,
			islamicYear: 1444,
			selectedAccountIds: ["meezan"],
		});
		await saveZakatPastRemainingOverride({
			userId: USER_ID,
			islamicYear: 1444,
			pastRemaining: 88_058,
		});
		const { clearZakatPastRemainingOverride } = await import("@/lib/zakatYearRepository");
		await clearZakatPastRemainingOverride(USER_ID, 1444);

		expect([...(await reloadSelection(1444))]).toEqual(["meezan"]);
	});

	it("tombstones the row when the selection is the last thing on it", async () => {
		await saveZakatYearAccountSelection({
			userId: USER_ID,
			islamicYear: 1444,
			selectedAccountIds: ["meezan"],
		});
		await clearZakatYearAccountSelection(USER_ID, 1444);

		expect(await storedSelection(1444)).toBeUndefined();
		expect(
			(await db.zakatYears.get(buildZakatYearOverrideId(USER_ID, 1444)))?.deletedAt
		).toBeGreaterThan(0);
	});

	it("defaults a year to counting its closed accounts", async () => {
		expect(await storedShowArchived(1444)).toBeUndefined();
		expect(ZAKAT_SHOW_ARCHIVED_ACCOUNTS_DEFAULT).toBe(true);

		await saveZakatYearShowArchivedAccounts({
			userId: USER_ID,
			islamicYear: 1444,
			showArchivedAccounts: false,
		});
		expect(await storedShowArchived(1444)).toBe(false);
		// Another year is unaffected.
		expect(await storedShowArchived(1443)).toBeUndefined();
	});
});

describe("Select all shown", () => {
	const visibleWithClosed = ["meezan", "alfalah", "papa"];
	const visibleWithoutClosed = ["meezan", "papa"];

	it("selects only the active accounts while closed ones are hidden", () => {
		const next = applyZakatSelectAll(new Set<string>(), visibleWithoutClosed, true);

		expect([...next].sort()).toEqual(["meezan", "papa"]);
		expect(next.has("alfalah")).toBe(false);
	});

	it("leaves a hidden archived account's stored selection alone in both directions", () => {
		const selected = new Set(["alfalah"]);

		const ticked = applyZakatSelectAll(selected, visibleWithoutClosed, true);
		expect([...ticked].sort()).toEqual(["alfalah", "meezan", "papa"]);

		const unticked = applyZakatSelectAll(ticked, visibleWithoutClosed, false);
		// Out of view is not the same as rejected: the stored choice survives.
		expect([...unticked]).toEqual(["alfalah"]);
	});

	it("selects the archived accounts too once they are shown", () => {
		const next = applyZakatSelectAll(new Set<string>(), visibleWithClosed, true);

		expect([...next].sort()).toEqual(["alfalah", "meezan", "papa"]);
	});

	it("reads as mixed when only some of the visible accounts are selected", () => {
		expect(getZakatSelectAllState(new Set(), visibleWithClosed)).toBe("unchecked");
		expect(getZakatSelectAllState(new Set(["meezan"]), visibleWithClosed)).toBe("mixed");
		expect(getZakatSelectAllState(new Set(visibleWithClosed), visibleWithClosed)).toBe("checked");
		// A hidden archived selection must not make the visible rows look complete.
		expect(getZakatSelectAllState(new Set(["alfalah"]), visibleWithoutClosed)).toBe("unchecked");
		expect(getZakatSelectAllState(new Set(["alfalah", "meezan"]), visibleWithoutClosed)).toBe(
			"mixed"
		);
	});

	it("persists the resulting selection against the year", async () => {
		const next = applyZakatSelectAll(new Set<string>(), visibleWithClosed, true);
		await saveZakatYearAccountSelection({
			userId: USER_ID,
			islamicYear: 1444,
			selectedAccountIds: next,
		});

		expect([...(await reloadSelection(1444))].sort()).toEqual(["alfalah", "meezan", "papa"]);
	});
});

describe("the closed-accounts switch decides what counts", () => {
	const accounts = [OPEN_ACCOUNT, CLOSED_ACCOUNT];
	const transactions = [income("meezan", 1_000_000), income("alfalah", 500_000)];

	function totalsFor(showArchivedAccounts: boolean, selected: Set<string>) {
		const counted = getZakatCountedAccountIds({
			selectedAccountIds: selected,
			currencyAccounts: CURRENCY_ACCOUNTS,
			showArchivedAccounts,
		});
		const grid = computeZakatYearGrid({
			userId: USER_ID,
			accounts,
			transactions,
			selectedAccountIds: counted,
			sheetYear: YEAR.sheetYear,
			yearDefinition: YEAR,
		});
		return { counted, grid };
	}

	it("counts, then stops counting, then counts a closed account again", async () => {
		await saveZakatYearAccountSelection({
			userId: USER_ID,
			islamicYear: 1444,
			selectedAccountIds: ["meezan", "alfalah"],
		});
		const selected = await reloadSelection(1444);

		// Closed accounts included: the archived row contributes.
		const included = totalsFor(true, selected);
		expect(included.counted.has("alfalah")).toBe(true);
		expect(included.grid.accounts.map((row) => row.accountId)).toEqual(["meezan", "alfalah"]);
		expect(included.grid.minimum).toBe(1_500_000);
		expect(included.grid.maximum).toBe(1_500_000);

		// Switched off: it stops counting and the totals drop by its balance.
		await saveZakatYearShowArchivedAccounts({
			userId: USER_ID,
			islamicYear: 1444,
			showArchivedAccounts: false,
		});
		const excluded = totalsFor((await storedShowArchived(1444)) ?? true, selected);
		expect(excluded.counted.has("alfalah")).toBe(false);
		expect(excluded.grid.accounts.map((row) => row.accountId)).toEqual(["meezan"]);
		expect(excluded.grid.minimum).toBe(1_000_000);
		expect(excluded.grid.maximum).toBe(1_000_000);

		// The stored choice was kept, so switching back restores it whole.
		await saveZakatYearShowArchivedAccounts({
			userId: USER_ID,
			islamicYear: 1444,
			showArchivedAccounts: true,
		});
		expect(await reloadSelection(1444)).toContain("alfalah");
		const restored = totalsFor(
			(await storedShowArchived(1444)) ?? true,
			await reloadSelection(1444)
		);
		expect(restored.counted.has("alfalah")).toBe(true);
		expect(restored.grid.minimum).toBe(1_500_000);
	});
});
