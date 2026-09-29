import { v4 as uuidv4 } from "uuid";

import { recomputeAnalyticsNow } from "@/lib/analytics/scheduleRecompute";
import { db } from "@/lib/db/local";
import { transactionSchema, type TransactionFormValues } from "@/lib/validations/transaction";

import type { Transaction } from "@/types";

export const LOCAL_TRANSACTION_WRITE_TIMEOUT_MS = 10_000;

function validationErrorMessage(values: unknown): TransactionFormValues {
	const result = transactionSchema.safeParse(values);
	if (!result.success) {
		throw new Error(result.error.issues[0]?.message ?? "Please check the transaction details.");
	}
	return result.data;
}

function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timeoutId = setTimeout(() => {
			reject(new Error(message));
		}, timeoutMs);
	});

	return Promise.race([operation, timeout]).finally(() => {
		if (timeoutId) clearTimeout(timeoutId);
	});
}

function toTransactionPayload(
	userId: string,
	values: TransactionFormValues
): Omit<Transaction, "id"> {
	const now = Date.now();

	return {
		...values,
		userId,
		date: values.date instanceof Date ? values.date.getTime() : Number(values.date),
		updatedAt: now,
		toAccountId: values.type === "Transfer" ? values.toAccountId : undefined,
		categoryId: values.type === "Transfer" ? undefined : values.categoryId,
	};
}

async function recomputeAfterLocalWrite(userId: string): Promise<void> {
	await recomputeAnalyticsNow(userId);
}

export async function createTransaction(
	userId: string,
	values: TransactionFormValues,
	options?: { id?: string }
): Promise<string> {
	const parsed = validationErrorMessage(values);
	const id = options?.id ?? uuidv4();
	await withTimeout(
		db.transactions.put({ id, ...toTransactionPayload(userId, parsed) }),
		LOCAL_TRANSACTION_WRITE_TIMEOUT_MS,
		"Saving the transaction is taking too long. Close other MizanTrack tabs and try again."
	);
	await recomputeAfterLocalWrite(userId);
	return id;
}

export async function updateTransaction(
	userId: string,
	transactionId: string,
	values: TransactionFormValues
): Promise<void> {
	const parsed = validationErrorMessage(values);
	const updated = await withTimeout(
		db.transactions.update(transactionId, toTransactionPayload(userId, parsed)),
		LOCAL_TRANSACTION_WRITE_TIMEOUT_MS,
		"Updating the transaction is taking too long. Close other MizanTrack tabs and try again."
	);

	if (updated === 0) {
		throw new Error("Transaction was not found. Please reload and try again.");
	}

	await recomputeAfterLocalWrite(userId);
}

export async function deleteTransaction(userId: string, transactionId: string): Promise<void> {
	const now = Date.now();
	const updated = await withTimeout(
		db.transactions.update(transactionId, {
			deletedAt: now,
			updatedAt: now,
		}),
		LOCAL_TRANSACTION_WRITE_TIMEOUT_MS,
		"Deleting the transaction is taking too long. Close other MizanTrack tabs and try again."
	);

	if (updated === 0) {
		throw new Error("Transaction was not found. Please reload and try again.");
	}

	await recomputeAfterLocalWrite(userId);
}
