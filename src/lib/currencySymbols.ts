import { createElement, type ReactElement } from "react";

import { DirhamSign } from "@/components/shared/DirhamSign";

export type CurrencySymbol = string | ReactElement;

export interface CurrencyDisplay {
	code: string;
	symbol: CurrencySymbol;
	hasSymbol: boolean;
}

export const CURRENCY_SYMBOLS: Record<string, CurrencySymbol> = {
	AED: createElement(DirhamSign),
	PKR: "₨",
	USD: "$",
	EUR: "€",
	GBP: "£",
	SAR: "﷼",
	INR: "₹",
};

export function resolveCurrencyCode(
	currency: string | undefined,
	fallbackCurrency = "XXX"
): string {
	const currencyCode = currency?.trim().toUpperCase() ?? "";
	if (currencyCode) return currencyCode;

	const fallbackCode = fallbackCurrency.trim().toUpperCase();
	return fallbackCode || "XXX";
}

export function getCurrencyDisplay(
	currency: string | undefined,
	fallbackCurrency = "XXX"
): CurrencyDisplay {
	const code = resolveCurrencyCode(currency, fallbackCurrency);
	const hasSymbol = Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOLS, code);

	return {
		code,
		symbol: hasSymbol ? CURRENCY_SYMBOLS[code]! : code,
		hasSymbol,
	};
}

export function getCurrencySymbol(
	currency: string | undefined,
	fallbackCurrency = "XXX"
): CurrencySymbol {
	return getCurrencyDisplay(currency, fallbackCurrency).symbol;
}
