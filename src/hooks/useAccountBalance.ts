import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/local";

export function useAccountBalance(accountId: string, userId: string): number | undefined {
	return useLiveQuery(async () => {
		const account = await db.accounts.get(accountId);
		if (account?.userId !== userId) return 0;

		const transactions = await db.transactions
			.where("userId")
			.equals(userId)
			.filter((t) => !t.deletedAt && (t.accountId === accountId || t.toAccountId === accountId))
			.toArray();

		let balance = account.openingBalance;
		for (const t of transactions) {
			if (t.type === "Income" && t.accountId === accountId) {
				balance += t.amount;
			} else if (t.type === "Expense" && t.accountId === accountId) {
				balance -= t.amount;
			} else if (t.type === "Transfer") {
				if (t.accountId === accountId) {
					balance -= t.amount; // source
				} else if (t.toAccountId === accountId) {
					balance += t.amount; // destination
				}
			}
		}

		return balance;
	}, [accountId, userId]);
}
