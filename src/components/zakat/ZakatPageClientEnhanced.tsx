"use client";

import { endOfDay, format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarIcon, Check, Download, Save } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { v4 as uuid } from "uuid";

import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { useAccounts } from "@/hooks/useAccounts";
import { useDbConfig } from "@/hooks/useDbConfig";
import { useRequiredUserId } from "@/hooks/useRequiredUserId";
import {
	computeAccountBalances,
	normalizeCurrencyCode,
	resolveCurrencyCode,
} from "@/lib/analytics/balanceMath";
import { db } from "@/lib/db/local";
import { ZAKAT_EARLIEST_ISLAMIC_YEAR } from "@/lib/zakatCalendar";
import {
	resolveZakatCarryForward,
	ZAKAT_CARRY_FORWARD_MAX_LOOKBACK_YEARS,
	type ZakatYearSettlement,
} from "@/lib/zakatCarryForward";
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
	toZakatGoldItems,
	toZakatGoldYearMap,
} from "@/lib/zakatGoldYearRepository";
import { toPastRemainingOverrideMap, toRamadanStartMap } from "@/lib/zakatYearRepository";
import { useFilterStore } from "@/store/filter-store";

import type {
	ZakatAssessment,
	ZakatAssessmentInput,
	ZakatBasis,
	ZakatYearGrid,
} from "@/lib/zakatEngine";
import type { Account, GoldItem, GoldPurity } from "@/types";

/** The owner's workbook rate. Editable on screen; stored with every calculation. */
export const DEFAULT_ZAKAT_RATE_PERCENT = 2.5;

export function getZakatAccountsForCurrency(accounts: Account[], currency: string): Account[] {
	const normalizedCurrency = normalizeCurrencyCode(currency);
	return accounts.filter(
		(account) => normalizeCurrencyCode(account.currency) === normalizedCurrency
	);
}

export function getZakatGoldItemsForCurrency(items: GoldItem[], currency: string): GoldItem[] {
	const normalizedCurrency = normalizeCurrencyCode(currency);
	return items.filter((item) => normalizeCurrencyCode(item.currency) === normalizedCurrency);
}

export function getZakatGoldGrams(items: GoldItem[]): number {
	return items.reduce((sum, item) => sum + item.weight, 0);
}

interface ZakatPageClientProps {
	userId?: string;
}

