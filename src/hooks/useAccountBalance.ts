import { useLiveQuery } from "dexie-react-hooks";

import { computeAccountBalances } from "@/lib/analytics/balanceMath";
import { db } from "@/lib/db/local";

import type { Account } from "@/types";

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

		const { balances } = computeAccountBalances(userId, [...accountById.values()], transactions);

		return balances.get(accountId) ?? account.openingBalance;
	}, [accountId, userId]);
}
