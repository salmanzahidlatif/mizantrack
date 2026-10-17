"use client";

import { endOfDay } from "date-fns";
import { Check, Download, Minus, Save } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { v4 as uuid } from "uuid";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GoldItemsManager } from "@/components/zakat/GoldItemsManager";
import { ZakatCarryForwardControl } from "@/components/zakat/ZakatCarryForwardControl";
import { ZakatGoldYearPricing } from "@/components/zakat/ZakatGoldYearPricing";
import { ZakatHistory } from "@/components/zakat/ZakatHistory";
import { ZakatMonthlyBalances } from "@/components/zakat/ZakatMonthlyBalances";
import { ZakatPayments } from "@/components/zakat/ZakatPayments";
import { ZakatYearCalendarControl } from "@/components/zakat/ZakatYearCalendarControl";
import { useDbConfig } from "@/hooks/useDbConfig";
import { useRequiredUserId } from "@/hooks/useRequiredUserId";
import { useZakatYearAssessmentContext } from "@/hooks/useZakatYearAssessments";
import { computeAccountBalances, resolveCurrencyCode } from "@/lib/analytics/balanceMath";
import { db } from "@/lib/db/local";
import { resolveZakatCarryForward, type ZakatYearSettlement } from "@/lib/zakatCarryForward";
import {
	calculateZakatAssessment,
	computeZakatYearGrid,
	getDefaultZakatIslamicYear,
	getZakatYearDefinitionByIslamicYear,
	getZakatYearDefinitions,
} from "@/lib/zakatEngine";
import { exportZakat } from "@/lib/zakatExport";
import {
	getZakatGoldGramsByPurity,
	getZakatGoldYearPrices,
	hasZakatGoldYearGramsSnapshot,
	resolveZakatGoldGramsByPurity,
	sumZakatGoldGrams,
} from "@/lib/zakatGoldYearRepository";
import {
	buildZakatYearAssessments,
	DEFAULT_ZAKAT_RATE_PERCENT,
	getZakatAccountsForCurrency,
	getZakatCarryForwardYearRange,
	getZakatCountedAccountIds,
	getZakatGoldGrams,
	getZakatGoldItemsForCurrency,
	resolveZakatAccountSelection,
	ZAKAT_SHOW_ARCHIVED_ACCOUNTS_DEFAULT,
} from "@/lib/zakatYearAssessment";
import {
	saveZakatYearAccountSelection,
	saveZakatYearShowArchivedAccounts,
} from "@/lib/zakatYearRepository";
import { useFilterStore } from "@/store/filter-store";

import type { ZakatBasis } from "@/lib/zakatEngine";
import type { ZakatYearAssessment } from "@/lib/zakatYearAssessment";
import type { ZakatGoldYear } from "@/types";

/**
 * How a zakat year is assembled now lives in `@/lib/zakatYearAssessment`, so the
 * calculator, the carry-forward chain and the History audit all derive a year the same
 * way. Re-exported here because this screen is where they have always been reached from.
 */
export {
	DEFAULT_ZAKAT_RATE_PERCENT,
	getZakatAccountsForCurrency,
	getZakatCountedAccountIds,
	getZakatGoldGrams,
	getZakatGoldItemsForCurrency,
	resolveZakatAccountSelection,
	ZAKAT_SHOW_ARCHIVED_ACCOUNTS_DEFAULT,
};

export type ZakatSelectAllState = "checked" | "mixed" | "unchecked";

/** Checkbox state for "Select all shown", measured against the visible rows only. */
export function getZakatSelectAllState(
	selectedAccountIds: Set<string>,
	visibleAccountIds: readonly string[]
): ZakatSelectAllState {
	if (visibleAccountIds.length === 0) return "unchecked";

	const selectedCount = visibleAccountIds.filter((id) => selectedAccountIds.has(id)).length;
	if (selectedCount === 0) return "unchecked";
	return selectedCount === visibleAccountIds.length ? "checked" : "mixed";
}

