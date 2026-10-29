import { z } from "zod";

function requiredUuidSchema(requiredMessage: string, invalidMessage: string) {
	return z.preprocess(
		(value) => (value === "" ? undefined : value),
		z.string({ message: requiredMessage }).uuid(invalidMessage)
	);
}

function optionalUuidSchema(invalidMessage: string) {
	return z.preprocess(
		(value) => (value === "" ? undefined : value),
		z.string().uuid(invalidMessage).optional()
	);
}

const travelCurrencySchema = z.object({
	symbol: z.string().min(1, "Symbol is required"),
	rate: z.coerce.number().positive("Rate must be positive"),
	amount: z.coerce.number().positive("Amount must be positive"),
	location: z.string().min(1, "Location is required"),
});

const baseTransactionSchema = z.object({
	type: z.enum(["Expense", "Income", "Transfer"]),
	amount: z.coerce.number().positive("Amount must be greater than 0"),
	date: z.coerce.date({ message: "Valid date is required" }),
	accountId: requiredUuidSchema("Account is required", "Invalid account"),
	description: z.string().max(255).optional(),
	categoryId: optionalUuidSchema("Invalid category"),
	tags: z.array(z.string()).optional(),
	place: z.string().max(255).optional(),
	travelCurrency: travelCurrencySchema.optional(),
});

export const transactionSchema = baseTransactionSchema
	.extend({
		toAccountId: optionalUuidSchema("Invalid destination account"),
	})
	.refine(
		(data) => {
			if (data.type === "Transfer") {
				return !!data.toAccountId;
			}
			return true;
		},
		{ message: "Destination account is required for transfers", path: ["toAccountId"] }
	)
	.refine(
		(data) => {
			if (data.type === "Transfer" && data.toAccountId) {
				return data.toAccountId !== data.accountId;
			}
			return true;
		},
		{ message: "Source and destination accounts must be different", path: ["toAccountId"] }
	);

export type TransactionFormValues = z.infer<typeof transactionSchema>;

const MAX_RECURRENCE_INTERVAL = 99;
/** Mirrors MAX_RECURRENCE_OCCURRENCES in src/lib/recurrence.ts. */
const MAX_RECURRENCE_COUNT = 240;

export const recurrenceFrequencySchema = z.enum(["daily", "weekly", "monthly", "yearly"]);

/**
 * A repeat is only ever read off the form — occurrences are materialised immediately, so
 * nothing persists this shape. It still validates here so the drawer and the action agree
 * on what an expandable rule is.
 */
export const recurrenceRuleSchema = z
	.object({
		frequency: recurrenceFrequencySchema,
		interval: z.coerce
			.number()
			.int("Repeat interval must be a whole number")
			.min(1, "Repeat interval must be at least 1")
			.max(MAX_RECURRENCE_INTERVAL, `Repeat interval cannot exceed ${MAX_RECURRENCE_INTERVAL}`),
	})
	.and(
		z.discriminatedUnion("endMode", [
			z.object({
				endMode: z.literal("count"),
				count: z.coerce
					.number()
					.int("Number of transactions must be a whole number")
					.min(2, "Repeat for at least 2 transactions")
					.max(MAX_RECURRENCE_COUNT, `A series cannot exceed ${MAX_RECURRENCE_COUNT} transactions`),
			}),
			z.object({
				endMode: z.literal("until"),
				until: z.coerce.date({ message: "Valid end date is required" }),
			}),
		])
	);

export type RecurrenceRuleFormValues = z.infer<typeof recurrenceRuleSchema>;

export const bulkAmountModeSchema = z.enum(["set", "adjustAmount", "adjustPercent"]);

/**
 * Every field is optional on purpose: a bulk edit only writes what the owner explicitly
 * enabled, so an untouched field keeps whatever each selected transaction already had.
 * `clearCategory` and `clearPlace` exist because "set it to nothing" cannot be expressed
 * by an absent key when absence already means "leave alone".
 */
export const bulkTransactionEditSchema = z
	.object({
		amountMode: bulkAmountModeSchema.optional(),
		amountValue: z.coerce.number().optional(),
		categoryId: optionalUuidSchema("Invalid category"),
		clearCategory: z.boolean().optional(),
		accountId: optionalUuidSchema("Invalid account"),
		description: z.string().max(255).optional(),
		place: z.string().max(255).optional(),
		clearPlace: z.boolean().optional(),
		date: z.coerce.date({ message: "Valid date is required" }).optional(),
	})
	.refine((data) => data.amountMode === undefined || data.amountValue !== undefined, {
		message: "Enter an amount",
		path: ["amountValue"],
	})
	.refine(
		(data) => data.amountMode !== "set" || (data.amountValue !== undefined && data.amountValue > 0),
		{ message: "Amount must be greater than 0", path: ["amountValue"] }
	)
	.refine(
		(data) =>
			data.amountMode === undefined ||
			data.amountValue === undefined ||
			Number.isFinite(data.amountValue),
		{ message: "Enter a valid amount", path: ["amountValue"] }
	)
	.refine((data) => !(data.categoryId && data.clearCategory), {
		message: "Choose a category or clear it, not both",
		path: ["categoryId"],
	})
	.refine((data) => !(data.place && data.clearPlace), {
		message: "Enter a place or clear it, not both",
		path: ["place"],
	});

export type BulkTransactionEditValues = z.infer<typeof bulkTransactionEditSchema>;

/** True when a parsed bulk edit would not actually change anything. */
export function isEmptyBulkTransactionEdit(values: BulkTransactionEditValues): boolean {
	return (
		values.amountMode === undefined &&
		values.categoryId === undefined &&
		!values.clearCategory &&
		values.accountId === undefined &&
		values.description === undefined &&
		values.place === undefined &&
		!values.clearPlace &&
		values.date === undefined
	);
}
