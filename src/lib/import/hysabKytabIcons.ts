import { DEFAULT_ACCOUNT_ICON, resolveAccountIcon } from "@/lib/accountIcons";
import { resolveCategoryIcon } from "@/lib/categoryIcons";

export const HYSAB_KYTAB_BOX_ICON_EMOJI: Record<string, string> = {
	allowance_inactive: "💵",
	bills_inactive: "🧾",
	bonus_inactive: "🎉",
	bt_grocery: "🛒",
	comission_inactive: "💼",
	committee_inactive: "👥",
	donations_inactive: "🤲",
	easypaisa_bank: "📱",
	education_inactive: "📚",
	electronics_inactive: "🔌",
	entertainment_inactive: "🎬",
	expense_education: "📚",
	expense_household: "🧹",
	expense_medical: "🏥",
	expense_personal: "💅",
	expense_saving: "💰",
	family_inactive: "👪",
	food_inactive: "🍽️",
	freelance_inactive: "💻",
	fuel_inactive: "⛽",
	gifts_inactive: "🎁",
	groceries_inactive: "🛒",
	health_inactive: "🏥",
	home_inactive: "🏠",
	ic_cart_outline: "🛒",
	ic_other: "📦",
	ic_person: "👤",
	ic_silverware_variant: "🍽️",
	income_investment: "📈",
	income_salary: "💼",
	installments_inactive: "💳",
	insurance_inactive: "🛡️",
	investment_inactive: "📈",
	loan_inactive: "🤝",
	mcb: "🏦",
	medical_inactive: "🏥",
	meezan: "🕌",
	meezan_bank: "🕌",
	mobile_inactive: "📱",
	nayapay: "💳",
	office_inactive: "🏢",
	other_bank: "🏦",
	other_inactive: "📦",
	other_income_inactive: "💵",
	pension_inactive: "💵",
	personal_inactive: "💅",
	pocket_inactive: "👛",
	profit_inactive: "📈",
	rent_inactive: "🏠",
	sadapay: "💳",
	salary_inactive: "💼",
	savings_inactive: "🐷",
	sc_bank: "🏦",
	scb: "🏦",
	shopping_inactive: "🛍️",
	transport_inactive: "🚗",
	travel_inactive: "✈️",
	tutoring_inactive: "🎓",
	wedding_inactive: "💍",
};

const GENERIC_BOX_ICON_PATTERN = /^bt_\d+$/;
const ACCOUNT_SAFE_BOX_ICONS = new Set([
	"easypaisa_bank",
	"ic_person",
	"mcb",
	"meezan",
	"meezan_bank",
	"nayapay",
	"sadapay",
	"savings_inactive",
	"sc_bank",
	"scb",
]);

function normalizeBoxIconKey(value: string | undefined): string | undefined {
	const key = value
		?.trim()
		.replace(/^@drawable\//i, "")
		.toLowerCase();
	if (!key) return undefined;
	return key;
}

export function mapHysabKytabBoxIcon(
	value: string | undefined,
	context: "account" | "category" = "category"
): string | undefined {
	const key = normalizeBoxIconKey(value);
	if (!key || GENERIC_BOX_ICON_PATTERN.test(key)) return undefined;
	if (context === "account" && !ACCOUNT_SAFE_BOX_ICONS.has(key)) return undefined;
	return HYSAB_KYTAB_BOX_ICON_EMOJI[key];
}

export function normalizeHysabKytabColor(value: string | undefined): string | undefined {
	const raw = value?.trim();
	if (!raw) return undefined;

	const normalized = raw.startsWith("#") ? raw.toLowerCase() : `#${raw.toLowerCase()}`;
	let color: string | undefined;
	if (/^#[0-9a-f]{8}$/.test(normalized)) {
		color = `#${normalized.slice(3)}`;
	} else if (/^#[0-9a-f]{6}$/.test(normalized) || /^#[0-9a-f]{3}$/.test(normalized)) {
		color = normalized;
	}

	if (!color || color === "#000" || color === "#000000") return undefined;
	return color;
}

export function resolveHysabKytabAccountIcon(
	title: string,
	options: {
		boxIcon?: string;
		accountType?: string;
		bankName?: string;
		currency?: string;
	} = {}
): string {
	const inferred = resolveAccountIcon(title, {
		accountType: options.accountType,
		bankName: options.bankName,
		currency: options.currency,
	});
	if (inferred !== DEFAULT_ACCOUNT_ICON) return inferred;

	return mapHysabKytabBoxIcon(options.boxIcon, "account") ?? inferred;
}

export function resolveHysabKytabCategoryIcon(title: string, boxIcon?: string): string {
	return resolveCategoryIcon(title, mapHysabKytabBoxIcon(boxIcon, "category"));
}
