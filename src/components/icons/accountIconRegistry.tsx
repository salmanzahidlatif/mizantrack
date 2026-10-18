"use client";

import {
	ArrowRightLeft,
	Banknote,
	Bitcoin,
	Bus,
	CreditCard,
	Gift,
	Handshake,
	HeartPulse,
	House,
	Landmark,
	Laptop,
	Package,
	PiggyBank,
	ReceiptText,
	ShoppingCart,
	Sun,
	TrendingUp,
	User,
	Users,
	Wallet,
} from "lucide-react";

import { ACCOUNT_ICON_KEYS, type AccountIconKey } from "@/lib/accountIcons";

import type { ComponentType } from "react";

export type AccountIconGroup = "bank" | "wallet" | "generic";

export interface AccountIconDefinition {
	/** Human label shown in the picker and used for search. */
	label: string;
	group: AccountIconGroup;
	/** Brand colour for lettermarks; generic glyphs inherit `currentColor`. */
	color: string;
	Icon: ComponentType<{ className?: string }>;
	/** Extra search terms so "standard chartered" finds the SCB tile. */
	keywords?: string[];
}

interface BrandMarkOptions {
	accent?: string;
	foreground?: string;
}

// Letters shrink as the monogram grows so four characters still fit the tile.
const BRAND_FONT_SIZES: Record<number, number> = { 1: 16, 2: 13, 3: 10.5, 4: 8 };

/**
 * Original lettermark: a rounded brand-coloured tile, the brand initials and an
 * inset accent bar. Deliberately not a reproduction of any bank's logo.
 */
function brandMark(label: string, background: string, options: BrandMarkOptions = {}) {
	const foreground = options.foreground ?? "#ffffff";
	const fontSize = BRAND_FONT_SIZES[label.length] ?? 8;

	function BrandIcon({ className }: { className?: string }) {
		return (
			<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
				<rect width="32" height="32" rx="9" fill={background} />
				{options.accent ? (
					<rect x="7" y="24.5" width="18" height="3" rx="1.5" fill={options.accent} />
				) : null}
				<text
					x="16"
					y="14.5"
					textAnchor="middle"
					dominantBaseline="central"
					fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
					fontSize={fontSize}
					fontWeight="700"
					letterSpacing="0.3"
					fill={foreground}>
					{label}
				</text>
			</svg>
		);
	}

	BrandIcon.displayName = `BrandIcon(${label})`;
	return BrandIcon;
}

