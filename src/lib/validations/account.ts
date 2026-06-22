import { z } from "zod";

export const accountSchema = z.object({
	title: z.string().min(1, "Title is required").max(100, "Title must be 100 characters or less"),
	currency: z.string().length(3, "Currency must be a 3-character ISO code").toUpperCase(),
	openingBalance: z.coerce.number().default(0),
	color: z.string().optional(),
	icon: z.string().optional(),
});

export type AccountFormValues = z.infer<typeof accountSchema>;
