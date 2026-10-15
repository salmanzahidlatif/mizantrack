"use client";

import { endOfDay, format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarIcon, Check, Download, Loader2, RefreshCw, Save } from "lucide-react";
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
import { fetchGoldPrice } from "@/lib/goldPrice";
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

import type { ZakatAssessment, ZakatAssessmentInput, ZakatYearGrid } from "@/lib/zakatEngine";
import type { Account, GoldItem, GoldPurity } from "@/types";

const NISAB_GOLD_GRAMS = 85;
const NISAB_SILVER_GRAMS = 595;
/** Exported workbooks carry the editable rate the owner's sheet defaults to. */
const ZAKAT_RATE_PERCENT = 2.5;

const PURITY_TO_PURE_GOLD: Record<GoldPurity, number> = {
	"21k": 21 / 24,
	"22k": 22 / 24,
	"24k": 1.0,
};

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

export function getPureGoldWeightGrams(items: GoldItem[]): number {
	return items.reduce((sum, item) => {
		const pureWeight = item.weight * PURITY_TO_PURE_GOLD[item.purity];
		return sum + pureWeight;
	}, 0);
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
	const [goldPrice, setGoldPrice] = useState(0);
	const [goldPriceLoading, setGoldPriceLoading] = useState(false);
	const [goldPriceManual, setGoldPriceManual] = useState(false);
	const [nisab, setNisab] = useState<"gold" | "silver">("gold");
	const [silverPrice, setSilverPrice] = useState(0);
	const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});
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

	// Auto-fetch gold price on mount
	useEffect(() => {
		setGoldPriceLoading(true);
		void fetchGoldPrice(userId).then((price) => {
			if (price && !goldPriceManual) setGoldPrice(price);
			setGoldPriceLoading(false);
		});
	}, [userId]);

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

	// ── Gold calculation ────────────────────────────────────────────────────
	const totalGoldWeightGrams = useMemo(() => {
		if (!goldItems) return 0;
		return getPureGoldWeightGrams(goldItems);
	}, [goldItems]);

	const goldValue = totalGoldWeightGrams * goldPrice;

	// ── Unique non-reference currencies ────────────────────────────────────
	const foreignCurrencies = useMemo(() => {
		return [];
	}, []);

	// ── Zakat calculation ───────────────────────────────────────────────────
	const { totalAssets, totalLiabilities, totalZakatable } = useMemo(() => {
		let assets = goldValue;
		let liabilities = 0;

		for (const account of zakatAccounts) {
			if (!zakatableIds.has(account.id)) continue;

			const balance = accountBalances.get(account.id) ?? 0;
			const isLiability = account.accountType === "liability";

			if (isLiability) {
				// Liabilities reduce zakatable wealth (negative values)
				liabilities += Math.abs(balance);
			} else if (balance > 0) {
				// Only positive balances count as assets
				assets += balance;
			}
		}

		const zakatable = Math.max(0, assets - liabilities);

		return { totalAssets: assets, totalLiabilities: liabilities, totalZakatable: zakatable };
	}, [zakatAccounts, zakatableIds, accountBalances, goldValue]);

	const nisabThreshold =
		nisab === "gold" ? NISAB_GOLD_GRAMS * goldPrice : NISAB_SILVER_GRAMS * silverPrice;
	const zakatObligation = totalZakatable >= nisabThreshold ? totalZakatable * 0.025 : 0;
	const isLiable = totalZakatable >= nisabThreshold && nisabThreshold > 0;

	// ── Save calculation ────────────────────────────────────────────────────
	async function handleSaveCalculation() {
		if (!isLiable) return;

		await db.zakatCalculations.add({
			id: uuid(),
			userId,
			currency: referenceCurrency,
			islamicYear: currentIslamicYear,
			assessmentDate: assessmentDate.getTime(),
			nisabStandard: nisab,
			goldPricePerGram: goldPrice,
			silverPricePerGram: nisab === "silver" ? silverPrice : undefined,
			referenceCurrency,
			totalGoldWeightGrams,
			totalGoldValue: goldValue,
			accountBalances: zakatAccounts.map((a) => {
				const balance = accountBalances.get(a.id) ?? 0;
				return {
					accountId: a.id,
					accountTitle: a.title,
					balance,
					currency: a.currency,
					exchangeRate: 1,
					zakatable: zakatableIds.has(a.id),
					accountType: a.accountType ?? "asset",
				};
			}),
			totalZakatable,
			nisabThreshold,
			zakatObligation,
			isLiable,
			createdAt: Date.now(),
			updatedAt: Date.now(),
		});

		// Switch to history tab to see the saved calculation
		setActiveTab("history");
	}

	const monthlyViewMonths = useMemo(
		() =>
			selectedYear.months.map((month) => ({
				month: month.month,
				year: month.islamicYear,
				endDate: month.endDate,
			})),
		[selectedYear]
	);

	// ── Carry-forward ───────────────────────────────────────────────────────
	// Past Remaining is DERIVED, never stored: a year's Balance/Excess becomes the next
	// year's opening figure, and an overpayment carries as a negative so it reduces what
	// the following year owes. Only a figure the owner typed is persisted.
	const pastRemainingOverrides = useMemo(
		() => toPastRemainingOverrideMap(zakatYearOverrides ?? []),
		[zakatYearOverrides]
	);

	const goldPricesByPurity = useMemo(() => {
		const prices: Partial<Record<GoldPurity, number>> = {};
		for (const purity of Object.keys(PURITY_TO_PURE_GOLD) as GoldPurity[]) {
			prices[purity] = goldPrice * PURITY_TO_PURE_GOLD[purity];
		}
		return prices;
	}, [goldPrice]);

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
			const input: ZakatAssessmentInput = {
				monthlyTotals: grid.monthlyTotals,
				basis: "minimum",
				goldItems: goldItems ?? [],
				goldPrices: {
					priceDate: format(assessmentDate, "yyyy-MM-dd"),
					pricesByPurity: goldPricesByPurity,
				},
				ratePercent: ZAKAT_RATE_PERCENT,
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
		goldItems,
		goldPricesByPurity,
		ramadanStarts,
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

		const gramsByPurity = new Map<GoldPurity, number>();
		for (const item of goldItems ?? []) {
			gramsByPurity.set(item.purity, (gramsByPurity.get(item.purity) ?? 0) + item.weight);
		}

		exportZakat({
			years: [
				{
					grid,
					currency: referenceCurrency,
					basis: "minimum",
					ratePercent: ZAKAT_RATE_PERCENT,
					goldRows: [...gramsByPurity.entries()].map(([purity, grams]) => ({
						purity,
						grams,
						pricePerGram: goldPrice * PURITY_TO_PURE_GOLD[purity],
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

					{/* Gold Items */}
					<GoldItemsManager
						userId={userId}
						goldPricePerGram={goldPrice}
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

					{/* Exchange rates */}
					{foreignCurrencies.length > 0 && (
						<div className="space-y-2">
							<Label>Exchange Rates (to {referenceCurrency})</Label>
							<div className="grid gap-3 sm:grid-cols-2">
								{foreignCurrencies.map((cur) => (
									<div key={cur} className="space-y-1">
										<Label className="text-xs text-muted-foreground">
											1 {cur} = ? {referenceCurrency}
										</Label>
										<Input
											type="number"
											min={0}
											step="any"
											value={exchangeRates[cur] ?? ""}
											onChange={(e) =>
												setExchangeRates((prev) => ({
													...prev,
													[cur]: parseFloat(e.target.value) || 0,
												}))
											}
											placeholder="0.00"
										/>
									</div>
								))}
							</div>
						</div>
					)}

					{/* Gold price */}
					<div className="space-y-2">
						<div className="flex items-center justify-between">
							<Label>Gold Price per gram (USD)</Label>
							<button
								type="button"
								onClick={() => {
									setGoldPriceManual(false);
									setGoldPriceLoading(true);
									void fetchGoldPrice(userId).then((p) => {
										if (p) setGoldPrice(p);
										setGoldPriceLoading(false);
									});
								}}
								className="flex items-center gap-1 text-xs text-primary hover:underline">
								{goldPriceLoading ? (
									<Loader2 className="h-3 w-3 animate-spin" />
								) : (
									<RefreshCw className="h-3 w-3" />
								)}
								Refresh
							</button>
						</div>
						<Input
							type="number"
							min={0}
							step="any"
							value={goldPrice || ""}
							onChange={(e) => {
								setGoldPriceManual(true);
								setGoldPrice(parseFloat(e.target.value) || 0);
							}}
							placeholder="e.g. 85.00"
						/>
					</div>

					{/* Nisab standard */}
					<div className="space-y-2">
						<Label>Nisab Standard</Label>
						<Select value={nisab} onValueChange={(v) => setNisab(v as "gold" | "silver")}>
							<SelectTrigger className="w-auto">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="gold">Gold (85g)</SelectItem>
								<SelectItem value="silver">Silver (595g)</SelectItem>
							</SelectContent>
						</Select>
						{nisab === "silver" && (
							<div className="space-y-1">
								<Label className="text-xs text-muted-foreground">Silver price per gram (USD)</Label>
								<Input
									type="number"
									min={0}
									step="any"
									value={silverPrice || ""}
									onChange={(e) => setSilverPrice(parseFloat(e.target.value) || 0)}
									placeholder="e.g. 1.00"
									className="max-w-35"
								/>
							</div>
						)}
					</div>

					{/* Results */}
					<div
						className={`rounded-xl border-2 p-5 ${isLiable ? "border-primary bg-primary/5" : "border-border bg-card"}`}>
						<h2 className="mb-4 text-lg font-bold">Calculation Results</h2>
						<div className="space-y-2 text-sm">
							{[
								{
									label: "Total Assets",
									value: (
										<CurrencyAmount
											amount={totalAssets}
											currency={referenceCurrency}
											className="font-medium"
										/>
									),
								},
								totalLiabilities > 0 && {
									label: "Total Liabilities",
									value: (
										<CurrencyAmount
											amount={-totalLiabilities}
											currency={referenceCurrency}
											showNegativeSign
											className="font-medium"
										/>
									),
									isNegative: true,
								},
								{
									label: "Net Zakatable Wealth",
									value: (
										<CurrencyAmount
											amount={totalZakatable}
											currency={referenceCurrency}
											className="font-medium"
										/>
									),
								},
								{
									label: `Nisab Threshold (${nisab === "gold" ? "85g gold" : "595g silver"})`,
									value:
										nisabThreshold > 0 ? (
											<CurrencyAmount
												amount={nisabThreshold}
												currency={referenceCurrency}
												className="font-medium"
											/>
										) : (
											"—"
										),
								},
							]
								.filter(Boolean)
								.map((item) => {
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
							{nisabThreshold === 0 ? (
								<p className="text-sm text-muted-foreground">Enter gold price to calculate</p>
							) : isLiable ? (
								<>
									<p className="text-xs text-muted-foreground">Zakat Obligation (2.5%)</p>
									<p className="mt-1 text-2xl font-bold text-primary">
										<CurrencyAmount
											amount={zakatObligation}
											currency={referenceCurrency}
											className="text-2xl font-bold text-primary"
										/>
									</p>
								</>
							) : (
								<>
									<p className="text-lg font-semibold text-muted-foreground">Not yet liable</p>
									<p className="text-xs text-muted-foreground">Wealth is below nisab threshold</p>
								</>
							)}
						</div>

						{isLiable && (
							<div className="mt-4 flex justify-center">
								<Button onClick={() => void handleSaveCalculation()}>
									<Save className="mr-2 h-4 w-4" />
									Save This Calculation
								</Button>
							</div>
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
						userId={userId}
						zakatYear={selectedYear.zakatYear}
						accounts={zakatAccounts}
						zakatableIds={zakatableIds}
						referenceCurrency={referenceCurrency}
						exchangeRates={exchangeRates}
						months={monthlyViewMonths}
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
