"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getCurrencyByCode } from "@/lib/currencies";

interface CurrencySelectorProps {
	enabledCurrencies: string[];
	activeCurrency: string;
	onChange: (code: string) => void;
}

export function CurrencySelector({
	enabledCurrencies,
	activeCurrency,
	onChange,
}: CurrencySelectorProps) {
	const [open, setOpen] = useState(false);

	// Only render when 2+ currencies are enabled
	if (enabledCurrencies.length < 2) return null;

	const active = getCurrencyByCode(activeCurrency);

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<button className="flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted touch-manipulation">
					<span>{active?.flag ?? "🌐"}</span>
					<span>{activeCurrency || "—"}</span>
					<ChevronDown className="h-3 w-3 text-muted-foreground" />
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="min-w-[140px]">
				{enabledCurrencies.map((code) => {
					const entry = getCurrencyByCode(code);
					return (
						<DropdownMenuItem
							key={code}
							onClick={() => { onChange(code); setOpen(false); }}
							className={activeCurrency === code ? "bg-primary/10 font-medium" : ""}
						>
							<span className="mr-2">{entry?.flag ?? "🌐"}</span>
							{code}
							{activeCurrency === code && <span className="ml-auto text-primary">✓</span>}
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
