"use client";

import { Check, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { CURRENCIES, searchCurrencies } from "@/lib/currencies";

interface CurrencyPickerProps {
	/** Currently selected ISO codes */
	selected: string[];
	/** Called when the selection changes */
	onChange: (codes: string[]) => void;
	/** If true, only one currency may be selected at a time (import wizard) */
	singleSelect?: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function CurrencyPicker({
	selected,
	onChange,
	singleSelect = false,
	open,
	onOpenChange,
}: CurrencyPickerProps) {
	const [query, setQuery] = useState("");
	const [localSelected, setLocalSelected] = useState<string[]>(selected);
	const [error, setError] = useState<string | null>(null);

	const filtered = useMemo(() => searchCurrencies(query), [query]);

	// Selected items float to top
	const sorted = useMemo(() => {
		const sel = new Set(localSelected);
		return [
			...filtered.filter((c) => sel.has(c.code)),
			...filtered.filter((c) => !sel.has(c.code)),
		];
	}, [filtered, localSelected]);

	const toggle = (code: string) => {
		setError(null);
		if (singleSelect) {
			setLocalSelected([code]);
			return;
		}
		setLocalSelected((prev) =>
			prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
		);
	};

	const handleSave = () => {
		if (localSelected.length === 0) {
			setError("Select at least one currency.");
			return;
		}
		onChange(localSelected);
		onOpenChange(false);
	};

	const handleOpen = (v: boolean) => {
		if (v) setLocalSelected(selected);
		onOpenChange(v);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpen}>
			<DialogContent className="flex max-h-[85vh] max-w-md flex-col gap-0 p-0">
				<DialogHeader className="px-4 pt-4">
					<DialogTitle>{singleSelect ? "Select Currency" : "Select Currencies"}</DialogTitle>
					<DialogDescription>
						{singleSelect
							? "Choose the currency for this import."
							: "Select one or more currencies to track."}
					</DialogDescription>
				</DialogHeader>

				{/* Search */}
				<div className="relative px-4 py-2">
					<Search className="absolute left-7 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
					<Input
						placeholder="Search by country or currency code…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						className="pl-9"
						autoFocus
					/>
				</div>

				{/* List */}
				<div className="flex-1 overflow-y-auto px-2 pb-2">
					{sorted.map((entry) => {
						const isSelected = localSelected.includes(entry.code);
						return (
							<button
								key={entry.code}
								onClick={() => toggle(entry.code)}
								className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 mb-0.5 text-left transition-colors touch-manipulation ${
									isSelected ? "bg-primary/10" : "hover:bg-muted/50"
								}`}
							>
								<span className="text-xl leading-none">{entry.flag}</span>
								<span className="flex-1 text-sm">
									<span className="font-medium">{entry.country}</span>{" "}
									<span className="text-muted-foreground">({entry.code})</span>
								</span>
								{isSelected && <Check className="h-4 w-4 text-primary" />}
							</button>
						);
					})}
					{sorted.length === 0 && (
						<p className="py-4 text-center text-sm text-muted-foreground">No currencies found.</p>
					)}
				</div>

				{/* Footer */}
				<div className="border-t border-border px-4 py-3">
					{error && <p className="mb-2 text-xs text-destructive">{error}</p>}
					<div className="flex justify-between">
						<span className="text-xs text-muted-foreground">
							{localSelected.length} selected
						</span>
						<div className="flex gap-2">
							<Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button size="sm" onClick={handleSave}>
								{singleSelect ? "Select" : "Save"}
							</Button>
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
