"use client";

import { useHideAmounts } from "@/hooks/useHideAmounts";
import { getCurrencyDisplay, type CurrencySymbol } from "@/lib/currencySymbols";
import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

interface CurrencyAmountProps {
	amount: number;
	currency?: string;
	/** Used when currency is missing. Defaults to ISO 4217 "XXX" (unknown currency). */
	fallbackCurrency?: string;
	/** If true, positive is green, negative is red. Default: false (no color) */
	colorized?: boolean;
	/** If true, prepends '-' for negative values */
	showNegativeSign?: boolean;
	/** Force a specific color regardless of sign */
	variant?: "positive" | "negative" | "neutral" | "transfer";
	/**
	 * Hide the currency symbol. Use where the surrounding screen already states the
	 * currency, such as a transaction list that is scoped to one currency, so every row
	 * does not repeat it. The symbol stays available to screen readers.
	 */
	showCurrency?: boolean;
	className?: string;
}

const RTL_SYMBOL_PATTERN = /[\u0590-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

export const AMOUNT_MASK = "••••";

function maskAmount(code: string, symbol: CurrencySymbol): ReactNode {
	return (
		<>
			{renderCurrencySymbol(code, symbol)}{" "}
			<span aria-hidden="true" className="inline-block min-w-[4ch] text-center tracking-wide">
				{AMOUNT_MASK}
			</span>
			<span className="sr-only">Amount hidden</span>
		</>
	);
}

function formatAmount(
	amount: number,
	currency: string | undefined,
	fallbackCurrency: string,
	showNegativeSign: boolean,
	hideAmounts: boolean,
	showCurrency: boolean
): ReactNode {
	const { code, symbol } = getCurrencyDisplay(currency, fallbackCurrency);

	if (hideAmounts) {
		return maskAmount(code, symbol);
	}

	const abs = Math.abs(amount);
	const formatted = abs.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
	const prefix = showNegativeSign && amount < 0 ? "-" : "";

	if (!showCurrency) {
		// The screen already names the currency, so only the figure is rendered. The code
		// stays in the accessible name so the amount is never ambiguous when read aloud.
		return (
			<>
				<span className="sr-only">{code}</span>
				<span className="inline-block">{prefix + formatted}</span>
			</>
		);
	}

	if (typeof symbol === "string" && !RTL_SYMBOL_PATTERN.test(symbol)) {
		return `${symbol} ${prefix}${formatted}`;
	}

	return (
		<>
			{renderCurrencySymbol(code, symbol)}{" "}
			<span className="inline-block">{prefix + formatted}</span>
		</>
	);
}

function renderCurrencySymbol(code: string, symbol: CurrencySymbol) {
	if (code === "AED" && typeof symbol !== "string") {
		return (
			<>
				<span className="sr-only">UAE Dirham</span>
				<span aria-hidden="true" className="inline-block">
					{symbol}
				</span>
			</>
		);
	}

	return (
		<span className="inline-block" dir="ltr">
			{symbol}
		</span>
	);
}

export function CurrencyAmount({
	amount,
	currency,
	fallbackCurrency = "XXX",
	colorized = false,
	showNegativeSign = false,
	variant,
	showCurrency = true,
	className,
}: CurrencyAmountProps) {
	const hideAmounts = useHideAmounts();
	const resolvedVariant =
		variant ?? (colorized ? (amount >= 0 ? "positive" : "negative") : "neutral");

	return (
		<span
			data-currency-amount
			data-amount-hidden={hideAmounts ? "true" : undefined}
			aria-label={hideAmounts ? "Amount hidden" : undefined}
			dir="ltr"
			className={cn(
				"inline-block font-semibold tracking-tight tabular-nums transition-colors duration-200",
				resolvedVariant === "positive" && "text-emerald-600 dark:text-emerald-400",
				resolvedVariant === "negative" && "text-red-600 dark:text-red-400",
				resolvedVariant === "transfer" && "text-blue-600 dark:text-blue-400",
				"[unicode-bidi:isolate]",
				className
			)}>
			{formatAmount(
				amount,
				currency,
				fallbackCurrency,
				showNegativeSign,
				hideAmounts,
				showCurrency
			)}
		</span>
	);
}
