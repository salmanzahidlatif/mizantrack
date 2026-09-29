import { scheduleAnalyticsRecompute } from "@/lib/analytics/scheduleRecompute";
import { db } from "@/lib/db/local";

import type { Account, Transaction } from "@/types";

const OPENING_BALANCE_MATCH_TOLERANCE = 0.01;

export interface TransferIntegrityAccountImpact {
	accountId: string;
	title: string;
	currency: string;
	count: number;
	total: number;
	legacyBalance: number;
	correctedBalance: number;
	openingBalance: number;
}

export interface TransferIntegrityOpeningBalanceWarning {
	accountId: string;
	title: string;
	currency: string;
	openingBalance: number;
	invalidTransferTotal: number;
}

export interface TransferIntegrityReport {
	invalidTransferCount: number;
	missingDestinationCount: number;
	unresolvableDestinationCount: number;
	totalInvalidValue: number;
	accounts: TransferIntegrityAccountImpact[];
	openingBalanceWarnings: TransferIntegrityOpeningBalanceWarning[];
}

export interface RepairInvalidTransfersResult {
	repaired: number;
	accountsAffected: number;
}

function isInvalidTransfer(transaction: Transaction, accountById: Map<string, Account>): boolean {
	return (
		transaction.type === "Transfer" &&
		(!transaction.toAccountId || !accountById.has(transaction.toAccountId))
	);
}

function computeCorrectedBalances(
	accounts: Account[],
	transactions: Transaction[],
	accountById: Map<string, Account>
): Map<string, number> {
	const balances = new Map(accounts.map((account) => [account.id, account.openingBalance]));

	for (const transaction of transactions) {
		if (transaction.deletedAt || !accountById.has(transaction.accountId)) continue;

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
		} else if (transaction.type === "Transfer") {
			if (isInvalidTransfer(transaction, accountById)) continue;

			const source = accountById.get(transaction.accountId);
			const destination = accountById.get(transaction.toAccountId!);
			balances.set(
				transaction.accountId,
				(balances.get(transaction.accountId) ?? 0) - transaction.amount
			);

			if (source?.currency === destination?.currency) {
				balances.set(
					transaction.toAccountId!,
					(balances.get(transaction.toAccountId!) ?? 0) + transaction.amount
				);
			}
		}
	}

	return balances;
}

function isLikelyOpeningBalanceWorkaround(account: Account, invalidTotal: number): boolean {
	if (invalidTotal <= 0) return false;
	return (
		Math.abs(Math.abs(account.openingBalance) - invalidTotal) <= OPENING_BALANCE_MATCH_TOLERANCE
	);
}

export async function getTransferIntegrityReport(userId: string): Promise<TransferIntegrityReport> {
	const [rawAccounts, rawTransactions] = await Promise.all([
		db.accounts.where("userId").equals(userId).toArray(),
		db.transactions.where("userId").equals(userId).toArray(),
	]);
	const accounts = rawAccounts.filter((account) => !account.deletedAt);
	const accountById = new Map(accounts.map((account) => [account.id, account]));
	const transactions = rawTransactions.filter((transaction) => !transaction.deletedAt);
	const correctedBalances = computeCorrectedBalances(accounts, transactions, accountById);
	const impacts = new Map<
		string,
		{
			count: number;
			total: number;
		}
	>();
	let missingDestinationCount = 0;
	let unresolvableDestinationCount = 0;

	for (const transaction of transactions) {
		if (!accountById.has(transaction.accountId) || !isInvalidTransfer(transaction, accountById)) {
			continue;
		}

		if (transaction.toAccountId) {
			unresolvableDestinationCount++;
		} else {
			missingDestinationCount++;
		}

		const current = impacts.get(transaction.accountId) ?? { count: 0, total: 0 };
		current.count++;
		current.total += transaction.amount;
		impacts.set(transaction.accountId, current);
	}

	const accountImpacts = [...impacts.entries()]
		.map(([accountId, impact]) => {
			const account = accountById.get(accountId)!;
			const correctedBalance = correctedBalances.get(accountId) ?? account.openingBalance;
			return {
				accountId,
				title: account.title,
				currency: account.currency,
				count: impact.count,
				total: impact.total,
				legacyBalance: correctedBalance - impact.total,
				correctedBalance,
				openingBalance: account.openingBalance,
			};
		})
		.sort((a, b) => b.total - a.total || a.title.localeCompare(b.title));

	const openingBalanceWarnings = accountImpacts
		.filter((impact) => {
			const account = accountById.get(impact.accountId);
			return account ? isLikelyOpeningBalanceWorkaround(account, impact.total) : false;
		})
		.map((impact) => ({
			accountId: impact.accountId,
			title: impact.title,
			currency: impact.currency,
			openingBalance: impact.openingBalance,
			invalidTransferTotal: impact.total,
		}));

	return {
		invalidTransferCount: missingDestinationCount + unresolvableDestinationCount,
		missingDestinationCount,
		unresolvableDestinationCount,
		totalInvalidValue: accountImpacts.reduce((sum, impact) => sum + impact.total, 0),
		accounts: accountImpacts,
		openingBalanceWarnings,
	};
}

export async function repairInvalidTransferRecords(
	userId: string
): Promise<RepairInvalidTransfersResult> {
	const report = await getTransferIntegrityReport(userId);
	if (report.invalidTransferCount === 0) {
		return { repaired: 0, accountsAffected: 0 };
	}

	const accounts = await db.accounts.where("userId").equals(userId).toArray();
	const accountById = new Map(
		accounts.filter((account) => !account.deletedAt).map((account) => [account.id, account])
	);
	const transactions = await db.transactions.where("userId").equals(userId).toArray();
	const invalidTransfers = transactions.filter(
		(transaction) =>
			!transaction.deletedAt &&
			accountById.has(transaction.accountId) &&
			isInvalidTransfer(transaction, accountById)
	);
	const now = Date.now();

	await db.transaction("rw", db.transactions, async () => {
		for (const transaction of invalidTransfers) {
			await db.transactions.update(transaction.id, {
				deletedAt: now,
				updatedAt: now,
			});
		}
	});

	if (invalidTransfers.length > 0) {
		scheduleAnalyticsRecompute(userId);
	}

	return {
		repaired: invalidTransfers.length,
		accountsAffected: report.accounts.length,
	};
}
