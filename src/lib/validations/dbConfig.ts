import { z } from "zod";

export const firebaseConfigSchema = z.object({
	apiKey: z.string().min(1, "apiKey is required"),
	authDomain: z.string().min(1, "authDomain is required"),
	projectId: z.string().min(1, "projectId is required"),
	storageBucket: z.string().optional(),
	messagingSenderId: z.string().optional(),
	appId: z.string().optional(),
});

export const dbConfigSchema = z.object({
	currency: z.string().length(3, "Currency must be a 3-character ISO code").toUpperCase(),
	fiscalYearStartMonth: z
		.number()
		.int()
		.min(1, "Month must be between 1 and 12")
		.max(12, "Month must be between 1 and 12"),
	firebaseConfig: z
		.string()
		.optional()
		.refine(
			(val) => {
				if (!val) return true;
				try {
					const parsed = JSON.parse(val);
					return firebaseConfigSchema.safeParse(parsed).success;
				} catch {
					return false;
				}
			},
			{ message: "Invalid Firebase config JSON. Must include apiKey, authDomain, and projectId." }
		),
	enabled: z.boolean(),
});

export type DbConfigFormValues = z.infer<typeof dbConfigSchema>;