export const ACCOUNT_ICON_REGISTRY: Record<AccountIconKey, AccountIconDefinition> = {
	"bank.adib": {
		label: "Abu Dhabi Islamic Bank",
		group: "bank",
		color: "#1b3a6b",
		keywords: ["adib", "uae", "islamic"],
		Icon: brandMark("ADIB", "#1b3a6b", { accent: "#c8a24a" }),
	},
	"bank.alfalah": {
		label: "Bank Alfalah",
		group: "bank",
		color: "#c8102e",
		keywords: ["alfalah", "baf", "pakistan"],
		Icon: brandMark("BAF", "#c8102e", { accent: "#f2c300" }),
	},
	"bank.cbd": {
		label: "Commercial Bank of Dubai",
		group: "bank",
		color: "#2d6ca2",
		keywords: ["cbd", "uae"],
		Icon: brandMark("CBD", "#2d6ca2", { accent: "#d81e05" }),
	},
	"bank.deem": {
		label: "Deem Finance",
		group: "bank",
		color: "#7b2d8e",
		keywords: ["deem", "uae", "finance"],
		Icon: brandMark("DEEM", "#7b2d8e", { accent: "#f15a29" }),
	},
	"bank.eib": {
		label: "Emirates Islamic",
		group: "bank",
		color: "#0f7b4f",
		keywords: ["eib", "uae", "islamic"],
		Icon: brandMark("EIB", "#0f7b4f", { accent: "#c9a227" }),
	},
	"bank.enbd": {
		label: "Emirates NBD",
		group: "bank",
		color: "#004b8d",
		keywords: ["enbd", "nbd", "uae"],
		Icon: brandMark("NBD", "#004b8d", { accent: "#f58220" }),
	},
	"bank.fab": {
		label: "First Abu Dhabi Bank",
		group: "bank",
		color: "#0057b8",
		keywords: ["fab", "uae"],
		Icon: brandMark("FAB", "#0057b8", { accent: "#78be20" }),
	},
	"bank.hbl": {
		label: "HBL",
		group: "bank",
		color: "#006938",
		keywords: ["hbl", "habib", "pakistan"],
		Icon: brandMark("HBL", "#006938", { accent: "#d1a64a" }),
	},
	"bank.mashreq": {
		label: "Mashreq",
		group: "bank",
		color: "#f47b20",
		keywords: ["mashreq", "uae"],
		Icon: brandMark("MSH", "#f47b20", { accent: "#1f1f1f" }),
	},
	"bank.mcb": {
		label: "MCB Bank",
		group: "bank",
		color: "#00a651",
		keywords: ["mcb", "pakistan"],
		Icon: brandMark("MCB", "#00a651", { accent: "#00502a" }),
	},
	"bank.meezan": {
		label: "Meezan Bank",
		group: "bank",
		color: "#00513a",
		keywords: ["meezan", "pakistan", "islamic"],
		Icon: brandMark("MZN", "#00513a", { accent: "#8cc63f" }),
	},
	"bank.rakbank": {
		label: "RAKBANK",
		group: "bank",
		color: "#a6192e",
		keywords: ["rak", "rakbank", "uae"],
		Icon: brandMark("RAK", "#a6192e", { accent: "#f2a900" }),
	},
	"bank.scb": {
		label: "Standard Chartered",
		group: "bank",
		color: "#0473ea",
		keywords: ["scb", "standard chartered", "pakistan"],
		Icon: brandMark("SC", "#0473ea", { accent: "#38d200" }),
	},

	"wallet.careem": {
		label: "Careem Pay",
		group: "wallet",
		color: "#1fbf61",
		keywords: ["careem", "uae"],
		Icon: brandMark("CP", "#1fbf61", { accent: "#0b5f32" }),
	},
	"wallet.easypaisa": {
		label: "EasyPaisa",
		group: "wallet",
		color: "#76bc21",
		keywords: ["easypaisa", "easy paisa", "pakistan"],
		Icon: brandMark("EP", "#76bc21", { accent: "#0e6b2e" }),
	},
	"wallet.nayapay": {
		label: "NayaPay",
		group: "wallet",
		color: "#e8004c",
		keywords: ["nayapay", "naya pay", "pakistan"],
		Icon: brandMark("NP", "#e8004c", { accent: "#2b0a1a" }),
	},
	"wallet.payoneer": {
		label: "Payoneer",
		group: "wallet",
		color: "#ff4800",
		keywords: ["payoneer"],
		Icon: brandMark("PO", "#ff4800", { accent: "#1a1a1a" }),
	},
	"wallet.paypal": {
		label: "PayPal",
		group: "wallet",
		color: "#003087",
		keywords: ["paypal", "pay pal"],
		Icon: brandMark("PP", "#003087", { accent: "#009cde" }),
	},
	"wallet.sadapay": {
		label: "SadaPay",
		group: "wallet",
		color: "#111827",
		keywords: ["sadapay", "sada pay", "pakistan"],
		Icon: brandMark("SP", "#111827", { accent: "#00e5a0" }),
	},
	"wallet.wise": {
		label: "Wise",
		group: "wallet",
		color: "#9fe870",
		keywords: ["wise", "transferwise"],
		Icon: brandMark("W", "#9fe870", { accent: "#163300", foreground: "#163300" }),
	},

	"generic.bank": {
		label: "Bank",
		group: "generic",
		color: "currentColor",
		keywords: ["branch", "other bank"],
		Icon: Landmark,
	},
	"generic.card": {
		label: "Credit Card",
		group: "generic",
		color: "currentColor",
		keywords: ["card", "credit", "debit"],
		Icon: CreditCard,
	},
	"generic.cash": {
		label: "Cash",
		group: "generic",
		color: "currentColor",
		keywords: ["cash", "salary", "allowance", "notes"],
		Icon: Banknote,
	},
	"generic.claims": {
		label: "Claims",
		group: "generic",
		color: "currentColor",
		keywords: ["claim", "reimbursement", "receipt"],
		Icon: ReceiptText,
	},
	"generic.committee": {
		label: "Committee",
		group: "generic",
		color: "currentColor",
		keywords: ["committee", "comety", "group", "pool"],
		Icon: Users,
	},
	"generic.crypto": {
		label: "Crypto",
		group: "generic",
		color: "currentColor",
		keywords: ["crypto", "bitcoin"],
		Icon: Bitcoin,
	},
	"generic.exchange": {
		label: "Currency",
		group: "generic",
		color: "currentColor",
		keywords: ["exchange", "fx", "currency", "transfer"],
		Icon: ArrowRightLeft,
	},
	"generic.freelance": {
		label: "Freelance",
		group: "generic",
		color: "currentColor",
		keywords: ["freelance", "laptop", "work", "client"],
		Icon: Laptop,
	},
	"generic.gift": {
		label: "Gift",
		group: "generic",
		color: "currentColor",
		keywords: ["gift", "eidi", "kids"],
		Icon: Gift,
	},
	"generic.investment": {
		label: "Investment",
		group: "generic",
		color: "currentColor",
		keywords: ["investment", "portfolio", "fund", "stocks"],
		Icon: TrendingUp,
	},
	"generic.loan": {
		label: "Loan",
		group: "generic",
		color: "currentColor",
		keywords: ["loan", "lending", "borrow"],
		Icon: Handshake,
	},
	"generic.medical": {
		label: "Medical",
		group: "generic",
		color: "currentColor",
		keywords: ["medical", "health", "hospital"],
		Icon: HeartPulse,
	},
	"generic.misc": {
		label: "Other",
		group: "generic",
		color: "currentColor",
		keywords: ["misc", "other", "belongings"],
		Icon: Package,
	},
	"generic.person": {
		label: "Person",
		group: "generic",
		color: "currentColor",
		keywords: ["person", "family", "friend"],
		Icon: User,
	},
	"generic.property": {
		label: "Property",
		group: "generic",
		color: "currentColor",
		keywords: ["property", "home", "house", "real estate"],
		Icon: House,
	},
	"generic.savings": {
		label: "Savings",
		group: "generic",
		color: "currentColor",
		keywords: ["savings", "piggy", "deposit"],
		Icon: PiggyBank,
	},
	"generic.shop": {
		label: "Shop",
		group: "generic",
		color: "currentColor",
		keywords: ["shop", "store", "dropship", "ecommerce"],
		Icon: ShoppingCart,
	},
	"generic.solar": {
		label: "Solar",
		group: "generic",
		color: "currentColor",
		keywords: ["solar", "energy", "panel"],
		Icon: Sun,
	},
	"generic.transit": {
		label: "Transit",
		group: "generic",
		color: "currentColor",
		keywords: ["transit", "bus", "travel", "daewoo"],
		Icon: Bus,
	},
	"generic.wallet": {
		label: "Wallet",
		group: "generic",
		color: "currentColor",
		keywords: ["wallet", "default", "general"],
		Icon: Wallet,
	},
};

export const ACCOUNT_ICON_GROUPS: ReadonlyArray<{ id: AccountIconGroup; title: string }> = [
	{ id: "bank", title: "Banks" },
	{ id: "wallet", title: "Wallets" },
	{ id: "generic", title: "Generic" },
];

export interface AccountIconOption extends AccountIconDefinition {
	key: AccountIconKey;
}

/** Every icon the picker can offer, ordered banks → wallets → generic. */
export const ACCOUNT_ICON_OPTIONS: readonly AccountIconOption[] = ACCOUNT_ICON_GROUPS.flatMap(
	(group) =>
		ACCOUNT_ICON_KEYS.filter((key) => ACCOUNT_ICON_REGISTRY[key].group === group.id).map((key) => ({
			key,
			...ACCOUNT_ICON_REGISTRY[key],
		}))
);
