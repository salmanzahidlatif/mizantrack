"use client";

import { Check } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

import { CurrencyPicker } from "@/components/shared/CurrencyPicker";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useDbConfig } from "@/hooks/useDbConfig";
import { getCurrencyByCode } from "@/lib/currencies";
import { defaultDbConfig } from "@/lib/db/dbConfig";
import { db } from "@/lib/db/local";

interface PreferencesFormProps {
	userId: string;
}

export function PreferencesForm({ userId }: PreferencesFormProps) {
	const config = useDbConfig(userId);
	const { theme, setTheme } = useTheme();

	const [enabledCurrencies, setEnabledCurrencies] = useState<string[]>([]);
	const [pickerOpen, setPickerOpen] = useState(false);
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
				void db.dbConfig.put(defaultDbConfig(userId));
			}
			initialised.current = true;
		}
		// Always sync enabledCurrencies from config so it reflects the latest
		// value even after a Firebase sync that updates the currencies list.
		setEnabledCurrencies(config?.enabledCurrencies ?? [config?.currency ?? "PKR"]);
	}, [config, userId]);

	function scheduleSave(newCurrency: string, newEnabledCurrencies?: string[]) {
		if (saveTimer.current) clearTimeout(saveTimer.current);
		saveTimer.current = setTimeout(() => {
			const cur = newCurrency.toUpperCase() || "PKR";
			const enabled = newEnabledCurrencies ?? enabledCurrencies;
			void db.dbConfig
				.update(userId, {
					currency: cur,
					enabledCurrencies: enabled.length > 0 ? enabled : [cur],
				})
				.then((count) => {
					if (count === 0) {
						// A fresh row still needs a valid fiscal month; it is no longer
						// editable here, so it comes straight from the stored default.
						return db.dbConfig.put({
							...defaultDbConfig(userId),
							currency: cur,
							enabledCurrencies: enabled.length > 0 ? enabled : [cur],
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
		setEnabledCurrencies(codes);
		scheduleSave(primary, codes);
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
								<span
									key={code}
									className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium">
									{entry?.flag} {code}
								</span>
							);
						})}
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={() => setPickerOpen(true)}
						className="text-xs">
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
		</div>
	);
}
