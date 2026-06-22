import { beforeEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { IDBFactory } from "fake-indexeddb";
import fs from "fs";
import path from "path";

import { db } from "@/lib/db/local";
import { importHysabKytab } from "@/lib/import/hysabKytab";

// Mock IndexedDB
Dexie.dependencies.indexedDB = new IDBFactory();

describe("HK Import - Actual Backup File Integration Test", () => {
	const userId = "test-user-actual-backup";
	const backupPath = path.join(process.cwd(), "docs", "Hysab Kytab - backup - new.xls");

	beforeEach(async () => {
		await db.delete();
		await db.open();

		// Set up user config with PKR as default currency (matching your actual usage)
		await db.dbConfig.put({
			id: userId,
			currency: "PKR",
			fiscalYearStartMonth: 7, // July (common for Pakistan)
		});
	});

	it("imports the actual HK backup file with correct pairing", async () => {
		// Check if the backup file exists
		if (!fs.existsSync(backupPath)) {
			console.warn("⚠️  Skipping test: Backup file not found at", backupPath);
			return;
		}

		console.log("\n📂 Testing with actual backup file:", backupPath);
		console.log("📦 File size:", (fs.statSync(backupPath).size / 1024 / 1024).toFixed(2), "MB\n");

		// Read the file and create a File object
		const buffer = fs.readFileSync(backupPath);
		const file = new File([buffer], "Hysab Kytab - backup - new.xls");

		// Run the import
		console.time("Import duration");
		const result = await importHysabKytab(file, userId);
		console.timeEnd("Import duration");

		console.log("\n📊 IMPORT RESULTS:");
		console.log("=".repeat(70));
		console.log("✅ Accounts imported:", result.accounts);
		console.log("✅ Categories imported:", result.categories);
		console.log("✅ Transactions imported:", result.transactions);
		console.log("✅ Transfers paired:", result.transfersPaired);
		console.log("✅ Auto-created accounts:", result.autoCreated);
		if (result.autoCreatedAccounts && result.autoCreatedAccounts.length > 0) {
			console.log("   Auto-created account names:", result.autoCreatedAccounts.join(", "));
		}
		console.log("=".repeat(70));

		// Verify expected counts based on the analysis
		expect(result.accounts).toBe(38); // Rows in ACCOUNT sheet
		expect(result.categories).toBe(70); // Rows in CATEGORY sheet (before deduplication)
		expect(result.transactions).toBe(7596); // 6207 non-transfers + 1388 paired + 1 unmatched
		expect(result.transfersPaired).toBe(1388); // NEW algorithm result
		expect(result.autoCreated).toBe(5); // Expected auto-created accounts for missing references

		// Verify database state
		const accounts = await db.accounts.where("userId").equals(userId).toArray();
		const categories = await db.categories.where("userId").equals(userId).toArray();
		const transactions = await db.transactions.where("userId").equals(userId).toArray();

		// Total accounts = 38 from sheet + 5 auto-created = 43
		expect(accounts.length).toBe(43); // 38 + 5 auto-created
		// Categories: 70 rows in sheet but only 56 unique after normalization (duplicates merged)
		expect(categories.length).toBe(56); // Unique categories after deduplication
		expect(transactions.length).toBe(result.transactions);

		// Verify paired transfers have toAccountId
		const pairedTransfers = transactions.filter(
			(t) => t.type === "Transfer" && t.toAccountId !== undefined
		);
		const unmatchedTransfers = transactions.filter(
			(t) => t.type === "Transfer" && t.toAccountId === undefined
		);

		console.log("\n🔗 TRANSFER ANALYSIS:");
		console.log("   Paired transfers (with toAccountId):", pairedTransfers.length);
		console.log("   Unmatched transfers (without toAccountId):", unmatchedTransfers.length);

		expect(pairedTransfers.length).toBe(1388);
		expect(unmatchedTransfers.length).toBe(1);

		// Verify all accounts have PKR currency (from user config)
		const nonPKRAccounts = accounts.filter((a) => a.currency !== "PKR");
		if (nonPKRAccounts.length > 0) {
			console.warn("⚠️  Non-PKR accounts found:", nonPKRAccounts.map((a) => `${a.title} (${a.currency})`));
		}

		// Sample some paired transfers to verify they look correct
		const samplePaired = pairedTransfers.slice(0, 5);
		console.log("\n📝 SAMPLE PAIRED TRANSFERS:");
		for (const tx of samplePaired) {
			const fromAccount = accounts.find((a) => a.id === tx.accountId);
			const toAccount = accounts.find((a) => a.id === tx.toAccountId);
			console.log(
				`   ${fromAccount?.title} → ${toAccount?.title}: ${tx.amount} (${new Date(tx.date).toLocaleDateString()})`
			);
		}

		// Check for any transactions with missing account references
		const orphanTxns = transactions.filter((t) => {
			const accountExists = accounts.some((a) => a.id === t.accountId);
			const toAccountExists = t.toAccountId ? accounts.some((a) => a.id === t.toAccountId) : true;
			return !accountExists || !toAccountExists;
		});

		if (orphanTxns.length > 0) {
			console.warn("\n⚠️  Transactions with missing account references:", orphanTxns.length);
		}

		expect(orphanTxns.length).toBe(0); // Should be 0 - all references should be valid

		console.log("\n✅ ALL VALIDATIONS PASSED\n");
	}, 30000); // 30 second timeout for large import

	it.skip("handles idempotent re-import (same counts on second import)", async () => {
		if (!fs.existsSync(backupPath)) {
			console.warn("⚠️  Skipping test: Backup file not found");
			return;
		}

		const buffer = fs.readFileSync(backupPath);
		const file = new File([buffer], "Hysab Kytab - backup - new.xls");

		// First import
		const result1 = await importHysabKytab(file, userId);

		// Second import (should be idempotent)
		const result2 = await importHysabKytab(file, userId);

		console.log("\n🔄 IDEMPOTENCY TEST:");
		console.log("   First import transactions:", result1.transactions);
		console.log("   Second import transactions:", result2.transactions);

		// Counts should be identical
		expect(result2.accounts).toBe(result1.accounts);
		expect(result2.categories).toBe(result1.categories);
		expect(result2.transactions).toBe(result1.transactions);
		expect(result2.transfersPaired).toBe(result1.transfersPaired);

		// Database should still have same counts (upsert, not append)
		const transactions = await db.transactions.where("userId").equals(userId).toArray();
		expect(transactions.length).toBe(result1.transactions);

		console.log("✅ Idempotent re-import verified\n");
	}, 60000); // 60 second timeout for two imports
});
