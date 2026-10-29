import { v4 as uuidv4 } from "uuid";

import { scheduleAnalyticsRecompute } from "@/lib/analytics/scheduleRecompute";
import { db } from "@/lib/db/local";
import { generateRecurrenceTimestamps } from "@/lib/recurrence";
import {
	bulkTransactionEditSchema,
	isEmptyBulkTransactionEdit,
	transactionSchema,
	type BulkTransactionEditValues,
	type TransactionFormValues,
} from "@/lib/validations/transaction";

import type { RecurrenceEditScope, RecurrenceRule, Transaction } from "@/types";

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

// The analytics recompute reads every transaction, so it is queued after the
// Dexie write instead of being awaited. Callers that need fresh analytics can
// await `flushAnalyticsRecompute(userId)`.
function recomputeAfterLocalWrite(userId: string): void {
	scheduleAnalyticsRecompute(userId);
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
	recomputeAfterLocalWrite(userId);
	return id;
}

export interface CreateRecurringTransactionsResult {
	recurrenceId: string;
	transactionIds: string[];
}

/**
 * Writes every occurrence of a repeat as a real transaction, sharing one `recurrenceId`.
 * Materialising instead of storing a rule means budgets, analytics and zakat need no
 * knowledge of recurrence at all — they already read transactions.
 *
 * The form's own date is the first occurrence, so a repeat never silently drops it.
 */
export async function createRecurringTransactions(
	userId: string,
	values: TransactionFormValues,
	rule: RecurrenceRule
): Promise<CreateRecurringTransactionsResult> {
	const parsed = validationErrorMessage(values);
	const startDate = parsed.date instanceof Date ? parsed.date : new Date(parsed.date);
	const timestamps = generateRecurrenceTimestamps(startDate, rule);

	if (timestamps.length === 0) {
		throw new Error("This repeat does not produce any transactions. Check the dates and count.");
	}

	const recurrenceId = uuidv4();
	const payload = toTransactionPayload(userId, parsed);
	const records: Transaction[] = timestamps.map((date) => ({
		...payload,
		id: uuidv4(),
		date,
		recurrenceId,
	}));

	await withTimeout(
		db.transactions.bulkPut(records),
		LOCAL_TRANSACTION_WRITE_TIMEOUT_MS,
		"Saving the repeating transactions is taking too long. Close other MizanTrack tabs and try again."
	);
	recomputeAfterLocalWrite(userId);

	return { recurrenceId, transactionIds: records.map((record) => record.id) };
}

/**
 * Resolves which members of a series an edit reaches. "future" is measured from the
 * anchor transaction's own date so a back-dated occurrence never sweeps up its elders.
 */
export async function loadRecurrenceSeriesIds(
	userId: string,
	transactionId: string,
	scope: RecurrenceEditScope
): Promise<string[]> {
	if (scope === "single") return [transactionId];

	const anchor = await db.transactions.get(transactionId);
	if (!anchor?.recurrenceId || anchor.userId !== userId) return [transactionId];

	const members = await db.transactions
		.where("[userId+recurrenceId]")
		.equals([userId, anchor.recurrenceId])
		.filter((txn) => !txn.deletedAt)
		.toArray();
	const inScope = scope === "series" ? members : members.filter((txn) => txn.date >= anchor.date);
	const ids = inScope.map((txn) => txn.id);

	return ids.includes(transactionId) ? ids : [transactionId, ...ids];
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

	recomputeAfterLocalWrite(userId);
}

/**
 * Applies one form's values to several occurrences of a series at once. Each target keeps
 * its own date — moving every occurrence onto the anchor's day would collapse the series
 * into a single day, which is never what "apply to the whole series" means.
 */
export async function updateTransactionSeries(
	userId: string,
	transactionIds: string[],
	values: TransactionFormValues
): Promise<number> {
	const parsed = validationErrorMessage(values);
	const anchorPayload = toTransactionPayload(userId, parsed);
	const anchorDate = anchorPayload.date;

	const updated = await withTimeout(
		db.transaction("rw", db.transactions, async () => {
			const existing = await db.transactions.bulkGet(transactionIds);
			const records: Transaction[] = [];

			for (const txn of existing) {
				if (txn?.userId !== userId || txn.deletedAt) continue;
				records.push({
					...anchorPayload,
					id: txn.id,
					// Only the occurrence the owner opened takes the new date; the rest hold
					// their place in the series and inherit every other edited field.
					date: txn.id === transactionIds[0] ? anchorDate : txn.date,
					recurrenceId: txn.recurrenceId,
				});
			}

			if (records.length === 0) return 0;
			await db.transactions.bulkPut(records);
			return records.length;
		}),
		LOCAL_TRANSACTION_WRITE_TIMEOUT_MS,
		"Updating the transactions is taking too long. Close other MizanTrack tabs and try again."
	);

	if (updated === 0) {
		throw new Error("Those transactions were not found. Please reload and try again.");
	}

	recomputeAfterLocalWrite(userId);
	return updated;
}

