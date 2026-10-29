/**
 * History as an audit trail.
 *
 * A saved calculation is a RECORD of a determination — "on this date I assessed X and
 * paid Y" — and the owner chose to keep it as one. But carry-forward recomputes the same
 * year live, so a snapshot and the books can part company the moment a bookkeeping error
 * is fixed years later. These tests prove History says which it is showing, when it was
 * saved, and, when the two disagree, BOTH figures.
 *
 * Ground truth for the figures is `docs/zakat-requirements-2026-10.md` section 7: the
 * owner's 170.52 g of 21k gold at 18,846.3 per gram in `2024` (AH1444).
 *
 * Nothing here computes tax. Zakat is a religious obligation; this file only proves a
 * saved figure is reported honestly against the current one.
 */
import "fake-indexeddb/auto";

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ZakatHistory } from "@/components/zakat/ZakatHistory";
import { db } from "@/lib/db/local";
import { getZakatYearDefinitionByIslamicYear } from "@/lib/zakatEngine";
import {
	auditZakatSnapshot,
	getZakatSnapshotIslamicYear,
	toZakatCurrencyPrecision,
} from "@/lib/zakatSnapshotAudit";

import type { Account, GoldItem, Transaction, ZakatCalculation } from "@/types";

const USER_ID = "zakat-history-audit-user";
const CURRENCY = "PKR";
const YEAR = getZakatYearDefinitionByIslamicYear(1444);
const PRICE_PER_GRAM = 18_846.3;
const GOLD_VALUE = 170.52 * PRICE_PER_GRAM; // 3,213,671.076

/** The balance the year was assessed on when the snapshot was taken. */
const SAVED_BALANCE = 1_000_000;
const SAVED_TOTAL_ZAKATABLE = SAVED_BALANCE + GOLD_VALUE;
const SAVED_OBLIGATION = SAVED_TOTAL_ZAKATABLE * 0.025;

/** Local midnight-ish, so the rendered date does not depend on the runner's zone. */
const SAVED_AT = new Date(2024, 3, 10, 9, 30).getTime();

const ACCOUNT: Account = {
	id: "meezan",
	userId: USER_ID,
	title: "Meezan",
	openingBalance: 0,
	currency: CURRENCY,
	isArchived: false,
	accountType: "asset",
	updatedAt: 1_000,
};

const GOLD_ITEM: GoldItem = {
	id: "gold-1",
	userId: USER_ID,
	currency: CURRENCY,
	title: "Bangles",
	weight: 170.52,
	purity: "21k",
	updatedAt: 1_000,
};

/** In place before AH1442 opens, so every month of every year under test shows it. */
function opening(amount: number): Transaction {
	return {
		id: "meezan-opening",
		userId: USER_ID,
		type: "Income",
		date: getZakatYearDefinitionByIslamicYear(1442).months[0]!.startDate.getTime() - 86_400_000,
		amount,
		accountId: ACCOUNT.id,
		updatedAt: 1_000,
	};
}

function snapshot(overrides: Partial<ZakatCalculation> = {}): ZakatCalculation {
	return {
		id: "calc-1444",
		userId: USER_ID,
		currency: CURRENCY,
		islamicYear: YEAR.zakatYear,
		assessmentDate: YEAR.months[11]!.endDate.getTime(),
		goldPricePerGram: PRICE_PER_GRAM,
		goldPricesByPurity: { "21k": PRICE_PER_GRAM },
		referenceCurrency: CURRENCY,
		basis: "minimum",
		ratePercent: 2.5,
		totalGoldWeightGrams: 170.52,
		totalGoldValue: GOLD_VALUE,
		accountBalances: [
			{
				accountId: ACCOUNT.id,
				accountTitle: ACCOUNT.title,
				balance: SAVED_BALANCE,
				currency: CURRENCY,
				exchangeRate: 1,
				zakatable: true,
				accountType: "asset",
			},
		],
		totalZakatable: SAVED_TOTAL_ZAKATABLE,
		zakatObligation: SAVED_OBLIGATION,
		createdAt: SAVED_AT,
		updatedAt: SAVED_AT,
		...overrides,
	};
}

async function seed({
	balance = SAVED_BALANCE,
	calculations = [snapshot()],
}: { balance?: number; calculations?: ZakatCalculation[] } = {}) {
	await db.accounts.put(ACCOUNT);
	await db.transactions.put(opening(balance));
	await db.goldItems.put(GOLD_ITEM);
	await db.zakatGoldYears.put({
		id: `${USER_ID}:${CURRENCY}:1444`,
		userId: USER_ID,
		currency: CURRENCY,
		islamicYear: 1444,
		pricesByPurity: { "21k": PRICE_PER_GRAM },
		priceDate: YEAR.months[0]!.startDate.getTime(),
		updatedAt: 1_000,
	});
	await db.zakatYears.put({
		id: `${USER_ID}:1444`,
		userId: USER_ID,
		islamicYear: 1444,
		ramadanStart: YEAR.months[0]!.startDate.getTime(),
		source: "announced",
		selectedAccountIds: [ACCOUNT.id],
		updatedAt: 1_000,
	});
	for (const calculation of calculations) await db.zakatCalculations.put(calculation);
}

