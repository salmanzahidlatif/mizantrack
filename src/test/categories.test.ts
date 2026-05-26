/**
 * Sprint 2: Category management tests
 * Covers: categorySchema validation, db CRUD, parent-child relationships
 */
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/local";
import { categorySchema } from "@/lib/validations/category";

// ─── categorySchema ────────────────────────────────────────────────────────

describe("categorySchema", () => {
	it("accepts valid expense category", () => {
		const result = categorySchema.safeParse({
			title: "Food & Dining",
			type: "Expense",
		});
		expect(result.success).toBe(true);
	});

	it("accepts valid income category", () => {
		const result = categorySchema.safeParse({
			title: "Salary",
			type: "Income",
		});
		expect(result.success).toBe(true);
	});

	it("rejects empty title", () => {
		const result = categorySchema.safeParse({ title: "", type: "Expense" });
		expect(result.success).toBe(false);
	});

	it("rejects invalid type", () => {
		const result = categorySchema.safeParse({ title: "Test", type: "Transfer" });
		expect(result.success).toBe(false);
	});

	it("accepts optional parentId (valid UUID)", () => {
		const result = categorySchema.safeParse({
			title: "Restaurants",
			type: "Expense",
			parentId: "550e8400-e29b-41d4-a716-446655440000",
		});
		expect(result.success).toBe(true);
	});

	it("rejects invalid parentId (not a UUID)", () => {
		const result = categorySchema.safeParse({
			title: "Restaurants",
			type: "Expense",
			parentId: "not-a-uuid",
		});
		expect(result.success).toBe(false);
	});

	it("accepts optional color and icon", () => {
		const result = categorySchema.safeParse({
			title: "Transport",
			type: "Expense",
			color: "#f97316",
			icon: "🚗",
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.color).toBe("#f97316");
			expect(result.data.icon).toBe("🚗");
		}
	});

	it("allows parentId to be undefined (top-level category)", () => {
		const result = categorySchema.safeParse({
			title: "Healthcare",
			type: "Expense",
			parentId: undefined,
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.parentId).toBeUndefined();
		}
	});
});

// ─── Dexie categories CRUD ─────────────────────────────────────────────────

describe("categories db operations", () => {
	const userId = "user-cat-test";
	const parentId = "550e8400-e29b-41d4-a716-446655440020";
	const childId = "550e8400-e29b-41d4-a716-446655440021";

	beforeEach(async () => {
		await db.categories.clear();
	});

	it("can add and retrieve a parent category", async () => {
		await db.categories.put({
			id: parentId,
			userId,
			title: "Food",
			type: "Expense",
			updatedAt: Date.now(),
		});
		const cat = await db.categories.get(parentId);
		expect(cat?.title).toBe("Food");
		expect(cat?.type).toBe("Expense");
		expect(cat?.parentId).toBeUndefined();
	});

	it("can add a child category referencing parent", async () => {
		await db.categories.bulkPut([
			{
				id: parentId,
				userId,
				title: "Food",
				type: "Expense",
				updatedAt: Date.now(),
			},
			{
				id: childId,
				userId,
				title: "Restaurants",
				type: "Expense",
				parentId,
				updatedAt: Date.now(),
			},
		]);
		const child = await db.categories.get(childId);
		expect(child?.parentId).toBe(parentId);
	});

	it("can soft-delete a category", async () => {
		await db.categories.put({
			id: parentId,
			userId,
			title: "Food",
			type: "Expense",
			updatedAt: Date.now(),
		});
		await db.categories.update(parentId, {
			deletedAt: Date.now(),
			updatedAt: Date.now(),
		});
		const cat = await db.categories.get(parentId);
		expect(cat?.deletedAt).toBeDefined();
	});

	it("filters categories by type", async () => {
		await db.categories.bulkPut([
			{
				id: "550e8400-e29b-41d4-a716-446655440022",
				userId,
				title: "Salary",
				type: "Income",
				updatedAt: Date.now(),
			},
			{
				id: "550e8400-e29b-41d4-a716-446655440023",
				userId,
				title: "Food",
				type: "Expense",
				updatedAt: Date.now(),
			},
		]);
		const incomeCategories = await db.categories
			.where("userId")
			.equals(userId)
			.filter((c) => c.type === "Income")
			.toArray();
		expect(incomeCategories).toHaveLength(1);
		expect(incomeCategories[0]!.title).toBe("Salary");
	});
});
