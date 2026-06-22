import { beforeEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { IDBFactory } from "fake-indexeddb";

import { db } from "@/lib/db/local";
import { importHysabKytab } from "@/lib/import/hysabKytab";
import * as XLSX from "xlsx";

// Mock IndexedDB
Dexie.dependencies.indexedDB = new IDBFactory();

describe("HK Import Transfer Pairing", () => {
	const userId = "test-user-pairing";

	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	it("pairs transfers regardless of order (positive before negative)", async () => {
		// Create a minimal HK file with positive entry BEFORE negative entry
		const wb = XLSX.utils.book_new();

		const accountSheet = XLSX.utils.json_to_sheet([
			{ Title: "Cash", "Opening Balance": "0", "Balance Amount": "0", "Closing Balance": "0" },
			{ Title: "Bank", "Opening Balance": "0", "Balance Amount": "0", "Closing Balance": "0" },
		]);

		const categorySheet = XLSX.utils.json_to_sheet([
			{ Title: "Salary", "Balance Amount": "0", "Category Type": "Income" },
		]);

		// Positive entry at index 0, negative at index 1 (reversed order)
		const activitiesSheet = XLSX.utils.json_to_sheet([
			{
				"Voucher Type": "Transfer",
				"Voucher Date": "01/01/2024",
				"Voucher Amount": "5000.0", // POSITIVE FIRST
				Description: "",
				"Category Name": "",
				"Account Name": "Cash",
				Tags: "",
				Events: "",
				Place: "",
				"Travel Currency Rate": "0.0",
				"Travel Currency Symbol": "",
				"Travel Currency Amount": "0.0",
				"Travel Location": "",
				"Travel Date": "",
			},
			{
				"Voucher Type": "Transfer",
				"Voucher Date": "01/01/2024",
				"Voucher Amount": "-5000.0", // NEGATIVE SECOND
				Description: "",
				"Category Name": "",
				"Account Name": "Bank",
				Tags: "",
				Events: "",
				Place: "",
				"Travel Currency Rate": "0.0",
				"Travel Currency Symbol": "",
				"Travel Currency Amount": "0.0",
				"Travel Location": "",
				"Travel Date": "",
			},
		]);

		XLSX.utils.book_append_sheet(wb, accountSheet, "ACCOUNT");
		XLSX.utils.book_append_sheet(wb, categorySheet, "CATEGORY");
		XLSX.utils.book_append_sheet(wb, activitiesSheet, "ACTIVITIES");

		const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
		const file = new File([buffer], "test.xlsx");

		const result = await importHysabKytab(file, userId);

		expect(result.transfersPaired).toBe(1);
		expect(result.transactions).toBe(1); // 1 paired transfer, not 2 separate

		const txns = await db.transactions.where("userId").equals(userId).toArray();
		expect(txns.length).toBe(1);
		expect(txns[0]?.type).toBe("Transfer");
		expect(txns[0]?.toAccountId).toBeDefined(); // Has destination = paired
	});

	it("pairs transfers with empty dates using description similarity", async () => {
		const wb = XLSX.utils.book_new();

		const accountSheet = XLSX.utils.json_to_sheet([
			{ Title: "Savings", "Opening Balance": "0", "Balance Amount": "0", "Closing Balance": "0" },
			{ Title: "Current", "Opening Balance": "0", "Balance Amount": "0", "Closing Balance": "0" },
		]);

		const categorySheet = XLSX.utils.json_to_sheet([
			{ Title: "Salary", "Balance Amount": "0", "Category Type": "Income" },
		]);

		// Both have EMPTY dates but same description
		const activitiesSheet = XLSX.utils.json_to_sheet([
			{
				"Voucher Type": "Transfer",
				"Voucher Date": "", // EMPTY
				"Voucher Amount": "-10000.0",
				Description: "Transfer to savings",
				"Category Name": "",
				"Account Name": "Current",
				Tags: "",
				Events: "",
				Place: "",
				"Travel Currency Rate": "0.0",
				"Travel Currency Symbol": "",
				"Travel Currency Amount": "0.0",
				"Travel Location": "",
				"Travel Date": "",
			},
			{
				"Voucher Type": "Transfer",
				"Voucher Date": "", // EMPTY
				"Voucher Amount": "10000.0",
				Description: "Transfer to savings",
				"Category Name": "",
				"Account Name": "Savings",
				Tags: "",
				Events: "",
				Place: "",
				"Travel Currency Rate": "0.0",
				"Travel Currency Symbol": "",
				"Travel Currency Amount": "0.0",
				"Travel Location": "",
				"Travel Date": "",
			},
		]);

		XLSX.utils.book_append_sheet(wb, accountSheet, "ACCOUNT");
		XLSX.utils.book_append_sheet(wb, categorySheet, "CATEGORY");
		XLSX.utils.book_append_sheet(wb, activitiesSheet, "ACTIVITIES");

		const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
		const file = new File([buffer], "test.xlsx");

		const result = await importHysabKytab(file, userId);

		expect(result.transfersPaired).toBe(1);
		expect(result.transactions).toBe(1);

		const txns = await db.transactions.where("userId").equals(userId).toArray();
		expect(txns.length).toBe(1);
		expect(txns[0]?.toAccountId).toBeDefined();
	});

	it("handles multiple transfers on same date with different amounts", async () => {
		const wb = XLSX.utils.book_new();

		const accountSheet = XLSX.utils.json_to_sheet([
			{ Title: "Cash", "Opening Balance": "0", "Balance Amount": "0", "Closing Balance": "0" },
			{ Title: "Bank1", "Opening Balance": "0", "Balance Amount": "0", "Closing Balance": "0" },
			{ Title: "Bank2", "Opening Balance": "0", "Balance Amount": "0", "Closing Balance": "0" },
		]);

		const categorySheet = XLSX.utils.json_to_sheet([
			{ Title: "Salary", "Balance Amount": "0", "Category Type": "Income" },
		]);

		// Same date, two different transfer pairs with different amounts
		const activitiesSheet = XLSX.utils.json_to_sheet([
			{
				"Voucher Type": "Transfer",
				"Voucher Date": "15/03/2024",
				"Voucher Amount": "5000.0",
				Description: "",
				"Category Name": "",
				"Account Name": "Cash",
				Tags: "",
				Events: "",
				Place: "",
				"Travel Currency Rate": "0.0",
				"Travel Currency Symbol": "",
				"Travel Currency Amount": "0.0",
				"Travel Location": "",
				"Travel Date": "",
			},
			{
				"Voucher Type": "Transfer",
				"Voucher Date": "15/03/2024",
				"Voucher Amount": "-5000.0",
				Description: "",
				"Category Name": "",
				"Account Name": "Bank1",
				Tags: "",
				Events: "",
				Place: "",
				"Travel Currency Rate": "0.0",
				"Travel Currency Symbol": "",
				"Travel Currency Amount": "0.0",
				"Travel Location": "",
				"Travel Date": "",
			},
			{
				"Voucher Type": "Transfer",
				"Voucher Date": "15/03/2024",
				"Voucher Amount": "10000.0",
				Description: "",
				"Category Name": "",
				"Account Name": "Cash",
				Tags: "",
				Events: "",
				Place: "",
				"Travel Currency Rate": "0.0",
				"Travel Currency Symbol": "",
				"Travel Currency Amount": "0.0",
				"Travel Location": "",
				"Travel Date": "",
			},
			{
				"Voucher Type": "Transfer",
				"Voucher Date": "15/03/2024",
				"Voucher Amount": "-10000.0",
				Description: "",
				"Category Name": "",
				"Account Name": "Bank2",
				Tags: "",
				Events: "",
				Place: "",
				"Travel Currency Rate": "0.0",
				"Travel Currency Symbol": "",
				"Travel Currency Amount": "0.0",
				"Travel Location": "",
				"Travel Date": "",
			},
		]);

		XLSX.utils.book_append_sheet(wb, accountSheet, "ACCOUNT");
		XLSX.utils.book_append_sheet(wb, categorySheet, "CATEGORY");
		XLSX.utils.book_append_sheet(wb, activitiesSheet, "ACTIVITIES");

		const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
		const file = new File([buffer], "test.xlsx");

		const result = await importHysabKytab(file, userId);

		expect(result.transfersPaired).toBe(2); // Both pairs matched
		expect(result.transactions).toBe(2); // 2 paired transfers

		const txns = await db.transactions.where("userId").equals(userId).toArray();
		expect(txns.length).toBe(2);
		expect(txns.every((t) => t.toAccountId !== undefined)).toBe(true);
	});

	it("imports unmatched transfers without toAccountId", async () => {
		const wb = XLSX.utils.book_new();

		const accountSheet = XLSX.utils.json_to_sheet([
			{ Title: "Cash", "Opening Balance": "0", "Balance Amount": "0", "Closing Balance": "0" },
		]);

		const categorySheet = XLSX.utils.json_to_sheet([
			{ Title: "Salary", "Balance Amount": "0", "Category Type": "Income" },
		]);

		// Transfer with no matching pair
		const activitiesSheet = XLSX.utils.json_to_sheet([
			{
				"Voucher Type": "Transfer",
				"Voucher Date": "20/04/2024",
				"Voucher Amount": "-7500.0",
				Description: "Orphan transfer",
				"Category Name": "",
				"Account Name": "Cash",
				Tags: "",
				Events: "",
				Place: "",
				"Travel Currency Rate": "0.0",
				"Travel Currency Symbol": "",
				"Travel Currency Amount": "0.0",
				"Travel Location": "",
				"Travel Date": "",
			},
		]);

		XLSX.utils.book_append_sheet(wb, accountSheet, "ACCOUNT");
		XLSX.utils.book_append_sheet(wb, categorySheet, "CATEGORY");
		XLSX.utils.book_append_sheet(wb, activitiesSheet, "ACTIVITIES");

		const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
		const file = new File([buffer], "test.xlsx");

		const result = await importHysabKytab(file, userId);

		expect(result.transfersPaired).toBe(0);
		expect(result.transactions).toBe(1); // Still imported

		const txns = await db.transactions.where("userId").equals(userId).toArray();
		expect(txns.length).toBe(1);
		expect(txns[0]?.type).toBe("Transfer");
		expect(txns[0]?.toAccountId).toBeUndefined(); // No destination = unmatched
	});
});
