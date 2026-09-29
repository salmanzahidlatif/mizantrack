import Dexie from "dexie";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";

import { db } from "@/lib/db/local";
import { importHysabKytab } from "@/lib/import/hysabKytab";

import type { Transaction } from "@/types";

Dexie.dependencies.indexedDB = new IDBFactory();

const DEFAULT_CATEGORY = { Title: "Salary", "Balance Amount": "0", "Category Type": "Income" };

function makeWorkbook(input: {
	accounts: string[];
	activities: Array<{
		type?: "Transfer" | "Income" | "Expense";
		date?: string;
		amount: string;
		description?: string;
		account: string;
		category?: string;
	}>;
}) {
	const wb = XLSX.utils.book_new();
	const accountSheet = XLSX.utils.json_to_sheet(
		input.accounts.map((Title) => ({
			Title,
			"Opening Balance": "0",
			"Balance Amount": "0",
			"Closing Balance": "0",
		}))
	);
	const categorySheet = XLSX.utils.json_to_sheet([DEFAULT_CATEGORY]);
	const activitiesSheet = XLSX.utils.json_to_sheet(
		input.activities.map((activity) => ({
			"Voucher Type": activity.type ?? "Transfer",
			"Voucher Date": activity.date ?? "01/01/2024",
			"Voucher Amount": activity.amount,
			Description: activity.description ?? "",
			"Category Name": activity.category ?? "",
			"Account Name": activity.account,
			Tags: "",
			Events: "",
			Place: "",
			"Travel Currency Rate": "0.0",
			"Travel Currency Symbol": "",
			"Travel Currency Amount": "0.0",
			"Travel Location": "",
			"Travel Date": "",
		}))
	);

	XLSX.utils.book_append_sheet(wb, accountSheet, "ACCOUNT");
	XLSX.utils.book_append_sheet(wb, categorySheet, "CATEGORY");
	XLSX.utils.book_append_sheet(wb, activitiesSheet, "ACTIVITIES");

	const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
	return new File([buffer], "test.xlsx");
}

function balanceChange(transactions: Transaction[]): number {
	const byAccount = new Map<string, number>();

	for (const transaction of transactions) {
		if (transaction.type === "Income") {
			byAccount.set(
				transaction.accountId,
				(byAccount.get(transaction.accountId) ?? 0) + transaction.amount
			);
		} else if (transaction.type === "Expense") {
			byAccount.set(
				transaction.accountId,
				(byAccount.get(transaction.accountId) ?? 0) - transaction.amount
			);
		} else if (transaction.type === "Transfer") {
			byAccount.set(
				transaction.accountId,
				(byAccount.get(transaction.accountId) ?? 0) - transaction.amount
			);
			expect(transaction.toAccountId).toBeDefined();
			byAccount.set(
				transaction.toAccountId!,
				(byAccount.get(transaction.toAccountId!) ?? 0) + transaction.amount
			);
		}
	}

	return [...byAccount.values()].reduce((sum, amount) => sum + amount, 0);
}

function incomeMinusExpense(transactions: Transaction[]): number {
	return transactions.reduce((sum, transaction) => {
		if (transaction.type === "Income") return sum + transaction.amount;
		if (transaction.type === "Expense") return sum - transaction.amount;
		return sum;
	}, 0);
}