async function clearUserData() {
	await Promise.all([
		db.accounts.where("userId").equals(USER_ID).delete(),
		db.transactions.where("userId").equals(USER_ID).delete(),
		db.goldItems.where("userId").equals(USER_ID).delete(),
		db.zakatGoldYears.where("userId").equals(USER_ID).delete(),
		db.zakatYears.where("userId").equals(USER_ID).delete(),
		db.zakatCalculations.where("userId").equals(USER_ID).delete(),
		db.zakatPayments.where("userId").equals(USER_ID).delete(),
	]);
}

function renderHistory() {
	return render(<ZakatHistory userId={USER_ID} referenceCurrency={CURRENCY} />);
}

/** Opens the first record on the list, where the detail of an assessment lives. */
async function expandFirstRecord() {
	const header = await screen.findByText(/^Islamic Year/);
	fireEvent.click(header.closest("button")!);
}

beforeEach(async () => {
	await clearUserData();
});

afterEach(() => {
	cleanup();
});

describe("a saved assessment reads as a record of its own date", () => {
	it("shows when it was saved, and says the figures are as assessed then", async () => {
		await seed();
		renderHistory();

		expect(await screen.findByText(/Saved 10 Apr 2024, 9:30 AM/)).toBeInTheDocument();
		// The period is derived from the zakat year, not a date the owner picked.
		expect(screen.getByText(/covers the zakat year ending/)).toBeInTheDocument();
		expect(screen.getByText("as assessed then")).toBeInTheDocument();
		expect(screen.getByText(/not necessarily what the books say now/)).toBeInTheDocument();
	});

	it("confirms quietly when the year still recomputes the same", async () => {
		await seed();
		renderHistory();

		expect(await screen.findByText("Matches current data")).toBeInTheDocument();
		expect(screen.queryByText("Differs from current data")).not.toBeInTheDocument();
	});

	it("does not flag sub-cent floating point noise as a divergence", async () => {
		await seed({
			calculations: [
				snapshot({
					totalZakatable: SAVED_TOTAL_ZAKATABLE + 0.004,
					zakatObligation: SAVED_OBLIGATION - 0.0041,
					totalGoldValue: GOLD_VALUE + 0.002,
				}),
			],
		});
		renderHistory();

		expect(await screen.findByText("Matches current data")).toBeInTheDocument();
	});
});

describe("the record is read in its own currency", () => {
	it("prices gold in the record's reference currency, never a hardcoded one", async () => {
		// The owner's 2020 sheet paid 7,776 a gram in RUPEES; showing it as dollars made
		// the card contradict the gold value printed two lines beneath it.
		await seed({
			calculations: [
				snapshot({
					goldPricePerGram: 7_776,
					// Silver is one weight at one price, so 50 g worth 4,775 reads back as
					// 95.50 a gram — in RUPEES, like everything else on the record.
					totalSilverWeightGrams: 50,
					totalSilverValue: 4_775,
				}),
			],
		});
		renderHistory();
		await expandFirstRecord();

		expect(screen.getByText(/₨\s?7,776\.00/)).toBeInTheDocument();
		expect(screen.getByText(/₨\s?95\.50/)).toBeInTheDocument();
		expect(screen.queryByText(/\$\s?7,776\.00/)).not.toBeInTheDocument();
		expect(screen.queryByText(/\$\s?95\.50/)).not.toBeInTheDocument();
	});

	it("hides the accounts that held nothing, as the monthly view and export do", async () => {
		await seed({
			calculations: [
				snapshot({
					accountBalances: [
						{
							accountId: ACCOUNT.id,
							accountTitle: ACCOUNT.title,
							balance: SAVED_BALANCE,
							currency: CURRENCY,
							exchangeRate: 1,
							zakatable: true,
							accountType: "asset",
						},
						{
							accountId: "dormant",
							accountTitle: "Dormant Wallet",
							balance: 0,
							currency: CURRENCY,
							exchangeRate: 1,
							zakatable: true,
							accountType: "asset",
						},
					],
				}),
			],
		});
		renderHistory();
		await expandFirstRecord();

		expect(screen.getByText(/Account Balances \(1 of 2 accounts\)/)).toBeInTheDocument();
		expect(screen.getByText(ACCOUNT.title)).toBeInTheDocument();
		expect(screen.queryByText("Dormant Wallet")).not.toBeInTheDocument();
	});
});

