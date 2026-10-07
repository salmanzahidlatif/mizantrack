import fs from "fs";
import path from "path";

import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/local";
import {
	commitHysabKytabSqliteImport,
	prepareHysabKytabSqliteImport,
} from "@/lib/import/hysabKytabSqlite";
import { parseSourceId } from "@/lib/import/sourceId";

import type { Account, Transaction } from "@/types";

const USER_ID = "hk-sqlite-import-user";
const CURRENCY = "PKR";
const BACKUP_PATH = path.join(process.cwd(), "docs", "HK Backup - PKR.db");

type ImportedTransaction = Transaction & { currency?: string };

function readBackupFile(): File {
	expect(fs.existsSync(BACKUP_PATH)).toBe(true);
	const buffer = fs.readFileSync(BACKUP_PATH);
	return new File([new Uint8Array(buffer)], "HK Backup - PKR.db");
}

function roundMoney(value: number): number {
	return Math.round(value * 100) / 100;
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

async function snapshotImportedData(): Promise<string> {
	const [accounts, categories, transactions, budgets] = await Promise.all([
		db.accounts.where("userId").equals(USER_ID).toArray(),
		db.categories.where("userId").equals(USER_ID).toArray(),
		db.transactions.where("userId").equals(USER_ID).toArray(),
		db.budgets.where("userId").equals(USER_ID).toArray(),
	]);
	return stableStringify({
		accounts: accounts.sort((a, b) => a.id.localeCompare(b.id)),
		categories: categories.sort((a, b) => a.id.localeCompare(b.id)),
		transactions: transactions.sort((a, b) => a.id.localeCompare(b.id)),
		budgets: budgets.sort((a, b) => a.id.localeCompare(b.id)),
	});
}

function importedHkRecord(sourceId: string | undefined, entity: string): boolean {
	const parsed = sourceId ? parseSourceId(sourceId) : null;
	return parsed?.currency === CURRENCY && parsed.entity === entity;
}

function computeBalances(accounts: Account[], transactions: ImportedTransaction[]) {
	const accountById = new Map(accounts.map((account) => [account.id, account]));
	const balances = new Map(accounts.map((account) => [account.id, account.openingBalance]));

	for (const transaction of transactions) {
		if (transaction.deletedAt) continue;
		if (transaction.type === "Income") {
			balances.set(
				transaction.accountId,
				(balances.get(transaction.accountId) ?? 0) + transaction.amount
			);
		} else if (transaction.type === "Expense") {
			balances.set(
				transaction.accountId,
				(balances.get(transaction.accountId) ?? 0) - transaction.amount
			);
		} else {
			balances.set(
				transaction.accountId,
				(balances.get(transaction.accountId) ?? 0) - transaction.amount
			);
			expect(transaction.toAccountId).toBeDefined();
			const source = accountById.get(transaction.accountId);
			const destination = accountById.get(transaction.toAccountId!);
			if (!source || !destination || source.currency === destination.currency) {
				balances.set(
					transaction.toAccountId!,
					(balances.get(transaction.toAccountId!) ?? 0) + transaction.amount
				);
			}
		}
	}

	return balances;
}

beforeEach(async () => {
	await db.delete();
	await db.open();
	await db.dbConfig.put({
		id: USER_ID,
		currency: CURRENCY,
		fiscalYearStartMonth: 7,
		firebaseConfig: "",
		enabled: false,
		enabledCurrencies: [CURRENCY, "AED"],
	});
});

describe("Hysab Kytab SQLite import", () => {
	it("prepares the real backup without writing and surfaces the self-referencing transfer", async () => {
		const plan = await prepareHysabKytabSqliteImport(readBackupFile(), USER_ID, CURRENCY);

		expect(await db.accounts.where("userId").equals(USER_ID).count()).toBe(0);
		expect(plan.summary).toMatchObject({
			accounts: 58,
			categories: 73,
			activeVouchers: 9087,
			incomeRows: 830,
			expenseRows: 5428,
			transferLegs: 2829,
			transfersPaired: expect.any(Number),
			unresolvedTransfers: expect.any(Number),
			incomeTotal: 27960569.96,
			expenseTotal: 14840251.58,
			sourceTransferLegNet: 700,
			dateFormats: {
				"with-time": 7135,
				"date-only": 1038,
				parts: 914,
			},
		});
		expect(plan.unresolvedTransfers).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					voucherId: "1678442247",
					amount: 700,
					signedAmount: 700,
					accountTitle: "Meezan - Current",
					direction: "missing-source",
					reason: "REFNO points to this same voucher, so this is a single orphaned transfer leg.",
				}),
			])
		);
		await expect(
			commitHysabKytabSqliteImport(plan, {
				byVoucherId: { "1678442247": plan.unresolvedTransfers[0]!.accountId },
			})
		).rejects.toThrow("cannot use the same source and destination account");
	}, 30000);

	it("imports the real backup, reconciles control totals, conserves transfers, and stamps currency", async () => {
		const plan = await prepareHysabKytabSqliteImport(readBackupFile(), USER_ID, CURRENCY);
		const result = await commitHysabKytabSqliteImport(plan, {
			useReclassificationForAll: true,
		});

		expect(result).toMatchObject({
			accounts: 59,
			categories: 73,
			budgets: 180,
			transactions: 7673,
			transfersPaired: 1414,
			unresolvedTransfersResolved: 1,
			autoCreated: 1,
		});
		expect(result.autoCreatedAccounts).toEqual(["SadaPay Old"]);
		expect(result.verification.passed).toBe(true);
		expect(result.verification.sourceTransferLegNet).toBe(700);
		expect(result.verification.sourceTransferAnomalies).toEqual(
			expect.arrayContaining([expect.objectContaining({ voucherId: "1678442247", amount: 700 })])
		);
		expect(result.verification.expectedNetWorthDifference).toBe(0);
		expect(result.verification.expectedNetWorthDifferenceReason).toBeUndefined();
		expect(result.verification.reclassifiedUnpairedTransfers).toBe(1);
		expect(result.verification.reclassifiedIncomeDelta).toBe(700);
		expect(result.verification.reclassifiedExpenseDelta).toBe(0);
		expect(result.verification.reclassificationSummary).toContain(
			"1 unpaired transfer was reclassified at your instruction"
		);

		const [accounts, categories, transactions, budgets] = await Promise.all([
			db.accounts.where("userId").equals(USER_ID).toArray(),
			db.categories.where("userId").equals(USER_ID).toArray(),
			db.transactions.where("userId").equals(USER_ID).toArray() as Promise<ImportedTransaction[]>,
			db.budgets.where("userId").equals(USER_ID).toArray(),
		]);
		const importedAccounts = accounts.filter((account) =>
			importedHkRecord(account.sourceId, "account")
		);
		const importedCategories = categories.filter((category) =>
			importedHkRecord(category.sourceId, "category")
		);
		const importedTransactions = transactions.filter((transaction) =>
			importedHkRecord(transaction.sourceId, "voucher")
		);
		const importedBudgets = budgets.filter((budget) => importedHkRecord(budget.sourceId, "budget"));

		expect(importedAccounts).toHaveLength(59);
		expect(importedCategories).toHaveLength(73);
		expect(importedTransactions).toHaveLength(result.transactions);
		expect(importedBudgets).toHaveLength(180);
		expect(importedAccounts.every((account) => account.currency === CURRENCY)).toBe(true);
		expect(importedCategories.every((category) => category.currency === CURRENCY)).toBe(true);
		expect(importedTransactions.every((transaction) => transaction.currency === CURRENCY)).toBe(
			true
		);
		expect(importedBudgets.every((budget) => budget.currency === CURRENCY)).toBe(true);

		const income = importedTransactions
			.filter((transaction) => transaction.type === "Income")
			.reduce((sum, transaction) => sum + transaction.amount, 0);
		const expense = importedTransactions
			.filter((transaction) => transaction.type === "Expense")
			.reduce((sum, transaction) => sum + transaction.amount, 0);
		const transferTransactions = importedTransactions.filter(
			(transaction) => transaction.type === "Transfer"
		);
		const transferNet = transferTransactions.reduce(
			(sum, transaction) => sum - transaction.amount + transaction.amount,
			0
		);

		expect(roundMoney(income)).toBe(27961269.96);
		expect(roundMoney(expense)).toBe(14840251.58);
		expect(transferTransactions).toHaveLength(1414);
		expect(transferTransactions.every((transaction) => transaction.toAccountId)).toBe(true);
		expect(
			transferTransactions.every((transaction) => transaction.accountId !== transaction.toAccountId)
		).toBe(true);
		expect(roundMoney(transferNet)).toBe(0);

		const balances = computeBalances(accounts, importedTransactions);
		const accountByTitle = new Map(accounts.map((account) => [account.title, account]));
		expect(roundMoney(balances.get(accountByTitle.get("Cash")!.id) ?? 0)).toBe(14049);
		expect(roundMoney(balances.get(accountByTitle.get("Meezan - Saving")!.id) ?? 0)).toBe(15944.85);
		expect(roundMoney(balances.get(accountByTitle.get("Papa")!.id) ?? 0)).toBe(-474769.12);
		expect(accountByTitle.get("HK Unresolved Transfer Counterparty")).toBeUndefined();
		expect(roundMoney(balances.get(accountByTitle.get("Meezan - Current")!.id) ?? 0)).toBe(0.57);
	}, 30000);

	it("is idempotent when the same SQLite backup is imported again", async () => {
		const firstPlan = await prepareHysabKytabSqliteImport(readBackupFile(), USER_ID, CURRENCY);
		await commitHysabKytabSqliteImport(firstPlan, { useReclassificationForAll: true });
		const firstSnapshot = await snapshotImportedData();

		const secondPlan = await prepareHysabKytabSqliteImport(readBackupFile(), USER_ID, CURRENCY);
		const secondResult = await commitHysabKytabSqliteImport(secondPlan, {
			useReclassificationForAll: true,
		});
		const secondSnapshot = await snapshotImportedData();

		expect(secondResult.inserted).toBe(0);
		expect(secondResult.updated).toBe(0);
		expect(secondResult.verification.passed).toBe(true);
		expect(secondSnapshot).toBe(firstSnapshot);
	}, 30000);
});
