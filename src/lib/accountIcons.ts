import type { Account } from "@/types";

/**
 * Stable icon keys. Inference resolves to these and the picker writes them into
 * `Account.icon`; the drawn artwork lives in the React registry at
 * `@/components/icons/accountIconRegistry`. Keys — never emoji — so that every
 * brand can own a visually distinct mark.
 */
export const ACCOUNT_ICON_KEYS = [
	"bank.adib",
	"bank.alfalah",
	"bank.cbd",
	"bank.deem",
	"bank.eib",
	"bank.enbd",
	"bank.fab",
	"bank.hbl",
	"bank.mashreq",
	"bank.mcb",
	"bank.meezan",
	"bank.rakbank",
	"bank.scb",

	"wallet.careem",
	"wallet.easypaisa",
	"wallet.nayapay",
	"wallet.payoneer",
	"wallet.paypal",
	"wallet.sadapay",
	"wallet.wise",

	"generic.bank",
	"generic.card",
	"generic.cash",
	"generic.claims",
	"generic.committee",
	"generic.crypto",
	"generic.exchange",
	"generic.freelance",
	"generic.gift",
	"generic.investment",
	"generic.loan",
	"generic.medical",
	"generic.misc",
	"generic.person",
	"generic.property",
	"generic.savings",
	"generic.shop",
	"generic.solar",
	"generic.transit",
	"generic.wallet",
] as const;

export type AccountIconKey = (typeof ACCOUNT_ICON_KEYS)[number];

export const DEFAULT_ACCOUNT_ICON: AccountIconKey = "generic.wallet";

const ACCOUNT_ICON_KEY_SET: ReadonlySet<string> = new Set(ACCOUNT_ICON_KEYS);

/** True when a stored `Account.icon` is one of our keys rather than a legacy emoji. */
export function isAccountIconKey(value: string | undefined): value is AccountIconKey {
	return typeof value === "string" && ACCOUNT_ICON_KEY_SET.has(value);
}

interface AccountIconRule {
	icon: AccountIconKey;
	keywords: string[];
	currencies?: string[];
}

const BANK_BRAND_RULES: AccountIconRule[] = [
	{ icon: "wallet.paypal", keywords: ["paypal", "pay pal"] },
	{ icon: "wallet.wise", keywords: ["wise"] },
	{ icon: "wallet.payoneer", keywords: ["payoneer"] },
	{ icon: "wallet.careem", keywords: ["careem pay", "careem"] },

	{ icon: "bank.eib", keywords: ["emirates islamic", "eib"], currencies: ["AED"] },
	{ icon: "bank.adib", keywords: ["abu dhabi islamic", "adib"], currencies: ["AED"] },
	{ icon: "bank.enbd", keywords: ["emirates nbd", "enbd"], currencies: ["AED"] },
	{ icon: "bank.fab", keywords: ["first abu dhabi", "fab"], currencies: ["AED"] },
	{ icon: "bank.mashreq", keywords: ["mashreq"], currencies: ["AED"] },
	{ icon: "bank.rakbank", keywords: ["rakbank", "rak bank", "rak"], currencies: ["AED"] },
	{ icon: "bank.cbd", keywords: ["commercial bank of dubai", "cbd"], currencies: ["AED"] },
	{ icon: "bank.deem", keywords: ["deem"], currencies: ["AED"] },

	{ icon: "bank.meezan", keywords: ["meezan", "al meezan"], currencies: ["PKR"] },
	{ icon: "bank.mcb", keywords: ["mcb"], currencies: ["PKR"] },
	{ icon: "bank.hbl", keywords: ["hbl"], currencies: ["PKR"] },
	{ icon: "bank.alfalah", keywords: ["alfalah"], currencies: ["PKR"] },
	{ icon: "bank.scb", keywords: ["standard chartered", "scb", "sc credit"], currencies: ["PKR"] },
	{ icon: "wallet.easypaisa", keywords: ["easypaisa", "easy paisa"], currencies: ["PKR"] },
	{ icon: "wallet.sadapay", keywords: ["sadapay", "sada pay"], currencies: ["PKR"] },
	{ icon: "wallet.nayapay", keywords: ["nayapay", "naya pay"], currencies: ["PKR"] },
];

const ACCOUNT_TYPE_RULES: AccountIconRule[] = [
	{ icon: "generic.cash", keywords: ["cash"] },
	{ icon: "generic.savings", keywords: ["savings", "saving"] },
	{ icon: "generic.person", keywords: ["person"] },
	{ icon: "generic.bank", keywords: ["bank", "other bank"] },
	{ icon: "generic.card", keywords: ["credit card", "card"] },
];

const TITLE_ICON_RULES: AccountIconRule[] = [
	{ icon: "generic.crypto", keywords: ["crypto", "bitcoin"] },
	{
		icon: "generic.investment",
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
	{ icon: "generic.savings", keywords: ["piggy", "savings", "saving", "deposit"] },
	{ icon: "generic.cash", keywords: ["cash", "allowance", "salary"] },
	{ icon: "generic.exchange", keywords: ["pkr", "aed", "usd", "dirham", "dubai", "uae"] },
	{ icon: "generic.card", keywords: ["credit", "card", "rta", "amazon", "noon"] },
	{ icon: "generic.property", keywords: ["property", "home", "house", "real estate"] },
	{ icon: "generic.loan", keywords: ["loan", "loans"] },
	{ icon: "generic.claims", keywords: ["claims", "claim", "reimbursement"] },
	{ icon: "generic.medical", keywords: ["medical", "health"] },
	{ icon: "generic.solar", keywords: ["solar"] },
	{ icon: "generic.transit", keywords: ["daewoo"] },
	{ icon: "generic.shop", keywords: ["alidropship", "dropship", "shop"] },
	{ icon: "generic.freelance", keywords: ["arysync", "sync", "freelance"] },
	{ icon: "generic.committee", keywords: ["comety", "committee"] },
	{ icon: "generic.gift", keywords: ["kids", "eidi"] },
	{
		icon: "generic.person",
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
		icon: "generic.misc",
		keywords: ["belongings", "iphone", "misc", "other", "rehabilitation funds", "security"],
	},
	{ icon: "generic.bank", keywords: ["bank"] },
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
): AccountIconKey | undefined {
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
