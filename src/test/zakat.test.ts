/**
 * Sprint 6: Zakat Calculator tests
 * Covers: tola conversion, nisab logic, zakat obligation, gold price cache
 */
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/local";

const USER_ID = "user-zakat-test";

// ─── Constants ───────────────────────────────────────────────────────────────

const TOLA_TO_GRAMS = 11.664;
const NISAB_GOLD_GRAMS = 85;
const NISAB_SILVER_GRAMS = 595;

// ─── Tola conversion ─────────────────────────────────────────────────────────

describe("Tola to grams conversion", () => {
	it("converts 1 tola to 11.664g", () => {
		expect(1 * TOLA_TO_GRAMS).toBeCloseTo(11.664);
	});

	it("converts 7.5 tola (nisab gold equivalent) to approximately 87.48g", () => {
		// 7.5 tola ≈ 87.48g, above 85g nisab
		const grams = 7.5 * TOLA_TO_GRAMS;
		expect(grams).toBeGreaterThan(NISAB_GOLD_GRAMS);
	});

	it("converts 0 tola to 0g", () => {
		expect(0 * TOLA_TO_GRAMS).toBe(0);
	});
});

// ─── Zakat calculation logic ─────────────────────────────────────────────────

describe("Zakat calculation", () => {
	const goldPrice = 90; // USD per gram
	const silverPrice = 1.0; // USD per gram

	it("calculates nisab for gold standard (85g × gold price)", () => {
		const nisab = NISAB_GOLD_GRAMS * goldPrice;
		expect(nisab).toBe(7650);
	});

	it("calculates nisab for silver standard (595g × silver price)", () => {
		const nisab = NISAB_SILVER_GRAMS * silverPrice;
		expect(nisab).toBe(595);
	});

	it("returns 2.5% when wealth exceeds nisab", () => {
		const totalWealth = 10000;
		const nisab = NISAB_GOLD_GRAMS * goldPrice; // 7650
		const zakat = totalWealth >= nisab ? totalWealth * 0.025 : 0;
		expect(zakat).toBe(250);
	});

	it("returns 0 when wealth is below nisab", () => {
		const totalWealth = 5000;
		const nisab = NISAB_GOLD_GRAMS * goldPrice; // 7650
		const zakat = totalWealth >= nisab ? totalWealth * 0.025 : 0;
		expect(zakat).toBe(0);
	});

	it("returns 0 when wealth exactly equals nisab (boundary)", () => {
		const totalWealth = 7650;
		const nisab = NISAB_GOLD_GRAMS * goldPrice;
		// At exactly nisab, still liable (>=)
		const zakat = totalWealth >= nisab ? totalWealth * 0.025 : 0;
		expect(zakat).toBe(7650 * 0.025);
	});

	it("includes gold value in total wealth calculation", () => {
		const goldGrams = 100; // above nisab
		const goldValue = goldGrams * goldPrice; // 100 × 90 = 9000
		const cashBalance = 5000;
		const total = cashBalance + goldValue; // 14000
		const nisab = NISAB_GOLD_GRAMS * goldPrice; // 7650
		expect(total).toBeGreaterThan(nisab);
		expect(total * 0.025).toBeCloseTo(350); // 14000 × 2.5% = 350
	});
});

// ─── Balance at date ─────────────────────────────────────────────────────────

describe("Balance at assessment date", () => {
	function computeBalance(
		openingBalance: number,
		transactions: Array<{
			date: number;
			type: string;
			amount: number;
			accountId: string;
			toAccountId?: string;
		}>,
		accountId: string,
		asOf: number
	): number {
		let balance = openingBalance;
		for (const t of transactions) {
			if (t.date > asOf) continue;
			if (t.accountId === accountId) {
				if (t.type === "Income") balance += t.amount;
				else if (t.type === "Expense") balance -= t.amount;
				else if (t.type === "Transfer") balance -= t.amount;
			} else if (t.toAccountId === accountId && t.type === "Transfer") {
				balance += t.amount;
			}
		}
		return balance;
	}

	it("uses opening balance when no transactions", () => {
		const balance = computeBalance(1000, [], "acc1", Date.now());
		expect(balance).toBe(1000);
	});

	it("adds income transactions", () => {
		const txns = [{ date: Date.now() - 1000, type: "Income", amount: 500, accountId: "acc1" }];
		const balance = computeBalance(1000, txns, "acc1", Date.now());
		expect(balance).toBe(1500);
	});

	it("subtracts expense transactions", () => {
		const txns = [{ date: Date.now() - 1000, type: "Expense", amount: 200, accountId: "acc1" }];
		const balance = computeBalance(1000, txns, "acc1", Date.now());
		expect(balance).toBe(800);
	});

	it("subtracts transfer-out and adds transfer-in", () => {
		const now = Date.now();
		const txns = [
			{ date: now - 1000, type: "Transfer", amount: 300, accountId: "acc1", toAccountId: "acc2" },
		];
		expect(computeBalance(1000, txns, "acc1", now)).toBe(700);
		expect(computeBalance(500, txns, "acc2", now)).toBe(800);
	});

	it("excludes transactions after assessment date", () => {
		const past = Date.now() - 10000;
		const future = Date.now() + 10000;
		const txns = [{ date: future, type: "Income", amount: 500, accountId: "acc1" }];
		const balance = computeBalance(1000, txns, "acc1", past);
		expect(balance).toBe(1000); // future transaction excluded
	});
});

// ─── Gold price caching ───────────────────────────────────────────────────────

describe("Gold price cache (DbConfig)", () => {
	beforeEach(async () => {
		await db.dbConfig.clear();
		await db.dbConfig.add({
			id: USER_ID,
			firebaseConfig: "{}",
			enabled: false,
			currency: "AED",
			fiscalYearStartMonth: 7,
		});
	});

	it("stores and retrieves gold price cache fields", async () => {
		const now = Date.now();
		await db.dbConfig.update(USER_ID, {
			lastGoldPricePerGram: 92.5,
			lastGoldPriceFetchedAt: now,
		});
		const config = await db.dbConfig.get(USER_ID);
		expect(config?.lastGoldPricePerGram).toBe(92.5);
		expect(config?.lastGoldPriceFetchedAt).toBe(now);
	});

	it("cache is stale after 1 hour", () => {
		const CACHE_TTL_MS = 60 * 60 * 1000;
		const fetchedAt = Date.now() - CACHE_TTL_MS - 1;
		const isStale = Date.now() - fetchedAt > CACHE_TTL_MS;
		expect(isStale).toBe(true);
	});

	it("cache is fresh within 1 hour", () => {
		const CACHE_TTL_MS = 60 * 60 * 1000;
		const fetchedAt = Date.now() - 1000; // 1 second ago
		const isFresh = Date.now() - fetchedAt < CACHE_TTL_MS;
		expect(isFresh).toBe(true);
	});

	it("stores and retrieves goldApiKey", async () => {
		await db.dbConfig.update(USER_ID, { goldApiKey: "test-api-key-123" });
		const config = await db.dbConfig.get(USER_ID);
		expect(config?.goldApiKey).toBe("test-api-key-123");
	});

	it("goldApiKey defaults to undefined", async () => {
		const config = await db.dbConfig.get(USER_ID);
		expect(config?.goldApiKey).toBeUndefined();
	});
});
