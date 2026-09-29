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
import { ZakatHistory } from "@/components/zakat/ZakatHistory";
import { ZakatMonthlyBalances } from "@/components/zakat/ZakatMonthlyBalances";
import { ZakatPayments } from "@/components/zakat/ZakatPayments";
import { useAccounts } from "@/hooks/useAccounts";
import { useDbConfig } from "@/hooks/useDbConfig";
import { db } from "@/lib/db/local";
import { fetchGoldPrice } from "@/lib/goldPrice";
import { getZakatYear } from "@/lib/islamicCalendar";
import { exportZakatSummary } from "@/lib/zakatExport";
import { useFilterStore } from "@/store/filter-store";

import type { GoldPurity } from "@/types";

const NISAB_GOLD_GRAMS = 85;
const NISAB_SILVER_GRAMS = 595;

const PURITY_TO_PURE_GOLD: Record<GoldPurity, number> = {
	"21k": 21 / 24,
	"22k": 22 / 24,
	"24k": 1.0,
};

interface ZakatPageClientProps {
	userId: string;
}

export function ZakatPageClientEnhanced({ userId }: ZakatPageClientProps) {
	const config = useDbConfig(userId);
	const { activeCurrency } = useFilterStore();
	const referenceCurrency = activeCurrency !== "" ? activeCurrency : (config?.currency ?? "PKR");
	const accounts = useAccounts(userId, { currency: activeCurrency || undefined });

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
				.filter((g) => !g.deletedAt)
				.toArray(),
		[userId]
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

	// Islamic year for current assessment date
	const currentIslamicYear = useMemo(() => getZakatYear(assessmentDate), [assessmentDate]);

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
		if (accounts && zakatableIds.size === 0) {
			const assetAccounts = accounts.filter((a) => a.accountType !== "liability");
			setZakatableIds(new Set(assetAccounts.map((a) => a.id)));
		}
	}, [accounts]);

	// ── Balance at assessment date ──────────────────────────────────────────
	const accountBalances = useMemo(() => {
		if (!accounts || !allTransactions) return new Map<string, number>();
		const asOf = endOfDay(assessmentDate).getTime();
		const map = new Map<string, number>();

		for (const account of accounts) {
			let balance = account.openingBalance;
			for (const t of allTransactions) {
				if (t.date > asOf) continue;
				if (t.accountId === account.id) {
					if (t.type === "Income") balance += t.amount;
					else if (t.type === "Expense") balance -= t.amount;
					else if (t.type === "Transfer") balance -= t.amount;
				} else if (t.toAccountId === account.id && t.type === "Transfer") {
					balance += t.amount;
				}
			}
			map.set(account.id, balance);
		}
		return map;
	}, [accounts, allTransactions, assessmentDate]);

	// ── Gold calculation ────────────────────────────────────────────────────
	const totalGoldWeightGrams = useMemo(() => {
		if (!goldItems) return 0;
		return goldItems.reduce((sum, item) => {
			const pureWeight = item.weight * PURITY_TO_PURE_GOLD[item.purity];
			return sum + pureWeight;
		}, 0);
	}, [goldItems]);

	const goldValue = totalGoldWeightGrams * goldPrice;

	// ── Unique non-reference currencies ────────────────────────────────────
	const foreignCurrencies = useMemo(() => {
		if (!accounts) return [];
		return [
			...new Set(
				accounts
					.filter((a) => zakatableIds.has(a.id) && a.currency !== referenceCurrency)
					.map((a) => a.currency)
			),
		];
	}, [accounts, zakatableIds, referenceCurrency]);

	// ── Zakat calculation ───────────────────────────────────────────────────
	const { totalAssets, totalLiabilities, totalZakatable } = useMemo(() => {
		if (!accounts) return { totalAssets: 0, totalLiabilities: 0, totalZakatable: 0 };

		let assets = goldValue;
		let liabilities = 0;

		for (const account of accounts) {
			if (!zakatableIds.has(account.id)) continue;

			const balance = accountBalances.get(account.id) ?? 0;
			const isLiability = account.accountType === "liability";

			// Convert to reference currency
			const rate =
				account.currency === referenceCurrency ? 1 : (exchangeRates[account.currency] ?? 1);
			const balanceInRef = balance * rate;

			if (isLiability) {
				// Liabilities reduce zakatable wealth (negative values)
				liabilities += Math.abs(balanceInRef);
			} else if (balance > 0) {
				// Only positive balances count as assets
				assets += balanceInRef;
			}
		}

		const zakatable = Math.max(0, assets - liabilities);

		return { totalAssets: assets, totalLiabilities: liabilities, totalZakatable: zakatable };
	}, [accounts, zakatableIds, accountBalances, goldValue, referenceCurrency, exchangeRates]);

	const nisabThreshold =
		nisab === "gold" ? NISAB_GOLD_GRAMS * goldPrice : NISAB_SILVER_GRAMS * silverPrice;
	const zakatObligation = totalZakatable >= nisabThreshold ? totalZakatable * 0.025 : 0;
	const isLiable = totalZakatable >= nisabThreshold && nisabThreshold > 0;

	// ── Save calculation ────────────────────────────────────────────────────
	async function handleSaveCalculation() {
		if (!accounts || !isLiable) return;

		await db.zakatCalculations.add({
			id: uuid(),
			userId,
			islamicYear: currentIslamicYear,
			assessmentDate: assessmentDate.getTime(),
			nisabStandard: nisab,
			goldPricePerGram: goldPrice,
			silverPricePerGram: nisab === "silver" ? silverPrice : undefined,
			referenceCurrency,
			totalGoldWeightGrams,
			totalGoldValue: goldValue,
			accountBalances: accounts.map((a) => {
				const balance = accountBalances.get(a.id) ?? 0;
				const rate = a.currency === referenceCurrency ? 1 : (exchangeRates[a.currency] ?? 1);
				return {
					accountId: a.id,
					accountTitle: a.title,
					balance,
					currency: a.currency,
					exchangeRate: rate,
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

	// ── Export ──────────────────────────────────────────────────────────────
	function handleExport() {
		if (!accounts) return;
		exportZakatSummary({
			assessmentDate,
			nisabStandard: nisab,
			goldPricePerGram: goldPrice,
			silverPricePerGram: silverPrice,
			goldWeightGrams: totalGoldWeightGrams,
			nisabThreshold,
			totalZakatable,
			zakatObligation,
			referenceCurrency,
			accounts: accounts.map((a) => {
				const balance = accountBalances.get(a.id) ?? 0;
				const rate = a.currency === referenceCurrency ? 1 : (exchangeRates[a.currency] ?? 1);
				return {
					title: a.title,
					currency: a.currency,
					balance,
					exchangeRate: rate,
					balanceInRef: balance * rate,
					zakatable: zakatableIds.has(a.id),
				};
			}),
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
							{(accounts ?? []).map((account) => {
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
											{balance.toLocaleString("en-US", { maximumFractionDigits: 2 })}
										</span>
									</button>
								);
							})}
							{accounts?.length === 0 && (
								<p className="text-sm text-muted-foreground">No accounts found.</p>
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
					<ZakatMonthlyBalances
						userId={userId}
						zakatYear={currentIslamicYear}
						accounts={accounts ?? []}
						zakatableIds={zakatableIds}
						referenceCurrency={referenceCurrency}
						exchangeRates={exchangeRates}
					/>
				</TabsContent>

				{/* HISTORY TAB */}
				<TabsContent value="history" className="space-y-5">
					<ZakatHistory userId={userId} />
				</TabsContent>

				{/* PAYMENTS TAB */}
				<TabsContent value="payments" className="space-y-5">
					<ZakatPayments userId={userId} referenceCurrency={referenceCurrency} />
				</TabsContent>
			</Tabs>
		</div>
	);
}
