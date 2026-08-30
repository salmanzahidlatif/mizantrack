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

/**
 * Firebase console's "SDK setup and configuration" panel shows a JS object
 * literal — `const firebaseConfig = { apiKey: "...", ... };` — not valid
 * JSON. Non-technical users tend to copy that verbatim (unquoted keys,
 * trailing semicolon, sometimes single-quoted strings), which fails
 * `JSON.parse`. Coerce it into valid JSON before giving up: strip the
 * variable declaration / export wrapper and trailing semicolon, quote bare
 * object keys, normalize single-quoted strings to double-quoted, and drop
 * trailing commas.
 */
function sanitizeFirebaseConfigInput(raw: string): string {
	let text = raw.trim();

	// Strip `export default` / `module.exports =` / `const firebaseConfig =` wrappers.
	text = text.replace(/^(?:export\s+default\s+|module\.exports\s*=\s*)/, "");
	text = text.replace(/^(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*/, "");
	text = text.trim().replace(/;\s*$/, "");

	// Quote unquoted object keys: `{ apiKey: ... }` -> `{ "apiKey": ... }`.
	// Only matches keys directly after `{` or `,` (not inside already-quoted
	// keys or string values), so it's safe to run unconditionally.
	text = text.replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');

	// Normalize single-quoted string values to double-quoted.
	text = text.replace(/'((?:\\.|[^'\\])*)'/g, (_match, inner: string) => `"${inner.replace(/"/g, '\\"')}"`);

	// Remove trailing commas before a closing brace/bracket.
	text = text.replace(/,(\s*[}\]])/g, "$1");

	return text;
}

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
		// Fall back to coercing common "JS object literal" pastes (unquoted
		// keys, trailing semicolon, `const firebaseConfig = ...`) into JSON.
		try {
			parsed = JSON.parse(sanitizeFirebaseConfigInput(raw));
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
