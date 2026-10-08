import type { Category } from "@/types";

export const DEFAULT_CATEGORY_ICON = "🏷️";

interface CategoryIconRule {
	icon: string;
	keywords: string[];
}

const CATEGORY_ICON_RULES: CategoryIconRule[] = [
	{ icon: "📦", keywords: ["all"] },
	{ icon: "💵", keywords: ["allowance", "pocket money", "deposit"] },
	{ icon: "🎉", keywords: ["bonus"] },
	{ icon: "📈", keywords: ["profit"] },
	{ icon: "🛒", keywords: ["grocery", "groceries", "supermarket", "market"] },
	{ icon: "🍽️", keywords: ["food", "drink", "dining", "eating", "restaurant", "cafe", "coffee"] },
	{ icon: "⛽", keywords: ["fuel", "petrol", "gas", "maintenance", "garage", "mechanic"] },
	{ icon: "🚗", keywords: ["transport", "car", "taxi", "uber", "parking", "metro", "bus"] },
	{
		icon: "⚡",
		keywords: ["utility", "utilities", "electric", "electricity", "water", "internet"],
	},
	{ icon: "🧾", keywords: ["bill", "bills", "subscription", "phone", "mobile"] },
	{ icon: "🏠", keywords: ["rent", "housing", "home", "house", "mortgage"] },
	{ icon: "🏥", keywords: ["health", "healthcare", "medical", "medicine", "doctor", "pharmacy"] },
	{ icon: "📚", keywords: ["education", "school", "college", "university", "course", "books"] },
	{ icon: "🛍️", keywords: ["shopping", "clothes", "clothing", "fashion", "electronics"] },
	{ icon: "✈️", keywords: ["travel", "flight", "hotel", "holiday", "vacation", "trip"] },
	{ icon: "🎬", keywords: ["entertainment", "movie", "cinema", "games", "music", "fun"] },
	{ icon: "💅", keywords: ["personal", "care", "salon", "beauty", "grooming"] },
	{ icon: "💼", keywords: ["salary", "payroll", "wage", "income", "bonus", "pension"] },
	{ icon: "💻", keywords: ["freelance", "freelancing", "contract", "client"] },
	{ icon: "🏢", keywords: ["business", "office", "company", "commission"] },
	{ icon: "🎁", keywords: ["gift", "gifts", "present"] },
	{ icon: "🤲", keywords: ["charity", "zakat", "sadaqah", "donation", "masjid"] },
	{ icon: "💰", keywords: ["saving", "savings", "deposit"] },
	{ icon: "📈", keywords: ["investment", "investments", "stock", "stocks", "fund"] },
	{ icon: "👥", keywords: ["committee"] },
	{ icon: "👪", keywords: ["family", "children", "kids", "parent", "mother", "papa", "amna"] },
	{ icon: "🛡️", keywords: ["insurance"] },
	{ icon: "💳", keywords: ["installment", "installments"] },
	{ icon: "🤝", keywords: ["loan", "loans"] },
	{ icon: "🧹", keywords: ["household"] },
	{ icon: "💍", keywords: ["wedding"] },
	{ icon: "🐾", keywords: ["pet", "pets", "cat", "dog"] },
	{ icon: "📦", keywords: ["other", "others", "misc", "miscellaneous", "expense", "expenses"] },
];

function normalizeTitle(title: string): string {
	return title
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesKeyword(title: string, keyword: string): boolean {
	const escaped = escapeRegExp(keyword).replace(/\s+/g, "\\s+");
	return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, "i").test(title);
}

export function resolveCategoryIcon(title: string, explicitIcon?: string): string {
	const icon = explicitIcon?.trim();
	if (icon) return icon;

	const normalizedTitle = normalizeTitle(title);
	for (const rule of CATEGORY_ICON_RULES) {
		if (rule.keywords.some((keyword) => matchesKeyword(normalizedTitle, keyword))) {
			return rule.icon;
		}
	}

	return DEFAULT_CATEGORY_ICON;
}

export function getCategoryIcon(category: Pick<Category, "title" | "icon">): string {
	return resolveCategoryIcon(category.title, category.icon);
}
