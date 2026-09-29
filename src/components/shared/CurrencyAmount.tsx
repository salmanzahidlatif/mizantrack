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
	className?: string;
}

const RTL_SYMBOL_PATTERN = /[\u0590-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;

function formatAmount(
	amount: number,
	currency: string | undefined,
	fallbackCurrency: string,
	showNegativeSign: boolean
): ReactNode {
	const { code, symbol } = getCurrencyDisplay(currency, fallbackCurrency);
	const abs = Math.abs(amount);
	const formatted = abs.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
	const prefix = showNegativeSign && amount < 0 ? "-" : "";

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
	className,
}: CurrencyAmountProps) {
	const resolvedVariant =
		variant ?? (colorized ? (amount >= 0 ? "positive" : "negative") : "neutral");

	return (
		<span
			data-currency-amount
			dir="ltr"
			className={cn(
				"inline-block font-semibold tracking-tight tabular-nums transition-colors duration-200",
				resolvedVariant === "positive" && "text-emerald-600 dark:text-emerald-400",
				resolvedVariant === "negative" && "text-red-600 dark:text-red-400",
				resolvedVariant === "transfer" && "text-blue-600 dark:text-blue-400",
				"[unicode-bidi:isolate]",
				className
			)}>
			{formatAmount(amount, currency, fallbackCurrency, showNegativeSign)}
		</span>
	);
}