describe("a snapshot the books have moved away from", () => {
	it("flags the year and reports the saved figure beside the current one", async () => {
		// The 2024 transaction was corrected from 1,000,000 to 1,200,000 after the
		// assessment was saved. The record stands; the books have moved.
		await seed({ balance: 1_200_000 });
		renderHistory();

		const flag = await screen.findByText("Differs from current data");
		expect(flag).toBeInTheDocument();

		const header = flag.closest("button");
		expect(header).not.toBeNull();
		fireEvent.click(header!);

		const panel = screen.getByText("This year now recomputes differently").closest("div")!;
		expect(within(panel).getByText("Total zakatable")).toBeInTheDocument();
		// 4,213,671.08 saved against 4,413,671.08 now, a 200,000.00 move.
		expect(within(panel).getByText(/4,213,671\.08/)).toBeInTheDocument();
		expect(within(panel).getByText(/4,413,671\.08/)).toBeInTheDocument();
		expect(within(panel).getByText("Zakat obligation")).toBeInTheDocument();
		expect(within(panel).getByText(/105,341\.78/)).toBeInTheDocument();
		expect(within(panel).getByText(/110,341\.78/)).toBeInTheDocument();
		expect(within(panel).getAllByText(/200,000\.00/).length).toBeGreaterThan(0);
	});

	it("re-flags a record as soon as the transaction behind it is corrected", async () => {
		await seed();
		renderHistory();
		expect(await screen.findByText("Matches current data")).toBeInTheDocument();

		// The same correction, made while History is open.
		await act(async () => {
			await db.transactions.put(opening(1_200_000));
		});

		expect(await screen.findByText("Differs from current data")).toBeInTheDocument();
		expect(screen.queryByText("Matches current data")).not.toBeInTheDocument();
		// The record itself is untouched: it still reads as what was assessed then.
		expect(screen.getByText(/Saved 10 Apr 2024, 9:30 AM/)).toBeInTheDocument();
	});

	it("leaves a year with no snapshot alone", async () => {
		await seed({ balance: 1_200_000 });
		renderHistory();

		await screen.findByText("Differs from current data");
		// AH1443 has balances and no saved assessment, so it is not listed or judged.
		expect(screen.getAllByText(/^Islamic Year/)).toHaveLength(1);
		expect(screen.getByText(`Islamic Year ${YEAR.zakatYear}`)).toBeInTheDocument();
	});
});

describe("re-saving a year adds a record rather than replacing one", () => {
	it("marks the latest assessment for a year and the ones it supersedes", async () => {
		await seed({
			calculations: [
				snapshot(),
				snapshot({
					id: "calc-1444-later",
					createdAt: SAVED_AT + 86_400_000,
					updatedAt: SAVED_AT + 86_400_000,
				}),
			],
		});
		renderHistory();

		expect(await screen.findByText("Latest of 2")).toBeInTheDocument();
		expect(screen.getByText("Superseded by a later assessment")).toBeInTheDocument();
		// Both determinations survive; neither was rewritten.
		expect(screen.getAllByText(/^Saved 1[01] Apr 2024/)).toHaveLength(2);
	});
});

describe("the comparison itself", () => {
	const calculation = snapshot();

	it("rounds to the minor unit before deciding anything has changed", () => {
		expect(toZakatCurrencyPrecision(0.0000000004365574569)).toBe(0);

		const audit = auditZakatSnapshot(calculation, {
			totalZakatable: SAVED_TOTAL_ZAKATABLE + 0.004,
			zakatObligation: SAVED_OBLIGATION + 0.004,
			goldValue: GOLD_VALUE - 0.004,
			silverValue: 0,
		});

		expect(audit.status).toBe("matches");
		expect(audit.differences).toEqual([]);
	});

	it("reports both figures, and the move between them, once a rupee changes", () => {
		const audit = auditZakatSnapshot(calculation, {
			totalZakatable: SAVED_TOTAL_ZAKATABLE + 200_000,
			zakatObligation: SAVED_OBLIGATION + 5_000,
			goldValue: GOLD_VALUE,
			silverValue: 0,
		});

		expect(audit.status).toBe("diverged");
		expect(audit.differences.map((figure) => figure.key)).toEqual([
			"totalZakatable",
			"zakatObligation",
		]);
		expect(audit.differences[0]).toMatchObject({
			saved: toZakatCurrencyPrecision(SAVED_TOTAL_ZAKATABLE),
			current: toZakatCurrencyPrecision(SAVED_TOTAL_ZAKATABLE + 200_000),
			delta: 200_000,
		});
	});

	it("claims nothing while the live figures are unknown", () => {
		const audit = auditZakatSnapshot(calculation, undefined);

		expect(audit.status).toBe("unchecked");
		expect(audit.figures).toEqual([]);
	});

	it("reads the Islamic year off the stored label", () => {
		expect(getZakatSnapshotIslamicYear("1444-1445")).toBe(1444);
		expect(getZakatSnapshotIslamicYear("not-a-year")).toBeUndefined();
		expect(getZakatSnapshotIslamicYear(undefined)).toBeUndefined();
	});
});

