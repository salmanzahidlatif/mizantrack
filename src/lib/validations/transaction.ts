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
