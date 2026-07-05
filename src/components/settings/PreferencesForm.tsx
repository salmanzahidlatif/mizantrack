"use client";

import { Check } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

import { CurrencyPicker } from "@/components/shared/CurrencyPicker";
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
import { useDbConfig } from "@/hooks/useDbConfig";
import { getCurrencyByCode } from "@/lib/currencies";
import { db } from "@/lib/db/local";

const MONTHS = [
	{ value: 1, label: "January" },
	{ value: 2, label: "February" },
	{ value: 3, label: "March" },
	{ value: 4, label: "April" },
	{ value: 5, label: "May" },
	{ value: 6, label: "June" },
	{ value: 7, label: "July" },
	{ value: 8, label: "August" },
	{ value: 9, label: "September" },
	{ value: 10, label: "October" },
	{ value: 11, label: "November" },
	{ value: 12, label: "December" },
];

interface PreferencesFormProps {
	userId: string;
}

export function PreferencesForm({ userId }: PreferencesFormProps) {
	const config = useDbConfig(userId);
	const { theme, setTheme } = useTheme();

	const [currency, setCurrency] = useState("");
	const [enabledCurrencies, setEnabledCurrencies] = useState<string[]>([]);
	const [pickerOpen, setPickerOpen] = useState(false);
	const [fiscalMonth, setFiscalMonth] = useState(7);
	const [goldApiKey, setGoldApiKey] = useState("");
	const [saved, setSaved] = useState(false);
	const [mounted, setMounted] = useState(false);
	const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const initialised = useRef(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	// Seed defaults on first load and sync local state from DB
	useEffect(() => {
		if (config === undefined) return; // still loading

		if (config === null || !initialised.current) {
			// First time: create config if missing
			if (!config) {
				void db.dbConfig.put({
					id: userId,
					currency: "PKR",
					fiscalYearStartMonth: 7,
					firebaseConfig: "",
					enabled: false,
				});
			}
			setCurrency(config?.currency ?? "PKR");
			setFiscalMonth(config?.fiscalYearStartMonth ?? 7);
			setGoldApiKey(config?.goldApiKey ?? "");
			initialised.current = true;
		}
		// Always sync enabledCurrencies from config so it reflects the latest
		// value even after a Firebase sync that updates the currencies list.
		setEnabledCurrencies(config?.enabledCurrencies ?? [config?.currency ?? "PKR"]);
	}, [config, userId]);

	function scheduleSave(newCurrency: string, newMonth: number, newGoldKey: string, newEnabledCurrencies?: string[]) {
		if (saveTimer.current) clearTimeout(saveTimer.current);
		saveTimer.current = setTimeout(() => {
			const cur = newCurrency.toUpperCase() || "PKR";
			const enabled = newEnabledCurrencies ?? enabledCurrencies;
			void db.dbConfig
				.update(userId, {
					currency: cur,
					enabledCurrencies: enabled.length > 0 ? enabled : [cur],
					fiscalYearStartMonth: newMonth,
					goldApiKey: newGoldKey || undefined,
				})
				.then((count) => {
					if (count === 0) {
						return db.dbConfig.put({
							id: userId,
							currency: cur,
							enabledCurrencies: enabled.length > 0 ? enabled : [cur],
							fiscalYearStartMonth: newMonth,
							firebaseConfig: "",
							enabled: false,
							...(newGoldKey ? { goldApiKey: newGoldKey } : {}),
						});
					}
					return undefined;
				})
				.then(() => {
					setSaved(true);
					setTimeout(() => setSaved(false), 2000);
				});
		}, 500);
	}

	function handleCurrencyChange(codes: string[]) {
		const primary = codes[0] ?? "PKR";
		setCurrency(primary);
		setEnabledCurrencies(codes);
		scheduleSave(primary, fiscalMonth, goldApiKey, codes);
	}

	function handleMonthChange(value: string) {
		const month = parseInt(value, 10);
		setFiscalMonth(month);
		scheduleSave(currency, month, goldApiKey);
	}

	function handleGoldKeyChange(value: string) {
		setGoldApiKey(value);
		scheduleSave(currency, fiscalMonth, value);
	}

	return (
		<div className="space-y-4 rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
			<div className="flex items-center justify-between">
				<h2 className="font-semibold">Preferences</h2>
				{saved && (
					<span className="flex items-center gap-1 text-xs text-emerald-500">
						<Check className="h-3 w-3" /> Saved
					</span>
				)}
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				{/* Currencies */}
				<div className="space-y-1.5">
					<Label>Currencies</Label>
					<div className="flex flex-wrap gap-1.5">
						{enabledCurrencies.map((code) => {
							const entry = getCurrencyByCode(code);
							return (
								<span key={code} className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
									{entry?.flag} {code}
								</span>
							);
						})}
					</div>
					<Button variant="outline" size="sm" onClick={() => setPickerOpen(true)} className="text-xs">
						Manage Currencies
					</Button>
					<p className="text-xs text-muted-foreground">Primary currency used throughout the app.</p>
					<CurrencyPicker
						selected={enabledCurrencies}
						onChange={handleCurrencyChange}
						open={pickerOpen}
						onOpenChange={setPickerOpen}
					/>
				</div>

				{/* Fiscal year start month */}
				<div className="space-y-1.5">
					<Label>Fiscal Year Start Month</Label>
					<Select value={String(fiscalMonth)} onValueChange={handleMonthChange}>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{MONTHS.map((m) => (
								<SelectItem key={m.value} value={String(m.value)}>
									{m.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			{/* Gold price API key */}
			<div className="space-y-1.5">
				<Label htmlFor="gold-api-key">Gold Price API Key (goldapi.io)</Label>
				<Input
					id="gold-api-key"
					type="password"
					value={goldApiKey}
					onChange={(e) => handleGoldKeyChange(e.target.value)}
					placeholder="Your goldapi.io API key"
				/>
				<p className="text-xs text-muted-foreground">
					Used by the Zakat calculator to fetch live gold prices. Leave blank to enter manually.
				</p>
			</div>

			{/* Theme */}
			<div className="space-y-1.5">
				<Label>Theme</Label>
				<div className="flex gap-2">
					{(["light", "dark", "system"] as const).map((t) => (
						<button
							key={t}
							type="button"
							onClick={() => setTheme(t)}
							className={`rounded-lg border px-3 py-1.5 text-sm capitalize transition-colors ${
								mounted && theme === t
									? "border-primary bg-primary text-primary-foreground"
									: "border-border hover:bg-accent"
							}`}>
							{t}
						</button>
					))}
				</div>
			</div>
		</div>
	);
}
