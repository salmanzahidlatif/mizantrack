import { useLiveQuery } from "dexie-react-hooks";

import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { db } from "@/lib/db/local";

import type { Account } from "@/types";

export interface AccountFilters {
	/** When provided, only accounts with this currency code are returned. */
	currency?: string;
	/** When true, archived accounts are included. Default false. */
	showArchived?: boolean;
}

export function useAccounts(userId: string, filters?: AccountFilters): Account[] | undefined {
	const currency = normalizeCurrencyCode(filters?.currency);
	const showArchived = filters?.showArchived ?? false;

	return useLiveQuery(
		() =>
			db.accounts
				.where("userId")
				.equals(userId)
				.filter((a) => {
					if (a.deletedAt) return false;
					if (!showArchived && a.isArchived) return false;
					if (currency) {
						const accountCurrency = normalizeCurrencyCode(a.currency);
						if (accountCurrency !== currency) return false;
					}
					return true;
				})
				.toArray(),
		[userId, currency, showArchived]
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
