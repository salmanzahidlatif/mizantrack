import { z } from "zod";

export const categorySchema = z.object({
	title: z.string().min(1, "Title is required").max(100, "Title must be 100 characters or less"),
	type: z.enum(["Income", "Expense"], { message: "Type must be Income or Expense" }),
	parentId: z.string().uuid("Invalid parent category").optional(),
	color: z.string().optional(),
	icon: z.string().optional(),
});

export type CategoryFormValues = z.infer<typeof categorySchema>;
