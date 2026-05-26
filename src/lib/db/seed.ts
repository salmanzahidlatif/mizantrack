import { v4 as uuidv4 } from "uuid";

import { db } from "@/lib/db/local";

import type { Category } from "@/types";

const DEFAULT_CATEGORIES: Omit<Category, "id" | "userId" | "updatedAt">[] = [
	// Expense categories
	{ title: "Food & Dining", type: "Expense", icon: "🍽️" },
	{ title: "Transport", type: "Expense", icon: "🚗" },
	{ title: "Shopping", type: "Expense", icon: "🛍️" },
	{ title: "Healthcare", type: "Expense", icon: "🏥" },
	{ title: "Utilities", type: "Expense", icon: "⚡" },
	{ title: "Rent & Housing", type: "Expense", icon: "🏠" },
	{ title: "Education", type: "Expense", icon: "📚" },
	{ title: "Entertainment", type: "Expense", icon: "🎬" },
	{ title: "Personal Care", type: "Expense", icon: "💅" },
	{ title: "Others", type: "Expense", icon: "📦" },
	// Income categories
	{ title: "Salary", type: "Income", icon: "💼" },
	{ title: "Freelance", type: "Income", icon: "💻" },
	{ title: "Business", type: "Income", icon: "🏢" },
	{ title: "Investment", type: "Income", icon: "📈" },
	{ title: "Gift", type: "Income", icon: "🎁" },
];

export async function seedDefaultCategories(userId: string): Promise<void> {
	const existingCount = await db.categories.where("userId").equals(userId).count();
	if (existingCount > 0) return;

	const now = Date.now();
	const categories: Category[] = DEFAULT_CATEGORIES.map((c) => ({
		...c,
		id: uuidv4(),
		userId,
		updatedAt: now,
	}));

	await db.categories.bulkPut(categories);
}
