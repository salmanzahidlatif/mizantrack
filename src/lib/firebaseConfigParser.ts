import { firebaseConfigSchema } from "@/lib/validations/dbConfig";

export interface FieldError {
	field: string;
	message: string;
	wizardStep: number;
}

export type ParseFirebaseConfigResult =
	| { valid: true; value: FirebaseConfigFields }
	| { valid: false; errors: FieldError[] };

export interface FirebaseConfigFields {
	apiKey: string;
	authDomain: string;
	projectId: string;
	storageBucket?: string;
	messagingSenderId?: string;
	appId?: string;
}

const FIELD_STEP_MAP: Record<string, number> = {
	apiKey: 2,
	authDomain: 2,
	projectId: 2,
	storageBucket: 2,
	messagingSenderId: 2,
	appId: 2,
};

const FIELD_HINTS: Record<string, string> = {
	apiKey: 'Copy "apiKey" from your Firebase SDK config snippet.',
	authDomain: 'Copy "authDomain" from your Firebase SDK config snippet.',
	projectId: 'Copy "projectId" from your Firebase SDK config snippet.',
};

export function parseFirebaseConfigJson(raw: string): ParseFirebaseConfigResult {
	if (!raw.trim()) {
		return {
			valid: false,
			errors: [{ field: "json", message: "Paste your Firebase config JSON here.", wizardStep: 3 }],
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return {
			valid: false,
			errors: [
				{
					field: "json",
					message:
						"Not valid JSON. Make sure you copied the full config object including the outer { }.",
					wizardStep: 3,
				},
			],
		};
	}

	const result = firebaseConfigSchema.safeParse(parsed);
	if (result.success) {
		return { valid: true, value: result.data };
	}

	const errors: FieldError[] = result.error.issues.map((issue) => {
		const field = issue.path[0]?.toString() ?? "json";
		return {
			field,
			message: FIELD_HINTS[field] ?? issue.message,
			wizardStep: FIELD_STEP_MAP[field] ?? 2,
		};
	});
	return { valid: false, errors };
}