/**
 * Applies "Select all shown" to the VISIBLE rows in both directions: ticking selects
 * only what is on screen and unticking clears only what is on screen.
 *
 * Accounts that are not visible are left exactly as they were — neither selected nor
 * deselected. A closed account the owner picked for the year keeps its stored selection
 * while the closed-accounts toggle is off (it simply does not count meanwhile), so
 * switching the toggle back on returns it already ticked. Do not "simplify" this into
 * selecting or clearing every account: that would rewrite choices the owner cannot see.
 */
export function applyZakatSelectAll(
	selectedAccountIds: Set<string>,
	visibleAccountIds: readonly string[],
	checked: boolean
): Set<string> {
	const next = new Set(selectedAccountIds);
	for (const id of visibleAccountIds) {
		if (checked) next.add(id);
		else next.delete(id);
	}
	return next;
}

interface ZakatPageClientProps {
	userId?: string;
}

export function ZakatPageClientEnhanced({ userId: providedUserId }: ZakatPageClientProps = {}) {
	const userId = useRequiredUserId(providedUserId);
	const config = useDbConfig(userId);
	const { activeCurrency } = useFilterStore();
	const referenceCurrency = resolveCurrencyCode(activeCurrency, config?.currency);
	// Every table a zakat year is assessed from, loaded once and prepared once. The
	// calculator, the carry-forward chain and the History audit all read this same
	// context, so a year cannot mean one thing on one tab and something else on another.
	// Archived accounts are included: a closed account still held wealth during a past
	// year, so it must be selectable and must reach the grid, the totals, MINIMUM and
	// MAXIMUM. The toggle below only decides whether the picker lists them.
	const zakatContext = useZakatYearAssessmentContext(userId, referenceCurrency);
	const accounts = zakatContext?.accounts;
	const allTransactions = zakatContext?.transactions;
	const goldItems = zakatContext?.goldItems;
	const zakatAccounts = useMemo(() => zakatContext?.currencyAccounts ?? [], [zakatContext]);
	// Gold priced per zakat year. The inventory is NOT duplicated per year: only the
	// price the owner typed for a year — and the grams snapshot, when a year's holding
	// genuinely differed — lives here.
	const zakatGoldYears = useMemo(
		() => zakatContext?.goldYears ?? new Map<number, ZakatGoldYear>(),
		[zakatContext]
	);
	// Payments recorded for this currency; the screen, the engine and the export all
	// filter them down to the selected year.
	const zakatPayments = zakatContext?.payments;

	// ── Form state ──────────────────────────────────────────────────────────
	// There is no assessment-date picker: the selected zakat year IS the period, and a
	// second free-floating date beside the year dropdown could only disagree with it
	// (spec section 10, "a single assessment-date snapshot"). Picker balances are read
	// as of today, which is what spec section 5.13 asks for.
	const todayMs = useMemo(() => endOfDay(new Date()).getTime(), []);
	const [basis, setBasis] = useState<ZakatBasis>("minimum");
	const [ratePercent, setRatePercent] = useState<number>(DEFAULT_ZAKAT_RATE_PERCENT);
	const [activeTab, setActiveTab] = useState("calculator");
	const [savingSelection, setSavingSelection] = useState(false);

	// ── Zakat calendar ──────────────────────────────────────────────────────
	// Saved Ramaḍān anchors win over the announced/computed defaults. Only the anchor is
	// stored; the twelve months are regenerated from it on every render.
	const ramadanStarts = useMemo(
		() => zakatContext?.ramadanStarts ?? new Map<number, Date>(),
		[zakatContext]
	);
	const availableZakatYears = useMemo(
		() => getZakatYearDefinitions({ ramadanStarts }),
		[ramadanStarts]
	);
	const assessmentIslamicYear = useMemo(
		() => getDefaultZakatIslamicYear(new Date(todayMs), { ramadanStarts }),
		[ramadanStarts, todayMs]
	);
	// null means "the zakat year we are in"; a number pins the screen to one year.
	const [pinnedIslamicYear, setPinnedIslamicYear] = useState<number | null>(null);
	const selectedYear = useMemo(
		() =>
			getZakatYearDefinitionByIslamicYear(pinnedIslamicYear ?? assessmentIslamicYear, {
				ramadanStarts,
			}),
		[assessmentIslamicYear, pinnedIslamicYear, ramadanStarts]
	);

	// The zakat year we are in right now, shown in the header.
	const currentIslamicYear = useMemo(
		() => getZakatYearDefinitionByIslamicYear(assessmentIslamicYear, { ramadanStarts }).zakatYear,
		[assessmentIslamicYear, ramadanStarts]
	);

	// Decision 2: every year opens on MINIMUM. A deliberate switch to MAXIMUM belongs to
	// the year it was made on and is never carried into another one.
	useEffect(() => {
		setBasis("minimum");
	}, [selectedYear.islamicYear]);

	// ── Account selection, per zakat year ───────────────────────────────────
	// Accounts open and close, so the set belongs to the year: the owner's 2020 sheet
	// includes a closed Alfalah row that 2024 has no row for. The selection is read
	// straight out of Dexie rather than held in component state, so it survives a reload
	// and reaches his other devices.
	const accountSelections = useMemo(
		() => zakatContext?.accountSelections ?? new Map<number, string[]>(),
		[zakatContext]
	);
	const showArchivedByYear = useMemo(
		() => zakatContext?.showArchivedByYear ?? new Map<number, boolean>(),
		[zakatContext]
	);
	const showArchivedAccounts =
		showArchivedByYear.get(selectedYear.islamicYear) ?? ZAKAT_SHOW_ARCHIVED_ACCOUNTS_DEFAULT;

	const selectedAccountIds = useMemo(
		() =>
			resolveZakatAccountSelection({
				storedAccountIds: accountSelections.get(selectedYear.islamicYear),
				currencyAccounts: zakatAccounts,
			}),
		[accountSelections, selectedYear.islamicYear, zakatAccounts]
	);
	// What actually counts, after the closed-accounts filter.
	const zakatableIds = useMemo(
		() =>
			getZakatCountedAccountIds({
				selectedAccountIds,
				currencyAccounts: zakatAccounts,
				showArchivedAccounts,
			}),
		[selectedAccountIds, showArchivedAccounts, zakatAccounts]
	);

	const visibleZakatAccounts = useMemo(
		() => zakatAccounts.filter((account) => showArchivedAccounts || !account.isArchived),
		[showArchivedAccounts, zakatAccounts]
	);
	const visibleAccountIds = useMemo(
		() => visibleZakatAccounts.map((account) => account.id),
		[visibleZakatAccounts]
	);
	const selectAllState = getZakatSelectAllState(selectedAccountIds, visibleAccountIds);

	/**
	 * Writes a year's selection. Ids belonging to another currency's accounts are carried
	 * through untouched: one zakat year can be settled in PKR and in AED, and saving one
	 * book must not wipe the other's choices.
	 */
	async function persistAccountSelection(next: Set<string>) {
		const currencyAccountIds = new Set(zakatAccounts.map((account) => account.id));
		const preserved = (accountSelections.get(selectedYear.islamicYear) ?? []).filter(
			(id) => !currencyAccountIds.has(id)
		);

		setSavingSelection(true);
		try {
			await saveZakatYearAccountSelection({
				userId,
				islamicYear: selectedYear.islamicYear,
				selectedAccountIds: [...preserved, ...next],
			});
		} catch (error) {
			console.error("Failed to save the zakat account selection", error);
			toast.error("Could not save the account selection.");
		} finally {
			setSavingSelection(false);
		}
	}

	async function handleToggleAccount(accountId: string) {
		const next = new Set(selectedAccountIds);
		if (next.has(accountId)) next.delete(accountId);
		else next.add(accountId);
		await persistAccountSelection(next);
	}

	async function handleSelectAllShown(checked: boolean) {
		await persistAccountSelection(
			applyZakatSelectAll(selectedAccountIds, visibleAccountIds, checked)
		);
	}

	async function handleShowArchivedAccounts(showArchived: boolean) {
		setSavingSelection(true);
		try {
			await saveZakatYearShowArchivedAccounts({
				userId,
				islamicYear: selectedYear.islamicYear,
				showArchivedAccounts: showArchived,
			});
		} catch (error) {
			console.error("Failed to save the closed-accounts setting", error);
			toast.error("Could not save the closed-accounts setting.");
		} finally {
			setSavingSelection(false);
		}
	}

	// ── Balances shown beside each account ──────────────────────────────────
	// As of today, never a future-inclusive figure (spec section 5.13). The year's own
	// month-end balances come from the engine's grid, not from here.
	const accountBalances = useMemo(() => {
		if (!allTransactions || !accounts) return new Map<string, number>();
		return computeAccountBalances(userId, accounts, allTransactions, { asOfMs: todayMs }).balances;
	}, [accounts, allTransactions, todayMs, userId]);

	// ── Gold ────────────────────────────────────────────────────────────────
	// Pieces roll up to per-karat grams; each karat is valued at its own price per gram
	// for THE SELECTED YEAR, in the selected currency. The same 170.52g is worth a
	// different amount every year because the price, not the weight, belongs to the year.
	const inventoryGramsByPurity = useMemo(
		() => getZakatGoldGramsByPurity(goldItems ?? []),
		[goldItems]
	);
	const selectedGoldYear = zakatGoldYears.get(selectedYear.islamicYear);
	const goldGramsByPurity = useMemo(
		() => resolveZakatGoldGramsByPurity(selectedGoldYear, goldItems ?? []),
		[goldItems, selectedGoldYear]
	);
	const goldPrices = useMemo(() => getZakatGoldYearPrices(selectedGoldYear), [selectedGoldYear]);
	// The sheet prices gold at 1 Ramaḍān, so that is what an unpriced year opens on.
	const goldPriceDate = useMemo(
		() =>
			selectedGoldYear?.priceDate !== undefined
				? new Date(selectedGoldYear.priceDate)
				: selectedYear.months[0]!.startDate,
		[selectedGoldYear, selectedYear]
	);
	const totalGoldWeightGrams = sumZakatGoldGrams(goldGramsByPurity);

	// ── Carry-forward ───────────────────────────────────────────────────────
	// Past Remaining is DERIVED, never stored: a year's Balance/Excess becomes the next
	// year's opening figure, and an overpayment carries as a negative so it reduces what
	// the following year owes. Only a figure the owner typed is persisted.
	const pastRemainingOverrides = useMemo(
		() => zakatContext?.pastRemainingOverrides ?? new Map<number, number>(),
		[zakatContext]
	);

	/**
	 * Every year the chain needs, assessed with nothing carried in. The window is walked
	 * forward from the earliest year the app exposes and capped, so resolving one year can
	 * never turn into an unbounded walk back through history.
	 *
	 * Each year is assembled by `buildZakatYearAssessments` — its own accounts, its own
	 * closed-accounts rule, its own grams at its own price per gram — which is the same
	 * call History audits a saved calculation against, so the two cannot drift apart.
	 * Only the year on screen follows the owner's basis and rate: decision 2 says a
	 * deliberate switch belongs to the year it was made on.
	 */
	const zakatYearAssessments = useMemo(() => {
		if (!zakatContext) return new Map<number, ZakatYearAssessment>();

		return buildZakatYearAssessments(
			zakatContext,
			getZakatCarryForwardYearRange(selectedYear.islamicYear),
			(islamicYear) =>
				islamicYear === selectedYear.islamicYear
					? { basis, ratePercent, definition: selectedYear }
					: {}
		);
	}, [basis, ratePercent, selectedYear, zakatContext]);

	const zakatYearSettlements = useMemo<ZakatYearSettlement[]>(
		() =>
			[...zakatYearAssessments.entries()].map(([islamicYear, { assessment }]) => ({
				islamicYear,
				zakatObligation: assessment.zakatObligation,
				paid: assessment.paid,
				pastRemainingOverride: pastRemainingOverrides.get(islamicYear),
			})),
		[pastRemainingOverrides, zakatYearAssessments]
	);

	const carryForward = useMemo(
		() => resolveZakatCarryForward(selectedYear.islamicYear, zakatYearSettlements),
		[selectedYear.islamicYear, zakatYearSettlements]
	);

	const selectedYearAssessment = useMemo(() => {
		const base = zakatYearAssessments.get(selectedYear.islamicYear);
		if (!base) return undefined;
		return calculateZakatAssessment({ ...base.input, pastRemaining: carryForward.pastRemaining });
	}, [carryForward.pastRemaining, selectedYear.islamicYear, zakatYearAssessments]);

	// ── Save calculation ────────────────────────────────────────────────────
	// Whatever the engine returned is what gets stored. There is no liability gate:
	// zakat is owed on the chosen basis however small it is (spec section 2).
	//
	// A save ADDS a record; it never replaces one. "On this date I assessed X" is a
	// determination the owner made, and overwriting it would destroy exactly what the
	// History trail exists to preserve. History marks the latest record for a year and
	// keeps the ones it supersedes readable underneath.
	async function handleSaveCalculation() {
		const assessment = selectedYearAssessment;
		if (!assessment) return;

		await db.zakatCalculations.add({
			id: uuid(),
			userId,
			currency: referenceCurrency,
			islamicYear: selectedYear.zakatYear,
			// The year IS the period now, so the stored date is the year's closing day
			// rather than a figure picked from a control that no longer exists.
			assessmentDate: selectedYear.months[11]!.endDate.getTime(),
			// The blended figure the per-karat prices worked out to, kept for history.
			goldPricePerGram: totalGoldWeightGrams > 0 ? assessment.goldValue / totalGoldWeightGrams : 0,
			goldPricesByPurity: { ...goldPrices },
			referenceCurrency,
			basis,
			ratePercent: assessment.ratePercent,
			totalGoldWeightGrams,
			totalGoldValue: assessment.goldValue,
			accountBalances: zakatAccounts.map((a) => {
				const balance = accountBalances.get(a.id) ?? 0;
				return {
					accountId: a.id,
					accountTitle: a.title,
					balance,
					currency: a.currency,
					// One currency per calculation, so nothing is ever converted.
					exchangeRate: 1,
					zakatable: zakatableIds.has(a.id),
					accountType: a.accountType ?? "asset",
				};
			}),
			totalZakatable: assessment.totalZakatable,
			zakatObligation: assessment.zakatObligation,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});

		// Switch to history tab to see the saved calculation
		setActiveTab("history");
	}

	// ── Export ──────────────────────────────────────────────────────────────
	// The workbook mirrors the owner's sheet: one tab per Ramaḍān year, month-end
	// balances per account, and live formulas down to Balance/Excess.
	function handleExport() {
		// The same grid the on-screen summary was assessed from, so the workbook's
		// Total To Pay and Balance/Excess cannot disagree with what the owner just read.
		const grid =
			zakatYearAssessments.get(selectedYear.islamicYear)?.grid ??
			computeZakatYearGrid({
				userId,
				accounts: accounts ?? [],
				transactions: allTransactions ?? [],
				selectedAccountIds: zakatableIds,
				sheetYear: selectedYear.sheetYear,
				yearDefinition: selectedYear,
			});

		exportZakat({
			years: [
				{
					grid,
					currency: referenceCurrency,
					basis,
					ratePercent,
					// The selected year's grams at the selected year's price, kept as two
					// separate editable inputs so the workbook formula stays live.
					goldRows: [...goldGramsByPurity.entries()].map(([purity, grams]) => ({
						purity,
						grams,
						pricePerGram: goldPrices[purity] ?? 0,
					})),
					goldPriceDate,
					pastRemaining: carryForward.pastRemaining,
					payments: (zakatPayments ?? [])
						.filter((payment) => payment.islamicYear === selectedYear.zakatYear)
						.map((payment) => ({
							amount: payment.amount,
							// The owner's Person/Location columns; the app stores them as
							// recipient and notes.
							person: payment.recipient,
							location: payment.notes,
							date: payment.date,
							currency: payment.currency,
						})),
				},
			],
		});
	}

	return (
		<div className="space-y-5">
			{/* Header */}
			<div className="flex items-start justify-between">
				<div>
					<h1 className="hidden text-2xl font-bold md:block">Zakat Calculator</h1>
					<p className="text-sm text-muted-foreground">
						Calculate your annual Zakat obligation • Islamic Year {currentIslamicYear}
					</p>
				</div>
				<Button size="sm" variant="outline" onClick={handleExport}>
					<Download className="mr-1.5 h-3.5 w-3.5" />
					Export
				</Button>
			</div>

			{/* Tabs */}
			<Tabs value={activeTab} onValueChange={setActiveTab}>
				<TabsList className="grid w-full grid-cols-4">
					<TabsTrigger value="calculator">Calculator</TabsTrigger>
					<TabsTrigger value="monthly">Monthly View</TabsTrigger>
					<TabsTrigger value="history">History</TabsTrigger>
					<TabsTrigger value="payments">Payments</TabsTrigger>
				</TabsList>

				{/* CALCULATOR TAB */}
				<TabsContent value="calculator" className="space-y-5">
					{/* The zakat year IS the period: one control, not two. */}
					<ZakatYearCalendarControl
						userId={userId}
						years={availableZakatYears}
						definition={selectedYear}
						onSelectIslamicYear={setPinnedIslamicYear}
					/>

					{/* Gold price for the selected zakat year */}
					<ZakatGoldYearPricing
						userId={userId}
						currency={referenceCurrency}
						islamicYear={selectedYear.islamicYear}
						yearLabel={selectedYear.label}
						pricesByPurity={goldPrices}
						gramsByPurity={goldGramsByPurity}
						inventoryGramsByPurity={inventoryGramsByPurity}
						hasGramsSnapshot={hasZakatGoldYearGramsSnapshot(selectedGoldYear)}
						priceDate={goldPriceDate}
						goldValue={selectedYearAssessment?.goldValue ?? 0}
					/>

					{/* Gold Items */}
					<GoldItemsManager
						userId={userId}
						pricesByPurity={goldPrices}
						referenceCurrency={referenceCurrency}
					/>

					{/* Account selection, saved against this zakat year */}
					<div className="space-y-2">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<Label>Zakatable Accounts • {selectedYear.label}</Label>
							<div className="flex items-center gap-2">
								<Label htmlFor="zakat-show-archived" className="text-xs text-muted-foreground">
									Include closed accounts
								</Label>
								<Switch
									id="zakat-show-archived"
									checked={showArchivedAccounts}
									disabled={savingSelection}
									onCheckedChange={(checked) => void handleShowArchivedAccounts(checked)}
								/>
							</div>
						</div>
						<p className="text-xs text-muted-foreground">
							A closed account still held wealth in the years it was open. With closed accounts
							included, a selected one counts towards this year&apos;s monthly totals, MINIMUM and
							MAXIMUM; switch them off and they stop counting, but stay selected underneath.
						</p>

						<button
							type="button"
							role="checkbox"
							aria-checked={selectAllState === "mixed" ? "mixed" : selectAllState === "checked"}
							data-state={selectAllState}
							disabled={savingSelection || visibleAccountIds.length === 0}
							onClick={() => void handleSelectAllShown(selectAllState !== "checked")}
							className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-left text-sm transition-colors hover:bg-accent/50 disabled:opacity-50">
							<span
								className={`flex h-5 w-5 items-center justify-center rounded border-2 ${
									selectAllState === "unchecked" ? "border-border" : "border-primary bg-primary"
								}`}>
								{selectAllState === "checked" && (
									<Check className="h-3 w-3 text-primary-foreground" />
								)}
								{selectAllState === "mixed" && (
									<Minus className="h-3 w-3 text-primary-foreground" />
								)}
							</span>
							<span className="font-medium">Select all shown</span>
							<span className="text-xs text-muted-foreground">
								{showArchivedAccounts ? "open and closed accounts" : "open accounts only"}
							</span>
						</button>

						<div className="space-y-2">
							{visibleZakatAccounts.map((account) => {
								const selected = selectedAccountIds.has(account.id);
								const balance = accountBalances.get(account.id) ?? 0;
								const isLiability = account.accountType === "liability";

								return (
									<button
										key={account.id}
										type="button"
										role="checkbox"
										aria-checked={selected}
										disabled={savingSelection}
										onClick={() => void handleToggleAccount(account.id)}
										className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition-colors ${
											selected
												? "border-primary bg-primary/5"
												: "border-border bg-card hover:bg-accent/50"
										}`}>
										<div className="flex items-center gap-2">
											<div
												className={`flex h-5 w-5 items-center justify-center rounded border-2 ${
													selected ? "border-primary bg-primary" : "border-border"
												}`}>
												{selected && <Check className="h-3 w-3 text-primary-foreground" />}
											</div>
											<span className="text-sm font-medium">{account.title}</span>
											<span className="text-xs text-muted-foreground">{account.currency}</span>
											{isLiability && (
												<span className="rounded bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
													Liability
												</span>
											)}
											{account.isArchived && (
												<span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
													Closed
												</span>
											)}
										</div>
										<span
											className={`text-sm font-medium tabular-nums ${balance < 0 ? "text-destructive" : ""}`}>
											<CurrencyAmount
												amount={balance}
												currency={account.currency}
												className="font-medium tracking-normal"
											/>
										</span>
									</button>
								);
							})}
							{visibleZakatAccounts.length === 0 && (
								<p className="text-sm text-muted-foreground">
									No {referenceCurrency} accounts found.
								</p>
							)}
						</div>
					</div>

					{/* Basis and rate */}
					<div className="grid gap-3 sm:grid-cols-2">
						<div className="space-y-1.5">
							<Label htmlFor="zakat-basis">Zakat Basis</Label>
							<Select value={basis} onValueChange={(value) => setBasis(value as ZakatBasis)}>
								<SelectTrigger id="zakat-basis">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="minimum">MINIMUM monthly total</SelectItem>
									<SelectItem value="maximum">MAXIMUM monthly total</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								Defaults to the minimum, as the workbook does. The maximum is shown for comparison.
							</p>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="zakat-rate">Zakat Percentage (%)</Label>
							<Input
								id="zakat-rate"
								type="number"
								min={0}
								step="any"
								value={ratePercent || ""}
								onChange={(e) => setRatePercent(parseFloat(e.target.value) || 0)}
								placeholder="2.5"
							/>
							<p className="text-xs text-muted-foreground">
								2.5% by default. Whatever is used here is stored with the calculation.
							</p>
						</div>
					</div>

					{/* Results */}
					<div className="rounded-xl border-2 border-primary bg-primary/5 p-5">
						<h2 className="text-lg font-bold">Calculation Results</h2>
						<p className="mb-4 text-xs text-muted-foreground">
							{selectedYear.label} • {referenceCurrency} only, never combined with another currency
						</p>
						{selectedYearAssessment ? (
							<>
								<div className="space-y-2 text-sm">
									{[
										{
											label: "MINIMUM monthly total",
											value: (
												<CurrencyAmount
													amount={selectedYearAssessment.minimum}
													currency={referenceCurrency}
													showNegativeSign
													className="font-medium"
												/>
											),
											isNegative: selectedYearAssessment.minimum < 0,
										},
										{
											label: "MAXIMUM monthly total",
											value: (
												<CurrencyAmount
													amount={selectedYearAssessment.maximum}
													currency={referenceCurrency}
													showNegativeSign
													className="font-medium"
												/>
											),
											isNegative: selectedYearAssessment.maximum < 0,
										},
										{
											label: `Basis used (${basis === "minimum" ? "MINIMUM" : "MAXIMUM"})`,
											value: (
												<CurrencyAmount
													amount={selectedYearAssessment.basisAmount}
													currency={referenceCurrency}
													showNegativeSign
													className="font-medium"
												/>
											),
											isNegative: selectedYearAssessment.basisAmount < 0,
										},
										{
											label: "Gold value",
											value: (
												<CurrencyAmount
													amount={selectedYearAssessment.goldValue}
													currency={referenceCurrency}
													className="font-medium"
												/>
											),
										},
										{
											label: "TOTAL (basis + gold)",
											value: (
												<CurrencyAmount
													amount={selectedYearAssessment.totalZakatable}
													currency={referenceCurrency}
													showNegativeSign
													className="font-medium"
												/>
											),
											isNegative: selectedYearAssessment.totalZakatable < 0,
										},
										{
											label: "Past Remaining",
											value: (
												<CurrencyAmount
													amount={selectedYearAssessment.pastRemaining}
													currency={referenceCurrency}
													showNegativeSign
													className="font-medium"
												/>
											),
											isNegative: selectedYearAssessment.pastRemaining < 0,
										},
										{
											label: "Total To Pay",
											value: (
												<CurrencyAmount
													amount={selectedYearAssessment.totalToPay}
													currency={referenceCurrency}
													showNegativeSign
													className="font-medium"
												/>
											),
											isNegative: selectedYearAssessment.totalToPay < 0,
										},
										{
											label: "Paid",
											value: (
												<CurrencyAmount
													amount={selectedYearAssessment.paid}
													currency={referenceCurrency}
													className="font-medium"
												/>
											),
										},
										{
											label:
												selectedYearAssessment.balanceOrExcess < 0
													? "Balance/Excess (overpaid)"
													: "Balance/Excess",
											value: (
												<CurrencyAmount
													amount={selectedYearAssessment.balanceOrExcess}
													currency={referenceCurrency}
													showNegativeSign
													className="font-medium"
												/>
											),
											isNegative: selectedYearAssessment.balanceOrExcess < 0,
										},
									].map((item) => {
										const { label, value, isNegative } = item as {
											label: string;
											value: ReactNode;
											isNegative?: boolean;
										};
										return (
											<div key={label} className="flex justify-between">
												<span className="text-muted-foreground">{label}</span>
												<span
													className={`font-medium tabular-nums ${isNegative ? "text-destructive" : ""}`}>
													{value}
												</span>
											</div>
										);
									})}
								</div>

								<div className="mt-4 rounded-lg bg-background p-3 text-center">
									<p className="text-xs text-muted-foreground">
										Zakat Obligation ({selectedYearAssessment.ratePercent}%)
									</p>
									<p className="mt-1 text-2xl font-bold text-primary">
										<CurrencyAmount
											amount={selectedYearAssessment.zakatObligation}
											currency={referenceCurrency}
											showNegativeSign
											className="text-2xl font-bold text-primary"
										/>
									</p>
									<p className="mt-1 text-xs text-muted-foreground">
										Per month:{" "}
										<CurrencyAmount
											amount={selectedYearAssessment.perMonth}
											currency={referenceCurrency}
											showNegativeSign
											className="font-normal tracking-normal"
										/>
									</p>
								</div>

								<div className="mt-4 flex flex-col items-center gap-1.5">
									<Button onClick={() => void handleSaveCalculation()}>
										<Save className="mr-2 h-4 w-4" />
										Save This Calculation
									</Button>
									<p className="text-center text-xs text-muted-foreground">
										Saving records what you assessed today. It is kept as a record and never
										rewritten, so assessing this year again adds another entry beside it.
									</p>
								</div>
							</>
						) : (
							<p className="text-sm text-muted-foreground">Loading this year&apos;s balances...</p>
						)}
					</div>
				</TabsContent>

				{/* MONTHLY VIEW TAB */}
				<TabsContent value="monthly" className="space-y-5">
					<ZakatYearCalendarControl
						userId={userId}
						years={availableZakatYears}
						definition={selectedYear}
						onSelectIslamicYear={setPinnedIslamicYear}
					/>
					{selectedYearAssessment && (
						<ZakatCarryForwardControl
							userId={userId}
							islamicYear={selectedYear.islamicYear}
							yearLabel={selectedYear.label}
							currency={referenceCurrency}
							carryForward={carryForward}
							assessment={selectedYearAssessment}
						/>
					)}
					<ZakatMonthlyBalances
						grid={zakatYearAssessments.get(selectedYear.islamicYear)?.grid}
						currency={referenceCurrency}
						basis={basis}
					/>
				</TabsContent>

				{/* HISTORY TAB */}
				<TabsContent value="history" className="space-y-5">
					<ZakatHistory userId={userId} referenceCurrency={referenceCurrency} />
				</TabsContent>

				{/* PAYMENTS TAB */}
				<TabsContent value="payments" className="space-y-5">
					<ZakatPayments
						userId={userId}
						referenceCurrency={referenceCurrency}
						islamicYear={selectedYear.zakatYear}
						yearLabel={selectedYear.label}
					/>
				</TabsContent>
			</Tabs>
		</div>
	);
}
