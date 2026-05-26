import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db/local";

import type { Account } from "@/types";

export function useAccounts(userId: string): Account[] | undefined {
	return useLiveQuery(
		() =>
			db.accounts
				.where("userId")
				.equals(userId)
				.filter((a) => !a.deletedAt)
				.toArray(),
		[userId]
	);
}

export function useActiveAccounts(userId: string): Account[] | undefined {
	return useLiveQuery(
		() =>
			db.accounts
				.where("userId")
				.equals(userId)
				.filter((a) => !a.deletedAt && !a.isArchived)
				.toArray(),
		[userId]
	);
}
