import { cn } from "@/lib/utils";

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

const CURRENCY_SYMBOLS: Record<string, string> = {
	AED: "د.إ",
	PKR: "₨",
	USD: "$",
	EUR: "€",
	GBP: "£",
	SAR: "﷼",
	INR: "₹",
};

function resolveCurrencyCode(currency: string | undefined, fallbackCurrency: string): string {
	const currencyCode = currency?.trim().toUpperCase() ?? "";
	if (currencyCode) return currencyCode;

	const fallbackCode = fallbackCurrency.trim().toUpperCase();
	return fallbackCode || "XXX";
}

function formatAmount(
	amount: number,
	currency: string | undefined,
	fallbackCurrency: string,
	showNegativeSign: boolean
): string {
	const currencyCode = resolveCurrencyCode(currency, fallbackCurrency);
	const symbol = CURRENCY_SYMBOLS[currencyCode] ?? currencyCode;
	const abs = Math.abs(amount);
	const formatted = abs.toLocaleString("en-US", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	});
	const prefix = showNegativeSign && amount < 0 ? "-" : "";
	return symbol ? `${symbol} ${prefix}${formatted}` : `${prefix}${formatted}`;
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
			className={cn(
				"font-semibold tracking-tight tabular-nums transition-colors duration-200",
				resolvedVariant === "positive" && "text-emerald-600 dark:text-emerald-400",
				resolvedVariant === "negative" && "text-red-600 dark:text-red-400",
				resolvedVariant === "transfer" && "text-blue-600 dark:text-blue-400",
				className
			)}>
			{formatAmount(amount, currency, fallbackCurrency, showNegativeSign)}
		</span>
	);
}