/**
 * A saved calculation is evidence of what was assessed, so it must not claim accounts
 * that took no part in the figure. The save now records only the counted set, and the
 * records written before it did are READ down to what they can evidence rather than
 * rewritten — a determination made on a date is exactly what this trail preserves.
 */
describe("a snapshot saved before it was narrowed to the counted accounts", () => {
	const LEGACY = snapshot({
		accountBalances: [
			{
				accountId: ACCOUNT.id,
				accountTitle: ACCOUNT.title,
				balance: SAVED_BALANCE,
				currency: CURRENCY,
				exchangeRate: 1,
				zakatable: true,
				accountType: "asset",
			},
			{
				accountId: "daughter",
				accountTitle: "Daughter's Account",
				balance: 450_000,
				currency: CURRENCY,
				exchangeRate: 1,
				zakatable: false,
				accountType: "asset",
			},
			{
				accountId: "alfalah-closed",
				accountTitle: "Alfalah Closed",
				balance: 80_000,
				currency: CURRENCY,
				exchangeRate: 1,
				zakatable: false,
				accountType: "asset",
			},
		],
	});

	it("does not present the accounts it never counted as contributors", async () => {
		await seed({ calculations: [LEGACY] });
		renderHistory();
		await expandFirstRecord();

		expect(screen.getByText(/Account Balances \(1 of 1 accounts\)/)).toBeInTheDocument();
		expect(screen.getByText(ACCOUNT.title)).toBeInTheDocument();
		expect(screen.queryByText("Daughter's Account")).not.toBeInTheDocument();
		expect(screen.queryByText("Alfalah Closed")).not.toBeInTheDocument();
	});

	it("says why the record carries more accounts than it counted", async () => {
		await seed({ calculations: [LEGACY] });
		renderHistory();
		await expandFirstRecord();

		expect(
			screen.getByText(/saved before snapshots were narrowed to the accounts actually counted/)
		).toBeInTheDocument();
	});

	it("leaves the stored record exactly as it was saved", async () => {
		await seed({ calculations: [LEGACY] });
		renderHistory();
		await expandFirstRecord();

		const stored = await db.zakatCalculations.get(LEGACY.id);
		expect(stored?.accountBalances).toHaveLength(3);
	});
});

/**
 * The zakat year is chosen once, above the tabs, so this tab answers for it. The rest of
 * the trail stays one click away: a determination's worth is in the chain it sits in.
 */
describe("history scoped to the year chosen above the tabs", () => {
	const OTHER_YEAR = getZakatYearDefinitionByIslamicYear(1443);
	const OTHER = snapshot({
		id: "calc-1443",
		islamicYear: OTHER_YEAR.zakatYear,
		assessmentDate: OTHER_YEAR.months[11]!.endDate.getTime(),
	});

	function renderScoped() {
		return render(
			<ZakatHistory
				userId={USER_ID}
				referenceCurrency={CURRENCY}
				islamicYear={YEAR.zakatYear}
				yearLabel={YEAR.label}
			/>
		);
	}

	it("shows the selected year's records and keeps the others one click away", async () => {
		await seed({ calculations: [snapshot(), OTHER] });
		renderScoped();

		expect(await screen.findByText(`Islamic Year ${YEAR.zakatYear}`)).toBeInTheDocument();
		expect(screen.queryByText(`Islamic Year ${OTHER_YEAR.zakatYear}`)).not.toBeInTheDocument();

		fireEvent.click(screen.getByText(/Every year \(1 more\)/));

		expect(await screen.findByText(`Islamic Year ${OTHER_YEAR.zakatYear}`)).toBeInTheDocument();
	});

	it("says nothing was assessed for the year rather than showing another year's", async () => {
		await seed({ calculations: [OTHER] });
		renderScoped();

		expect(
			await screen.findByText(new RegExp(`Nothing assessed for ${YEAR.sheetYear}`))
		).toBeInTheDocument();
		expect(screen.queryByText(`Islamic Year ${OTHER_YEAR.zakatYear}`)).not.toBeInTheDocument();
	});
});