describe("HK Import Transfer Pairing", () => {
	const userId = "test-user-pairing";

	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	it("pairs transfers regardless of order (positive before negative)", async () => {
		const file = makeWorkbook({
			accounts: ["Cash", "Bank"],
			activities: [
				{ amount: "5000.0", account: "Cash" },
				{ amount: "-5000.0", account: "Bank" },
			],
		});

		const result = await importHysabKytab(file, userId);
		const txns = await db.transactions.where("userId").equals(userId).toArray();

		expect(result.transfersPaired).toBe(1);
		expect(result.transactions).toBe(1);
		expect(txns).toHaveLength(1);
		expect(txns[0]).toMatchObject({ type: "Transfer" });
		expect(txns[0]?.toAccountId).toBeDefined();
	});

	it("pairs transfers with empty dates using description similarity", async () => {
		const file = makeWorkbook({
			accounts: ["Savings", "Current"],
			activities: [
				{
					date: "",
					amount: "-10000.0",
					description: "Transfer to savings",
					account: "Current",
				},
				{
					date: "",
					amount: "10000.0",
					description: "Transfer to savings",
					account: "Savings",
				},
			],
		});

		const result = await importHysabKytab(file, userId);
		const txns = await db.transactions.where("userId").equals(userId).toArray();

		expect(result.transfersPaired).toBe(1);
		expect(result.transactions).toBe(1);
		expect(txns[0]?.toAccountId).toBeDefined();
	});

	it("uses account-name complements instead of same-day same-amount greedy pairing", async () => {
		const file = makeWorkbook({
			accounts: ["Cash", "Bank", "Wallet", "Savings"],
			activities: [
				{ date: "15/03/2024", amount: "-500.0", description: "Bank", account: "Cash" },
				{ date: "15/03/2024", amount: "-500.0", description: "Savings", account: "Wallet" },
				{ date: "15/03/2024", amount: "500.0", description: "Wallet", account: "Savings" },
				{ date: "15/03/2024", amount: "500.0", description: "Cash", account: "Bank" },
			],
		});

		const result = await importHysabKytab(file, userId);
		const [accounts, txns] = await Promise.all([
			db.accounts.where("userId").equals(userId).toArray(),
			db.transactions.where("userId").equals(userId).toArray(),
		]);
		const titleById = new Map(accounts.map((account) => [account.id, account.title]));
		const pairs = txns.map(
			(transaction) =>
				[
					titleById.get(transaction.accountId),
					titleById.get(transaction.toAccountId ?? ""),
				] as const
		);

		expect(result.transfersPaired).toBe(2);
		expect([...pairs].sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([
			["Cash", "Bank"],
			["Wallet", "Savings"],
		]);
	});

	it("keeps near-duplicate rows deterministic without reusing a counterpart", async () => {
		const file = makeWorkbook({
			accounts: ["Cash", "Bank", "Savings"],
			activities: [
				{ date: "10/04/2024", amount: "-250.0", description: "Bank", account: "Cash" },
				{ date: "10/04/2024", amount: "-250.0", description: "Bank", account: "Cash" },
				{ date: "10/04/2024", amount: "250.0", description: "Cash", account: "Bank" },
				{ date: "10/04/2024", amount: "250.0", description: "Cash near dup", account: "Savings" },
			],
		});

		const result = await importHysabKytab(file, userId);
		const txns = await db.transactions.where("userId").equals(userId).toArray();

		expect(result.transfersPaired).toBe(2);
		expect(txns).toHaveLength(2);
		expect(new Set(txns.map((transaction) => transaction.toAccountId)).size).toBe(2);
	});

	it("imports unmatched transfers as visible one-sided adjustments, never destination-less transfers", async () => {
		const file = makeWorkbook({
			accounts: ["Cash"],
			activities: [
				{
					date: "20/04/2024",
					amount: "-7500.0",
					description: "Orphan transfer out",
					account: "Cash",
				},
				{
					date: "21/04/2024",
					amount: "1500.0",
					description: "Orphan transfer in",
					account: "Cash",
				},
			],
		});

		const result = await importHysabKytab(file, userId);
		const txns = await db.transactions.where("userId").equals(userId).toArray();

		expect(result.transfersPaired).toBe(0);
		expect(result.unmatchedTransferAdjustments).toBe(2);
		expect(txns.map((txn) => txn.type).sort()).toEqual(["Expense", "Income"]);
		expect(txns.every((txn) => txn.toAccountId === undefined)).toBe(true);
		expect(txns.every((txn) => txn.description?.startsWith("[HK unmatched transfer]"))).toBe(true);
	});

	it("conserves imported money: balance changes equal income minus expenses and transfers net to zero", async () => {
		const file = makeWorkbook({
			accounts: ["Cash", "Bank", "Wallet", "Savings"],
			activities: [
				{ date: "01/05/2024", amount: "10000.0", account: "Cash", type: "Income" },
				{ date: "02/05/2024", amount: "-1200.0", account: "Cash", type: "Expense" },
				{ date: "03/05/2024", amount: "-500.0", description: "Bank", account: "Cash" },
				{ date: "03/05/2024", amount: "500.0", description: "Cash", account: "Bank" },
				{ date: "04/05/2024", amount: "-700.0", account: "Wallet" },
				{ date: "05/05/2024", amount: "300.0", account: "Savings" },
			],
		});

		await importHysabKytab(file, userId);
		const txns = await db.transactions.where("userId").equals(userId).toArray();

		expect(txns.filter((txn) => txn.type === "Transfer").every((txn) => txn.toAccountId)).toBe(
			true
		);
		expect(balanceChange(txns)).toBeCloseTo(incomeMinusExpense(txns), 2);
	});
});
