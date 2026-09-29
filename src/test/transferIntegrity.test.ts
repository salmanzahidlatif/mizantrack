import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/local";
import {
	getTransferIntegrityReport,
	repairInvalidTransferRecords,
} from "@/lib/import/transferIntegrity";

const USER_ID = "transfer-integrity-user";

beforeEach(async () => {
	await db.accounts.clear();
	await db.transactions.clear();
});

describe("transfer integrity diagnostics", () => {
	it("reports invalid transfer value per account and detects opening-balance workarounds", async () => {
		await db.accounts.bulkPut([
			{
				id: "cash",
				userId: USER_ID,
				title: "Cash",
				openingBalance: 532154.23,
				currency: "AED",
				isArchived: false,
				updatedAt: 1,
			},
			{
				id: "bank",
				userId: USER_ID,
				title: "Bank",
				openingBalance: 1000,
				currency: "AED",
				isArchived: false,
				updatedAt: 1,
			},
		]);
		await db.transactions.bulkPut([
			{
				id: "legacy-invalid-1",
				userId: USER_ID,
				type: "Transfer",
				date: 1,
				amount: 100000,
				accountId: "cash",
				updatedAt: 1,
			},
			{
				id: "legacy-invalid-2",
				userId: USER_ID,
				type: "Transfer",
				date: 2,
				amount: 432154.23,
				accountId: "cash",
				toAccountId: "deleted-account",
				updatedAt: 1,
			},
			{
				id: "valid-transfer",
				userId: USER_ID,
				type: "Transfer",
				date: 3,
				amount: 50,
				accountId: "cash",
				toAccountId: "bank",
				updatedAt: 1,
			},
		]);

		const report = await getTransferIntegrityReport(USER_ID);

		expect(report.invalidTransferCount).toBe(2);
		expect(report.missingDestinationCount).toBe(1);
		expect(report.unresolvableDestinationCount).toBe(1);
		expect(report.accounts).toEqual([
			{
				accountId: "cash",
				title: "Cash",
				currency: "AED",
				count: 2,
				total: 532154.23,
				legacyBalance: -50,
				correctedBalance: 532104.23,
				openingBalance: 532154.23,
			},
		]);
		expect(report.openingBalanceWarnings).toEqual([
			{
				accountId: "cash",
				title: "Cash",
				currency: "AED",
				openingBalance: 532154.23,
				invalidTransferTotal: 532154.23,
			},
		]);
	});

	it("repairs invalid transfer records idempotently by soft-deleting them", async () => {
		await db.accounts.put({
			id: "cash",
			userId: USER_ID,
			title: "Cash",
			openingBalance: 0,
			currency: "AED",
			isArchived: false,
			updatedAt: 1,
		});
		await db.transactions.bulkPut([
			{
				id: "legacy-invalid",
				userId: USER_ID,
				type: "Transfer",
				date: 1,
				amount: 10,
				accountId: "cash",
				updatedAt: 1,
			},
			{
				id: "normal-income",
				userId: USER_ID,
				type: "Income",
				date: 2,
				amount: 20,
				accountId: "cash",
				updatedAt: 1,
			},
		]);

		const first = await repairInvalidTransferRecords(USER_ID);
		const second = await repairInvalidTransferRecords(USER_ID);
		const invalid = await db.transactions.get("legacy-invalid");
		const income = await db.transactions.get("normal-income");

		expect(first).toEqual({ repaired: 1, accountsAffected: 1 });
		expect(second).toEqual({ repaired: 0, accountsAffected: 0 });
		expect(invalid?.deletedAt).toBeDefined();
		expect(invalid?.updatedAt).toBe(invalid?.deletedAt);
		expect(income?.deletedAt).toBeUndefined();
	});
});