function roundCurrency(amount: number): number {
	return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function applyBulkAmount(amount: number, values: BulkTransactionEditValues): number {
	if (values.amountMode === undefined || values.amountValue === undefined) return amount;
	if (values.amountMode === "set") return roundCurrency(values.amountValue);
	if (values.amountMode === "adjustAmount") return roundCurrency(amount + values.amountValue);
	return roundCurrency(amount * (1 + values.amountValue / 100));
}

/**
 * Builds the record a single transaction becomes under a bulk edit, or null when the edit
 * leaves it untouched. Kept pure so the rules are testable without Dexie.
 */
export function buildBulkTransactionPatch(
	transaction: Transaction,
	values: BulkTransactionEditValues,
	now: number
): Transaction | null {
	const next: Transaction = { ...transaction, updatedAt: now };
	let changed = false;

	const amount = applyBulkAmount(transaction.amount, values);
	if (amount !== transaction.amount) {
		if (!(amount > 0)) {
			throw new Error(
				"That change would make at least one amount zero or negative. Amounts must stay above 0."
			);
		}
		next.amount = amount;
		changed = true;
	}

	if (values.accountId && values.accountId !== transaction.accountId) {
		if (transaction.type === "Transfer" && transaction.toAccountId === values.accountId) {
			throw new Error(
				"At least one transfer already uses that account as its destination. A transfer cannot move money to itself."
			);
		}
		next.accountId = values.accountId;
		changed = true;
	}

	// A transfer has no category by definition, so a category edit passes over it rather
	// than failing the whole batch when a mixed selection is edited.
	if (transaction.type !== "Transfer") {
		if (values.clearCategory && transaction.categoryId !== undefined) {
			delete next.categoryId;
			changed = true;
		} else if (values.categoryId && values.categoryId !== transaction.categoryId) {
			next.categoryId = values.categoryId;
			changed = true;
		}
	}

	// An emptied description means "clear it", not "store an empty string" — a row whose
	// description is "" would render with a blank label instead of falling back to its
	// place or category.
	if (values.description !== undefined) {
		const description = values.description.trim();
		if (description === "") {
			if (transaction.description !== undefined) {
				delete next.description;
				changed = true;
			}
		} else if (description !== transaction.description) {
			next.description = description;
			changed = true;
		}
	}

	if (values.clearPlace && transaction.place !== undefined) {
		delete next.place;
		changed = true;
	} else if (values.place !== undefined && values.place !== transaction.place) {
		next.place = values.place;
		changed = true;
	}

	if (values.date) {
		const date = values.date.getTime();
		if (date !== transaction.date) {
			next.date = date;
			changed = true;
		}
	}

	return changed ? next : null;
}

/**
 * Edits many transactions in one pass — the "every monthly rent row at once" case.
 * Validation runs before anything is written, so a selection that cannot be applied
 * cleanly leaves every record as it was rather than half-updated.
 */
export async function bulkUpdateTransactions(
	userId: string,
	transactionIds: string[],
	values: unknown
): Promise<number> {
	const parsed = bulkTransactionEditSchema.safeParse(values);
	if (!parsed.success) {
		throw new Error(parsed.error.issues[0]?.message ?? "Please check the bulk edit details.");
	}
	if (transactionIds.length === 0) {
		throw new Error("Select at least one transaction to edit.");
	}
	if (isEmptyBulkTransactionEdit(parsed.data)) {
		throw new Error("Choose at least one field to change.");
	}

	const updated = await withTimeout(
		db.transaction("rw", db.transactions, async () => {
			const existing = await db.transactions.bulkGet(transactionIds);
			const now = Date.now();
			const records: Transaction[] = [];

			for (const txn of existing) {
				if (txn?.userId !== userId || txn.deletedAt) continue;
				const patched = buildBulkTransactionPatch(txn, parsed.data, now);
				if (patched) records.push(patched);
			}

			if (records.length === 0) return 0;
			await db.transactions.bulkPut(records);
			return records.length;
		}),
		LOCAL_TRANSACTION_WRITE_TIMEOUT_MS,
		"Updating the transactions is taking too long. Close other MizanTrack tabs and try again."
	);

	recomputeAfterLocalWrite(userId);
	return updated;
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

	recomputeAfterLocalWrite(userId);
}

/** Tombstones many transactions at once so the deletions still reach other devices. */
export async function bulkDeleteTransactions(
	userId: string,
	transactionIds: string[]
): Promise<number> {
	if (transactionIds.length === 0) {
		throw new Error("Select at least one transaction to delete.");
	}

	const deleted = await withTimeout(
		db.transaction("rw", db.transactions, async () => {
			const existing = await db.transactions.bulkGet(transactionIds);
			const now = Date.now();
			const records = existing
				.filter((txn): txn is Transaction => Boolean(txn) && txn?.userId === userId)
				.filter((txn) => !txn.deletedAt)
				.map((txn) => ({ ...txn, deletedAt: now, updatedAt: now }));

			if (records.length === 0) return 0;
			await db.transactions.bulkPut(records);
			return records.length;
		}),
		LOCAL_TRANSACTION_WRITE_TIMEOUT_MS,
		"Deleting the transactions is taking too long. Close other MizanTrack tabs and try again."
	);

	recomputeAfterLocalWrite(userId);
	return deleted;
}
