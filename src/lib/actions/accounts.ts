import { v4 as uuidv4 } from "uuid";

import { invalidateAnalyticsCache } from "@/lib/analytics/cache";
import { recomputeAnalyticsNow } from "@/lib/analytics/scheduleRecompute";
import { db } from "@/lib/db/local";
import { accountSchema, type AccountFormValues } from "@/lib/validations/account";

import type { Account } from "@/types";

function parseAccount(values: unknown): AccountFormValues {
	const result = accountSchema.safeParse(values);
	if (!result.success) {
		throw new Error(result.error.issues[0]?.message ?? "Please check the account details.");
	}
	return result.data;
}

export async function createAccount(
	userId: string,
	values: AccountFormValues,
	options?: { id?: string }
): Promise<string> {
	const parsed = parseAccount(values);
	const id = options?.id ?? uuidv4();
	await invalidateAnalyticsCache(userId);
	await db.accounts.put({
		id,
		userId,
		isArchived: false,
		updatedAt: Date.now(),
		...parsed,
	});
	await recomputeAnalyticsNow(userId);
	return id;
}

export async function updateAccount(
	userId: string,
	accountId: string,
	values: AccountFormValues
): Promise<void> {
	const parsed = parseAccount(values);
	await invalidateAnalyticsCache(userId);
	const updated = await db.accounts.update(accountId, { ...parsed, updatedAt: Date.now() });
	if (updated === 0) {
		throw new Error("Account was not found. Please reload and try again.");
	}
	await recomputeAnalyticsNow(userId);
}

export async function setAccountArchived(account: Account, isArchived: boolean): Promise<void> {
	await invalidateAnalyticsCache(account.userId);
	const updated = await db.accounts.update(account.id, {
		isArchived,
		updatedAt: Date.now(),
	});
	if (updated === 0) {
		throw new Error("Account was not found. Please reload and try again.");
	}
	await recomputeAnalyticsNow(account.userId);
}

export async function deleteAccount(account: Account): Promise<void> {
	await invalidateAnalyticsCache(account.userId);
	const updated = await db.accounts.update(account.id, {
		deletedAt: Date.now(),
		updatedAt: Date.now(),
	});
	if (updated === 0) {
		throw new Error("Account was not found. Please reload and try again.");
	}
	await recomputeAnalyticsNow(account.userId);
}
