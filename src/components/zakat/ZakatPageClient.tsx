"use client";

import { endOfDay, format } from "date-fns";
import { useLiveQuery } from "dexie-react-hooks";
import { CalendarIcon, Check, Download, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
import { useAccounts } from "@/hooks/useAccounts";
import { useDbConfig } from "@/hooks/useDbConfig";
import { db } from "@/lib/db/local";
import { fetchGoldPrice } from "@/lib/goldPrice";
import { exportZakatSummary } from "@/lib/zakatExport";

const TOLA_TO_GRAMS = 11.664;
const NISAB_GOLD_GRAMS = 85;
const NISAB_SILVER_GRAMS = 595;

interface ZakatPageClientProps {
	userId: string;
}

export function ZakatPageClient({ userId }: ZakatPageClientProps) {
	const config = useDbConfig(userId);
	const referenceCurrency = config?.currency ?? "AED";
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

	// ── Form state ──────────────────────────────────────────────────────────
	const [assessmentDate, setAssessmentDate] = useState<Date>(new Date());
	const [calOpen, setCalOpen] = useState(false);
	const [zakatableIds, setZakatableIds] = useState<Set<string>>(new Set());
	const [goldGrams, setGoldGrams] = useState(0);
	const [useTola, setUseTola] = useState(false);
	const [goldPrice, setGoldPrice] = useState(0);
	const [goldPriceLoading, setGoldPriceLoading] = useState(false);
	const [goldPriceManual, setGoldPriceManual] = useState(false);
	const [nisab, setNisab] = useState<"gold" | "silver">("gold");
	const [silverPrice, setSilverPrice] = useState(0);
	const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({});

	// Auto-fetch gold price on mount
	useEffect(() => {
		setGoldPriceLoading(true);
		void fetchGoldPrice(userId).then((price) => {
			if (price && !goldPriceManual) setGoldPrice(price);
			setGoldPriceLoading(false);
		});
	}, [userId]); // intentional: only run on mount/userId change

	// Pre-select all accounts as zakatable on first load
	useEffect(() => {
		if (accounts && zakatableIds.size === 0) {
			setZakatableIds(new Set(accounts.map((a) => a.id)));
		}
	}, [accounts]); // intentional: only re-run when accounts list changes

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
	const goldWeightGrams = useTola ? goldGrams * TOLA_TO_GRAMS : goldGrams;
	const goldValue = goldWeightGrams * goldPrice;

	const totalZakatable = useMemo(() => {
		if (!accounts) return 0;
		let total = goldValue;
		for (const account of accounts) {
			if (!zakatableIds.has(account.id)) continue;
			const balance = accountBalances.get(account.id) ?? 0;
			if (balance <= 0) continue;
			if (account.currency === referenceCurrency) {
				total += balance;
			} else {
				const rate = exchangeRates[account.currency] ?? 1;
				total += balance * rate;
			}
		}
		return total;
	}, [accounts, zakatableIds, accountBalances, goldValue, referenceCurrency, exchangeRates]);

	const nisabThreshold =
		nisab === "gold" ? NISAB_GOLD_GRAMS * goldPrice : NISAB_SILVER_GRAMS * silverPrice;
	const zakatObligation = totalZakatable >= nisabThreshold ? totalZakatable * 0.025 : 0;
	const isLiable = totalZakatable >= nisabThreshold && nisabThreshold > 0;

	// ── Export ──────────────────────────────────────────────────────────────
	function handleExport() {
		if (!accounts) return;
		exportZakatSummary({
			assessmentDate,
			nisabStandard: nisab,
			goldPricePerGram: goldPrice,
			silverPricePerGram: silverPrice,
			goldWeightGrams,
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
					<h1 className="text-2xl font-bold">Zakat Calculator</h1>
					<p className="text-sm text-muted-foreground">Calculate your annual Zakat obligation</p>
				</div>
				<Button size="sm" variant="outline" onClick={handleExport}>
					<Download className="mr-1.5 h-3.5 w-3.5" />
					Export Summary
				</Button>
			</div>

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

			{/* Account selection */}
			<div className="space-y-2">
				<Label>Zakatable Accounts</Label>
				<div className="space-y-2">
					{(accounts ?? []).map((account) => {
						const selected = zakatableIds.has(account.id);
						const balance = accountBalances.get(account.id) ?? 0;
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
								</div>
								<span className="text-sm font-medium tabular-nums">
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

			{/* Exchange rates for foreign currencies */}
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

			{/* Gold weight */}
			<div className="space-y-2">
				<div className="flex items-center justify-between">
					<Label>Gold Weight</Label>
					<div className="flex gap-1">
						{(["grams", "tola"] as const).map((unit) => (
							<button
								key={unit}
								type="button"
								onClick={() => setUseTola(unit === "tola")}
								className={`rounded px-2.5 py-1 text-xs capitalize transition-colors ${
									(unit === "tola") === useTola
										? "bg-primary text-primary-foreground"
										: "bg-muted text-muted-foreground hover:bg-accent"
								}`}>
								{unit}
							</button>
						))}
					</div>
				</div>
				<div className="flex items-center gap-2">
					<Input
						type="number"
						min={0}
						step="any"
						value={goldGrams || ""}
						onChange={(e) => setGoldGrams(parseFloat(e.target.value) || 0)}
						placeholder="0"
						className="max-w-35"
					/>
					<span className="text-sm text-muted-foreground">
						{useTola ? "tola" : "grams"}
						{useTola && ` (= ${(goldGrams * TOLA_TO_GRAMS).toFixed(2)}g)`}
					</span>
				</div>
			</div>

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
				{!goldPriceManual && !config?.goldApiKey && (
					<p className="text-xs text-muted-foreground">
						Add your goldapi.io key in Settings to auto-fetch. Enter manually for now.
					</p>
				)}
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
							label: "Total Zakatable Wealth",
							value: `${totalZakatable.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${referenceCurrency}`,
						},
						{
							label: `Nisab Threshold (${nisab === "gold" ? "85g gold" : "595g silver"})`,
							value:
								nisabThreshold > 0
									? `${nisabThreshold.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${referenceCurrency}`
									: "—",
						},
					].map(({ label, value }) => (
						<div key={label} className="flex justify-between">
							<span className="text-muted-foreground">{label}</span>
							<span className="font-medium tabular-nums">{value}</span>
						</div>
					))}
				</div>

				<div className="mt-4 rounded-lg bg-background p-3 text-center">
					{nisabThreshold === 0 ? (
						<p className="text-sm text-muted-foreground">Enter gold price and nisab to calculate</p>
					) : isLiable ? (
						<>
							<p className="text-xs text-muted-foreground">Zakat Obligation (2.5%)</p>
							<p className="mt-1 text-2xl font-bold text-primary">
								{zakatObligation.toLocaleString("en-US", {
									minimumFractionDigits: 2,
									maximumFractionDigits: 2,
								})}{" "}
								{referenceCurrency}
							</p>
						</>
					) : (
						<>
							<p className="text-lg font-semibold text-muted-foreground">Not yet liable</p>
							<p className="text-xs text-muted-foreground">Wealth is below nisab threshold</p>
						</>
					)}
				</div>
			</div>
		</div>
	);
}
