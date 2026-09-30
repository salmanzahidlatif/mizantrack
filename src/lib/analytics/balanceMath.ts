import type { Account, Transaction } from "@/types";

export type BalanceWarningCode =
	| "cross_currency_transfer_destination_skipped"
	| "invalid_transfer_counterparty_skipped";

export interface BalanceWarning {
	code: BalanceWarningCode;
	transactionId: string;
	message: string;
}

export interface AccountBalanceComputation {
	accounts: Account[];
	accountById: Map<string, Account>;
	balances: Map<string, number>;
	warnings: BalanceWarning[];
}

export interface AccountBalanceOptions {
	asOfMs?: number;
}

export function normalizeCurrencyCode(currency: string | undefined): string {
	return (currency ?? "").trim().toUpperCase();
}

export function getActiveUserAccounts(userId: string, accounts: Account[]): Account[] {
	return accounts.filter((account) => account.userId === userId && !account.deletedAt);
}

function getCrossCurrencyTransferWarning(transaction: Transaction): BalanceWarning {
	return {
		code: "cross_currency_transfer_destination_skipped",
		transactionId: transaction.id,
		message:
			"Cross-currency transfer used the stored source amount for the destination balance to preserve legacy balance arithmetic; review or repair it if an FX amount is available.",
	};
}

function getInvalidTransferCounterpartyWarning(transaction: Transaction): BalanceWarning {
	return {
		code: "invalid_transfer_counterparty_skipped",
		transactionId: transaction.id,
		message:
			"Transfer destination is missing or deleted; the source account was still debited to preserve legacy balance arithmetic.",
	};
}

export function computeAccountBalances(
	userId: string,
	accounts: Account[],
	transactions: Transaction[],
	options: AccountBalanceOptions = {}
): AccountBalanceComputation {
	const activeAccounts = getActiveUserAccounts(userId, accounts);
	const accountById = new Map(activeAccounts.map((account) => [account.id, account]));
	const balances = new Map(activeAccounts.map((account) => [account.id, account.openingBalance]));
	const warnings: BalanceWarning[] = [];

	for (const transaction of transactions) {
		if (transaction.userId !== userId || transaction.deletedAt) continue;
		if (options.asOfMs !== undefined && transaction.date > options.asOfMs) continue;

		if (transaction.type === "Income") {
			const balance = balances.get(transaction.accountId);
			if (balance !== undefined) balances.set(transaction.accountId, balance + transaction.amount);
			continue;
		}

		if (transaction.type === "Expense") {
			const balance = balances.get(transaction.accountId);
			if (balance !== undefined) balances.set(transaction.accountId, balance - transaction.amount);
			continue;
		}

		const sourceAccount = accountById.get(transaction.accountId);
		const destinationAccount = transaction.toAccountId
			? accountById.get(transaction.toAccountId)
			: undefined;

		if (!destinationAccount) {
			warnings.push(getInvalidTransferCounterpartyWarning(transaction));
		} else if (
			sourceAccount &&
			normalizeCurrencyCode(sourceAccount.currency) !==
				normalizeCurrencyCode(destinationAccount.currency)
		) {
			warnings.push(getCrossCurrencyTransferWarning(transaction));
		}

		const sourceBalance = balances.get(transaction.accountId);
		if (sourceBalance !== undefined) {
			balances.set(transaction.accountId, sourceBalance - transaction.amount);
		}

		if (transaction.toAccountId) {
			const destinationBalance = balances.get(transaction.toAccountId);
			if (destinationBalance !== undefined) {
				balances.set(transaction.toAccountId, destinationBalance + transaction.amount);
			}
		}
	}

	return {
		accounts: activeAccounts,
		accountById,
		balances,
		warnings,
	};
}

export function accountBalancesToRecord(balances: Map<string, number>): Record<string, number> {
	return Object.fromEntries(balances.entries());
}