export function ZakatPageClientEnhanced({ userId: providedUserId }: ZakatPageClientProps = {}) {
	const userId = useRequiredUserId(providedUserId);
	const config = useDbConfig(userId);
	const { activeCurrency } = useFilterStore();
	const referenceCurrency = resolveCurrencyCode(activeCurrency, config?.currency);
	// Archived accounts are loaded as well: a closed account still held wealth during a
	// past year, so it must be selectable and must reach the grid, the totals, MINIMUM
	// and MAXIMUM. The toggle below only decides whether the picker lists them.
	const accounts = useAccounts(userId, { showArchived: true });

	const allTransactions = useLiveQuery(
		() =>
			db.transactions
				.where("userId")
				.equals(userId)
				.filter((t) => !t.deletedAt)
				.toArray(),
		[userId]
	);

	const goldItems = useLiveQuery(
		() =>
			db.goldItems
				.where("userId")
				.equals(userId)
				.filter((g) => !g.deletedAt && normalizeCurrencyCode(g.currency) === referenceCurrency)
				.toArray(),
		[userId, referenceCurrency]
	);
	const zakatAccounts = useMemo(
		() => getZakatAccountsForCurrency(accounts ?? [], referenceCurrency),
		[accounts, referenceCurrency]
	);

	// Gold priced per zakat year. The inventory is NOT duplicated per year: only the
	// price the owner typed for a year — and the grams snapshot, when a year's holding
	// genuinely differed — lives here.
	const zakatGoldYearRecords = useLiveQuery(
		() => db.zakatGoldYears.where("userId").equals(userId).toArray(),
		[userId]
	);
	const zakatGoldYears = useMemo(
		() => toZakatGoldYearMap(zakatGoldYearRecords ?? [], referenceCurrency),
		[referenceCurrency, zakatGoldYearRecords]
	);

	// Payments recorded for this currency; the screen, the engine and the export all
	// filter them down to the selected year.
	const zakatPayments = useLiveQuery(
		() =>
			db.zakatPayments
				.where("userId")
				.equals(userId)
				.filter((p) => !p.deletedAt && normalizeCurrencyCode(p.currency) === referenceCurrency)
				.sortBy("date"),
		[userId, referenceCurrency]
	);

	// ── Form state ──────────────────────────────────────────────────────────
	const [assessmentDate, setAssessmentDate] = useState<Date>(new Date());
	const [calOpen, setCalOpen] = useState(false);
	const [zakatableIds, setZakatableIds] = useState<Set<string>>(new Set());
	// Spec section 5.14: archived accounts are listed by default, with a toggle to hide
	// them. A selected one stays listed either way (5.15).
	const [showArchivedAccounts, setShowArchivedAccounts] = useState(true);
	const [basis, setBasis] = useState<ZakatBasis>("minimum");
	const [ratePercent, setRatePercent] = useState<number>(DEFAULT_ZAKAT_RATE_PERCENT);
	const [activeTab, setActiveTab] = useState("calculator");

	// ── Zakat calendar ──────────────────────────────────────────────────────
	// Saved Ramaḍān anchors win over the announced/computed defaults. Only the anchor is
	// stored; the twelve months are regenerated from it on every render.
	const zakatYearOverrides = useLiveQuery(
		() => db.zakatYears.where("userId").equals(userId).toArray(),
		[userId]
	);
	const ramadanStarts = useMemo(
		() => toRamadanStartMap(zakatYearOverrides ?? []),
		[zakatYearOverrides]
	);
	const availableZakatYears = useMemo(
		() => getZakatYearDefinitions({ ramadanStarts }),
		[ramadanStarts]
	);
	const assessmentIslamicYear = useMemo(
		() => getDefaultZakatIslamicYear(assessmentDate, { ramadanStarts }),
		[assessmentDate, ramadanStarts]
	);
	// null means "follow the assessment date"; a number pins the Monthly View to one year.
	const [pinnedIslamicYear, setPinnedIslamicYear] = useState<number | null>(null);
	const selectedYear = useMemo(
		() =>
			getZakatYearDefinitionByIslamicYear(pinnedIslamicYear ?? assessmentIslamicYear, {
				ramadanStarts,
			}),
		[assessmentIslamicYear, pinnedIslamicYear, ramadanStarts]
	);

	// Islamic year for current assessment date
	const currentIslamicYear = useMemo(
		() => getZakatYearDefinitionByIslamicYear(assessmentIslamicYear, { ramadanStarts }).zakatYear,
		[assessmentIslamicYear, ramadanStarts]
	);

	// Decision 2: every year opens on MINIMUM. A deliberate switch to MAXIMUM belongs to
	// the year it was made on and is never carried into another one.
	useEffect(() => {
		setBasis("minimum");
	}, [selectedYear.islamicYear]);

	// Pre-select open asset accounts (not liabilities, not closed ones). A closed account
	// is offered rather than assumed: only the owner knows which year it belonged to.
	useEffect(() => {
		if (zakatAccounts.length > 0 && zakatableIds.size === 0) {
			const assetAccounts = zakatAccounts.filter(
				(a) => a.accountType !== "liability" && !a.isArchived
			);
			setZakatableIds(new Set(assetAccounts.map((a) => a.id)));
		}
	}, [zakatAccounts, zakatableIds.size]);

	useEffect(() => {
		setZakatableIds((prev) => {
			const accountIds = new Set(zakatAccounts.map((account) => account.id));
			const next = new Set([...prev].filter((id) => accountIds.has(id)));
			return next.size === prev.size ? prev : next;
		});
	}, [zakatAccounts]);

	// A selected account stays listed even when the toggle hides closed ones, so a year
	// can never be assessed on an account the owner cannot see (spec section 5.15).
	const visibleZakatAccounts = useMemo(
		() =>
			zakatAccounts.filter(
				(account) => showArchivedAccounts || !account.isArchived || zakatableIds.has(account.id)
			),
		[showArchivedAccounts, zakatAccounts, zakatableIds]
	);

	// ── Balance at assessment date ──────────────────────────────────────────
	const accountBalances = useMemo(() => {
		if (!allTransactions || !accounts) return new Map<string, number>();
		const asOf = endOfDay(assessmentDate).getTime();
		return computeAccountBalances(userId, accounts, allTransactions, { asOfMs: asOf }).balances;
	}, [accounts, allTransactions, assessmentDate, userId]);

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
		() => toPastRemainingOverrideMap(zakatYearOverrides ?? []),
		[zakatYearOverrides]
	);

	/**
	 * Every year the chain needs, assessed with nothing carried in. The window is walked
	 * forward from the earliest year the app exposes and capped, so resolving one year can
	 * never turn into an unbounded walk back through history.
	 */
	const zakatYearAssessments = useMemo(() => {
		const byYear = new Map<
			number,
			{ grid: ZakatYearGrid; input: ZakatAssessmentInput; assessment: ZakatAssessment }
		>();
		const goldItemsForYear = goldItems ?? [];
		const firstIslamicYear = Math.max(
			ZAKAT_EARLIEST_ISLAMIC_YEAR,
			selectedYear.islamicYear - ZAKAT_CARRY_FORWARD_MAX_LOOKBACK_YEARS
		);

		for (
			let islamicYear = firstIslamicYear;
			islamicYear <= selectedYear.islamicYear;
			islamicYear += 1
		) {
			const definition =
				islamicYear === selectedYear.islamicYear
					? selectedYear
					: getZakatYearDefinitionByIslamicYear(islamicYear, { ramadanStarts });
			const grid = computeZakatYearGrid({
				userId,
				accounts: accounts ?? [],
				transactions: allTransactions ?? [],
				selectedAccountIds: zakatableIds,
				sheetYear: definition.sheetYear,
				yearDefinition: definition,
			});
			// Only the year on screen follows the owner's basis and rate. Earlier years
			// are only being settled to carry a balance forward, and decision 2 says a
			// deliberate switch is never remembered or applied to another year.
			const isSelectedYear = islamicYear === selectedYear.islamicYear;
			// Each year is valued at ITS OWN price per gram, on its own grams. A year the
			// owner never priced contributes no gold value rather than borrowing another
			// year's price.
			const goldYear = zakatGoldYears.get(islamicYear);
			const gramsByPurity = resolveZakatGoldGramsByPurity(goldYear, goldItemsForYear);
			const priceDate =
				goldYear?.priceDate !== undefined
					? new Date(goldYear.priceDate)
					: definition.months[0]!.startDate;
			const input: ZakatAssessmentInput = {
				monthlyTotals: grid.monthlyTotals,
				basis: isSelectedYear ? basis : "minimum",
				goldItems: toZakatGoldItems(gramsByPurity),
				goldPrices: {
					priceDate: format(priceDate, "yyyy-MM-dd"),
					pricesByPurity: getZakatGoldYearPrices(goldYear),
				},
				ratePercent: isSelectedYear ? ratePercent : DEFAULT_ZAKAT_RATE_PERCENT,
				pastRemaining: 0,
				// Paid is the sum of THIS year's payments, which is the same figure the
				// carry-forward chain settles the year on.
				payments: (zakatPayments ?? []).filter(
					(payment) => payment.islamicYear === definition.zakatYear
				),
			};

			byYear.set(islamicYear, { grid, input, assessment: calculateZakatAssessment(input) });
		}

		return byYear;
	}, [
		accounts,
		allTransactions,
		basis,
		goldItems,
		ramadanStarts,
		ratePercent,
		selectedYear,
		userId,
		zakatGoldYears,
		zakatPayments,
		zakatableIds,
	]);

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
	async function handleSaveCalculation() {
		const assessment = selectedYearAssessment;
		if (!assessment) return;

		await db.zakatCalculations.add({
			id: uuid(),
			userId,
			currency: referenceCurrency,
			islamicYear: selectedYear.zakatYear,
			assessmentDate: assessmentDate.getTime(),
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
					{/* Assessment date */}
					<div className="space-y-1.5">
						<Label>Assessment Date</Label>
						<Popover open={calOpen} onOpenChange={setCalOpen}>
							<PopoverTrigger asChild>
								<Button variant="outline" className="w-auto justify-start font-normal">
									<CalendarIcon className="mr-2 h-4 w-4" />
									{format(assessmentDate, "d MMMM yyyy")}
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-auto p-0" align="start">
								<Calendar
									mode="single"
									selected={assessmentDate}
									onSelect={(d) => {
										if (d) {
											setAssessmentDate(d);
											setCalOpen(false);
										}
									}}
								/>
							</PopoverContent>
						</Popover>
					</div>

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

					{/* Account selection */}
					<div className="space-y-2">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<Label>Zakatable Accounts</Label>
							<div className="flex items-center gap-2">
								<Label htmlFor="zakat-show-archived" className="text-xs text-muted-foreground">
									Show closed accounts
								</Label>
								<Switch
									id="zakat-show-archived"
									checked={showArchivedAccounts}
									onCheckedChange={setShowArchivedAccounts}
								/>
							</div>
						</div>
						<p className="text-xs text-muted-foreground">
							A closed account still held wealth in the years it was open. Select it and it counts
							towards this year&apos;s monthly totals, MINIMUM and MAXIMUM.
						</p>
						<div className="space-y-2">
							{visibleZakatAccounts.map((account) => {
								const selected = zakatableIds.has(account.id);
								const balance = accountBalances.get(account.id) ?? 0;
								const isLiability = account.accountType === "liability";

								return (
									<button
										key={account.id}
										type="button"
										onClick={() => {
											setZakatableIds((prev) => {
												const next = new Set(prev);
												if (next.has(account.id)) next.delete(account.id);
												else next.add(account.id);
												return next;
											});
										}}
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

								<div className="mt-4 flex justify-center">
									<Button onClick={() => void handleSaveCalculation()}>
										<Save className="mr-2 h-4 w-4" />
										Save This Calculation
									</Button>
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
