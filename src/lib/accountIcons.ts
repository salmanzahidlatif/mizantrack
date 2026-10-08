import type { Account } from "@/types";

export const DEFAULT_ACCOUNT_ICON = "💼";

interface AccountIconRule {
	icon: string;
	keywords: string[];
	currencies?: string[];
}

const BANK_BRAND_RULES: AccountIconRule[] = [
	{ icon: "💳", keywords: ["paypal", "pay pal"] },
	{ icon: "🌍", keywords: ["wise", "payoneer"] },
	{ icon: "🚕", keywords: ["careem pay", "careem"] },

	{ icon: "🕌", keywords: ["emirates islamic", "eib"], currencies: ["AED"] },
	{ icon: "🕌", keywords: ["abu dhabi islamic", "adib"], currencies: ["AED"] },
	{ icon: "🏦", keywords: ["emirates nbd", "enbd"], currencies: ["AED"] },
	{ icon: "🏦", keywords: ["first abu dhabi", "fab"], currencies: ["AED"] },
	{ icon: "🌅", keywords: ["mashreq"], currencies: ["AED"] },
	{ icon: "🏦", keywords: ["rakbank", "rak bank", "rak"], currencies: ["AED"] },
	{ icon: "🏦", keywords: ["commercial bank of dubai", "cbd"], currencies: ["AED"] },
	{ icon: "💳", keywords: ["deem"], currencies: ["AED"] },

	{ icon: "🕌", keywords: ["meezan", "al meezan"], currencies: ["PKR"] },
	{ icon: "🏦", keywords: ["mcb", "hbl", "alfalah"], currencies: ["PKR"] },
	{ icon: "🏦", keywords: ["standard chartered", "scb", "sc credit"], currencies: ["PKR"] },
	{ icon: "📱", keywords: ["easypaisa", "easy paisa"], currencies: ["PKR"] },
	{ icon: "💳", keywords: ["sadapay", "sada pay", "nayapay", "naya pay"], currencies: ["PKR"] },
];

const ACCOUNT_TYPE_RULES: AccountIconRule[] = [
	{ icon: "💵", keywords: ["cash"] },
	{ icon: "🐷", keywords: ["savings", "saving"] },
	{ icon: "👤", keywords: ["person"] },
	{ icon: "🏦", keywords: ["bank", "other bank"] },
	{ icon: "💳", keywords: ["credit card", "card"] },
];

const TITLE_ICON_RULES: AccountIconRule[] = [
	{ icon: "₿", keywords: ["crypto", "bitcoin"] },
	{
		icon: "📈",
		keywords: [
			"investment",
			"invest",
			"portfolio",
			"fund",
			"maicf",
			"stake",
			"asset",
			"assets",
			"share app",
			"share points",
		],
	},
	{ icon: "🐷", keywords: ["piggy", "savings", "saving", "deposit"] },
	{ icon: "💵", keywords: ["cash", "allowance", "salary"] },
	{ icon: "💱", keywords: ["pkr", "aed", "usd", "dirham", "dubai", "uae"] },
	{ icon: "💳", keywords: ["credit", "card", "rta", "amazon", "noon"] },
	{ icon: "🏠", keywords: ["property", "home", "house", "real estate"] },
	{ icon: "🤝", keywords: ["loan", "loans"] },
	{ icon: "🧾", keywords: ["claims", "claim", "reimbursement"] },
	{ icon: "🏥", keywords: ["medical", "health"] },
	{ icon: "☀️", keywords: ["solar"] },
	{ icon: "🚌", keywords: ["daewoo"] },
	{ icon: "🛒", keywords: ["alidropship", "dropship", "shop"] },
	{ icon: "💻", keywords: ["arysync", "sync", "freelance"] },
	{ icon: "👥", keywords: ["comety", "committee"] },
	{ icon: "🎁", keywords: ["kids", "eidi"] },
	{
		icon: "👤",
		keywords: [
			"abu jee",
			"ali bhai",
			"amna",
			"basit bhai",
			"daim",
			"dayyan",
			"huma",
			"me",
			"mohammad daim",
			"my assets",
			"nomi bhai",
			"papa",
			"rizwan",
			"shoaib",
			"siraj",
			"sulaiman",
			"umer",
			"ammi",
		],
	},
	{
		icon: "📦",
		keywords: ["belongings", "iphone", "misc", "other", "rehabilitation funds", "security"],
	},
	{ icon: "🏦", keywords: ["bank"] },
];

function normalizeText(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/~/g, " ")
		.toLowerCase();
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesKeyword(value: string, keyword: string): boolean {
	const escaped = escapeRegExp(keyword).replace(/\s+/g, "\\s+");
	return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(value);
}

function currencyAllows(rule: AccountIconRule, currency: string | undefined): boolean {
	if (!rule.currencies) return true;
	if (!currency) return true;
	return rule.currencies.includes(currency.trim().toUpperCase());
}

function iconFromRules(
	value: string,
	rules: AccountIconRule[],
	currency?: string
): string | undefined {
	const normalized = normalizeText(value);
	for (const rule of rules) {
		if (!currencyAllows(rule, currency)) continue;
		if (rule.keywords.some((keyword) => matchesKeyword(normalized, keyword))) {
			return rule.icon;
		}
	}
	return undefined;
}

export function resolveAccountIcon(
	title: string,
	options: {
		explicitIcon?: string;
		accountType?: string;
		bankName?: string;
		currency?: string;
	} = {}
): string {
	const icon = options.explicitIcon?.trim();
	if (icon) return icon;

	const brandSource = [options.bankName, title].filter(Boolean).join(" ");
	const brandIcon = iconFromRules(brandSource, BANK_BRAND_RULES, options.currency);
	if (brandIcon) return brandIcon;

	const typeSource = [options.accountType, options.bankName].filter(Boolean).join(" ");
	const typeIcon = iconFromRules(typeSource, ACCOUNT_TYPE_RULES, options.currency);
	if (typeIcon) return typeIcon;

	return iconFromRules(title, TITLE_ICON_RULES, options.currency) ?? DEFAULT_ACCOUNT_ICON;
}

export function getAccountIcon(account: Pick<Account, "title" | "icon" | "currency">): string {
	return resolveAccountIcon(account.title, {
		explicitIcon: account.icon,
		currency: account.currency,
	});
}
