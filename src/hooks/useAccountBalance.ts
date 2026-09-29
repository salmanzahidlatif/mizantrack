import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/local";

import type { Account, Transaction } from "@/types";

function isKnownCrossCurrencyTransfer(
	transaction: Transaction,
	accountById: Map<string, Account>
): boolean {
	if (transaction.type !== "Transfer" || !transaction.toAccountId) return false;

	const sourceAccount = accountById.get(transaction.accountId);
	const destinationAccount = accountById.get(transaction.toAccountId);

	return Boolean(
		sourceAccount && destinationAccount && sourceAccount.currency !== destinationAccount.currency
	);
}

function hasInvalidTransferCounterparty(
	transaction: Transaction,
	accountById: Map<string, Account>
): boolean {
	return (
		transaction.type === "Transfer" &&
		(!transaction.toAccountId || !accountById.has(transaction.toAccountId))
	);
}

export function useAccountBalance(accountId: string, userId: string): number | undefined {
	return useLiveQuery(async () => {
		const account = await db.accounts.get(accountId);
		if (account?.userId !== userId) return 0;

		const transactions = await db.transactions
			.where("userId")
			.equals(userId)
			.filter((t) => !t.deletedAt && (t.accountId === accountId || t.toAccountId === accountId))
			.toArray();

		const referencedAccountIds = new Set<string>([accountId]);
		for (const transaction of transactions) {
			if (transaction.type !== "Transfer") continue;
			referencedAccountIds.add(transaction.accountId);
			if (transaction.toAccountId) referencedAccountIds.add(transaction.toAccountId);
		}
		const referencedAccounts = await db.accounts.bulkGet([...referencedAccountIds]);
		const accountById = new Map<string, Account>();
		for (const referencedAccount of referencedAccounts) {
			if (referencedAccount) accountById.set(referencedAccount.id, referencedAccount);
		}

		let balance = account.openingBalance;
		for (const t of transactions) {
			if (t.type === "Income" && t.accountId === accountId) {
				balance += t.amount;
			} else if (t.type === "Expense" && t.accountId === accountId) {
				balance -= t.amount;
			} else if (t.type === "Transfer") {
				if (hasInvalidTransferCounterparty(t, accountById)) continue;

				const isCrossCurrency = isKnownCrossCurrencyTransfer(t, accountById);
				if (t.accountId === accountId) {
					balance -= t.amount; // source
				} else if (t.toAccountId === accountId) {
					if (isCrossCurrency) {
						// `amount` is stored in the source account currency. Without a transfer FX
						// amount/rate for the destination currency, adding it would corrupt this balance.
						continue;
					}
					balance += t.amount; // destination
				}
			}
		}

		return balance;
	}, [accountId, userId]);
}
