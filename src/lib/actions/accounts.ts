import { v4 as uuidv4 } from "uuid";

import { scheduleAnalyticsRecompute } from "@/lib/analytics/scheduleRecompute";
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

// The analytics recompute reads every transaction, so it is queued after the
// Dexie write instead of being awaited. Callers that need fresh analytics can
// await `flushAnalyticsRecompute(userId)`.
function recomputeAfterLocalWrite(userId: string): void {
	scheduleAnalyticsRecompute(userId);
}

export async function createAccount(
	userId: string,
	values: AccountFormValues,
	options?: { id?: string }
): Promise<string> {
	const parsed = parseAccount(values);
	const id = options?.id ?? uuidv4();
	await db.accounts.put({
		id,
		userId,
		isArchived: false,
		updatedAt: Date.now(),
		...parsed,
	});
	recomputeAfterLocalWrite(userId);
	return id;
}

export async function updateAccount(
	userId: string,
	accountId: string,
	values: AccountFormValues
): Promise<void> {
	const parsed = parseAccount(values);
	const updated = await db.accounts.update(accountId, { ...parsed, updatedAt: Date.now() });
	if (updated === 0) {
		throw new Error("Account was not found. Please reload and try again.");
	}
	recomputeAfterLocalWrite(userId);
}

export async function setAccountArchived(account: Account, isArchived: boolean): Promise<void> {
	const updated = await db.accounts.update(account.id, {
		isArchived,
		updatedAt: Date.now(),
	});
	if (updated === 0) {
		throw new Error("Account was not found. Please reload and try again.");
	}
	recomputeAfterLocalWrite(account.userId);
}

export async function deleteAccount(account: Account): Promise<void> {
	const updated = await db.accounts.update(account.id, {
		deletedAt: Date.now(),
		updatedAt: Date.now(),
	});
	if (updated === 0) {
		throw new Error("Account was not found. Please reload and try again.");
	}
	recomputeAfterLocalWrite(account.userId);
}
