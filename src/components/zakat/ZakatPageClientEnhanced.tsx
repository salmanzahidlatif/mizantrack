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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GoldItemsManager } from "@/components/zakat/GoldItemsManager";
import { ZakatCarryForwardControl } from "@/components/zakat/ZakatCarryForwardControl";
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

/** Gold is valued per karat, never converted to a pure-gold equivalent. */
const GOLD_PURITIES: GoldPurity[] = ["21k", "22k", "24k"];

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

/** Itemised pieces rolled up to per-karat grams, the way the owner's sheet prices gold. */
export function getZakatGoldGramsByPurity(items: GoldItem[]): Map<GoldPurity, number> {
	const grams = new Map<GoldPurity, number>();
	for (const item of items) {
		grams.set(item.purity, (grams.get(item.purity) ?? 0) + item.weight);
	}
	return grams;
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
	const accounts = useAccounts(userId);

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

	// Payments recorded for this currency; the export filters them down to the year.
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
	// Price per gram for each karat, in the selected currency. Decision 6: the owner
	// prices each karat; nothing is scaled off a single pure-gold figure.
	const [goldPrices, setGoldPrices] = useState<Partial<Record<GoldPurity, number>>>({});
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

	// Pre-select all asset accounts as zakatable (not liabilities)
	useEffect(() => {
		if (zakatAccounts.length > 0 && zakatableIds.size === 0) {
			const assetAccounts = zakatAccounts.filter((a) => a.accountType !== "liability");
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

	// ── Balance at assessment date ──────────────────────────────────────────
	const accountBalances = useMemo(() => {
		if (!allTransactions || !accounts) return new Map<string, number>();
		const asOf = endOfDay(assessmentDate).getTime();
		return computeAccountBalances(userId, accounts, allTransactions, { asOfMs: asOf }).balances;
	}, [accounts, allTransactions, assessmentDate, userId]);

	// ── Gold ────────────────────────────────────────────────────────────────
	// Pieces roll up to per-karat grams; each karat is valued at its own price per gram
	// in the selected currency. No pure-gold conversion enters the calculation.
	const goldGramsByPurity = useMemo(() => getZakatGoldGramsByPurity(goldItems ?? []), [goldItems]);
	const totalGoldWeightGrams = useMemo(() => getZakatGoldGrams(goldItems ?? []), [goldItems]);

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
			const input: ZakatAssessmentInput = {
				monthlyTotals: grid.monthlyTotals,
				basis: isSelectedYear ? basis : "minimum",
				goldItems: goldItems ?? [],
				goldPrices: {
					priceDate: format(assessmentDate, "yyyy-MM-dd"),
					pricesByPurity: goldPrices,
				},
				ratePercent: isSelectedYear ? ratePercent : DEFAULT_ZAKAT_RATE_PERCENT,
				pastRemaining: 0,
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
		assessmentDate,
		basis,
		goldItems,
		goldPrices,
		ramadanStarts,
		ratePercent,
		selectedYear,
		userId,
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
					goldRows: [...goldGramsByPurity.entries()].map(([purity, grams]) => ({
						purity,
						grams,
						pricePerGram: goldPrices[purity] ?? 0,
					})),
					goldPriceDate: assessmentDate,
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

					{/* Gold prices per karat */}
					<div className="space-y-2">
						<div>
							<Label>Gold Price per gram ({referenceCurrency})</Label>
							<p className="text-xs text-muted-foreground">
								One price per karat, in {referenceCurrency}, as of{" "}
								{format(assessmentDate, "d MMM yyyy")}. The owner&apos;s sheet prices gold on 1
								Ramaḍān.
							</p>
						</div>
						<div className="grid gap-3 sm:grid-cols-3">
							{GOLD_PURITIES.map((purity) => (
								<div key={purity} className="space-y-1">
									<Label htmlFor={`gold-price-${purity}`} className="text-xs text-muted-foreground">
										{purity} price per gram
									</Label>
									<Input
										id={`gold-price-${purity}`}
										type="number"
										min={0}
										step="any"
										value={goldPrices[purity] ?? ""}
										onChange={(e) =>
											setGoldPrices((prev) => ({
												...prev,
												[purity]: parseFloat(e.target.value) || 0,
											}))
										}
										placeholder="0.00"
									/>
									<p className="text-xs text-muted-foreground tabular-nums">
										{(goldGramsByPurity.get(purity) ?? 0).toFixed(2)}g held
									</p>
								</div>
							))}
						</div>
					</div>

					{/* Gold Items */}
					<GoldItemsManager
						userId={userId}
						pricesByPurity={goldPrices}
						referenceCurrency={referenceCurrency}
					/>

					{/* Account selection */}
					<div className="space-y-2">
						<Label>Zakatable Accounts</Label>
						<div className="space-y-2">
							{zakatAccounts.map((account) => {
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
							{zakatAccounts.length === 0 && (
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
					<ZakatPayments userId={userId} referenceCurrency={referenceCurrency} />
				</TabsContent>
			</Tabs>
		</div>
	);
}
