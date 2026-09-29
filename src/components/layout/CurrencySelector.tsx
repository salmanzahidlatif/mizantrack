"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHaptics } from "@/hooks/useHaptics";
import { getCurrencyByCode } from "@/lib/currencies";
import { cn } from "@/lib/utils";

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
	const haptics = useHaptics();

	// Only render when 2+ currencies are enabled
	if (enabledCurrencies.length < 2) return null;

	const active = getCurrencyByCode(activeCurrency);

	return (
		<DropdownMenu open={open} onOpenChange={setOpen}>
			<DropdownMenuTrigger asChild>
				<button className="press-scale tappable material-blur flex h-10 items-center gap-1.5 rounded-full border border-border/60 px-3 text-xs font-semibold shadow-sm transition-[border-color,background-color,color] duration-[var(--dur-base)] ease-[var(--ease-ios)] hover:border-primary/30 hover:bg-accent/70 motion-reduce:transition-none">
					<span className="text-base leading-none">{active?.flag ?? "🌐"}</span>
					<span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
						{activeCurrency || "—"}
					</span>
					<ChevronDown
						className={cn(
							"h-3.5 w-3.5 text-muted-foreground transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] motion-reduce:transition-none",
							open ? "rotate-180" : "rotate-0"
						)}
					/>
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				className="material-thick fade-scale-in min-w-[160px] rounded-2xl border-border/60 p-1 shadow-[var(--shadow-sheet)]">
				{enabledCurrencies.map((code) => {
					const entry = getCurrencyByCode(code);
					const activeItem = activeCurrency === code;
					return (
						<DropdownMenuItem
							key={code}
							onClick={() => {
								if (!activeItem) haptics.selection();
								onChange(code);
								setOpen(false);
							}}
							className={cn(
								"tappable my-0.5 min-h-10 cursor-pointer rounded-xl px-2.5 text-sm transition-colors duration-[var(--dur-fast)] ease-[var(--ease-ios)] motion-reduce:transition-none",
								activeItem ? "bg-primary/10 font-semibold text-primary" : ""
							)}>
							<span className="mr-2">{entry?.flag ?? "🌐"}</span>
							{code}
							{activeItem && <span className="ml-auto text-primary">✓</span>}
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
