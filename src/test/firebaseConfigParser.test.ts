import { describe, expect, it } from "vitest";

import { parseFirebaseConfigJson } from "@/lib/firebaseConfigParser";

const VALID_CONFIG = JSON.stringify({
	apiKey: "AIzaSyAbc123",
	authDomain: "my-project.firebaseapp.com",
	projectId: "my-project",
	storageBucket: "my-project.appspot.com",
	messagingSenderId: "123456789012",
	appId: "1:123456789012:web:abc123",
});

describe("parseFirebaseConfigJson", () => {
	it("validConfig_ReturnsValidTrue", () => {
		const result = parseFirebaseConfigJson(VALID_CONFIG);
		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.value.apiKey).toBe("AIzaSyAbc123");
			expect(result.value.projectId).toBe("my-project");
		}
	});

	it("minimalConfig_ReturnsValidTrue", () => {
		const result = parseFirebaseConfigJson(
			JSON.stringify({ apiKey: "key", authDomain: "x.firebaseapp.com", projectId: "proj" })
		);
		expect(result.valid).toBe(true);
	});

	it("emptyString_ReturnsJsonFieldError", () => {
		const result = parseFirebaseConfigJson("");
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.errors[0]?.field).toBe("json");
			expect(result.errors[0]?.wizardStep).toBe(3);
		}
	});

	it("whitespaceOnly_ReturnsJsonFieldError", () => {
		const result = parseFirebaseConfigJson("   ");
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.errors[0]?.field).toBe("json");
		}
	});

	it("malformedJson_ReturnsJsonFieldError_WizardStep3", () => {
		const result = parseFirebaseConfigJson("{not json}");
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.errors[0]?.field).toBe("json");
			expect(result.errors[0]?.wizardStep).toBe(3);
			expect(result.errors[0]?.message).toContain("full config object");
		}
	});

	it("missingApiKey_ReturnsFieldError_WizardStep2", () => {
		const result = parseFirebaseConfigJson(
			JSON.stringify({ authDomain: "x.firebaseapp.com", projectId: "proj" })
		);
		expect(result.valid).toBe(false);
		if (!result.valid) {
			const apiKeyError = result.errors.find((e) => e.field === "apiKey");
			expect(apiKeyError).toBeDefined();
			expect(apiKeyError?.wizardStep).toBe(2);
		}
	});

	it("missingProjectId_ReturnsFieldError_WizardStep2", () => {
		const result = parseFirebaseConfigJson(
			JSON.stringify({ apiKey: "key", authDomain: "x.firebaseapp.com" })
		);
		expect(result.valid).toBe(false);
		if (!result.valid) {
			const err = result.errors.find((e) => e.field === "projectId");
			expect(err?.wizardStep).toBe(2);
		}
	});

	it("multipleFieldsMissing_ReturnsMultipleErrors", () => {
		const result = parseFirebaseConfigJson(JSON.stringify({}));
		expect(result.valid).toBe(false);
		if (!result.valid) {
			expect(result.errors.length).toBeGreaterThanOrEqual(3);
		}
	});

	it("unquotedKeys_ReturnsValidTrue", () => {
		// What non-technical users actually paste from the Firebase console's
		// SDK snippet — unquoted keys, no `const ... =` wrapper.
		const raw = `{
  apiKey: "AIzaSyAO_TLuR9R8CVLAImFq5LHG24HRr_pZwg8",
  authDomain: "mizantrack.firebaseapp.com",
  projectId: "mizantrack",
  storageBucket: "mizantrack.firebasestorage.app",
  messagingSenderId: "1096019587661",
  appId: "1:1096019587661:web:fbc6e3cb5ac587974b6204",
  measurementId: "G-T38LDJGDCP"
}`;
		const result = parseFirebaseConfigJson(raw);
		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.value.apiKey).toBe("AIzaSyAO_TLuR9R8CVLAImFq5LHG24HRr_pZwg8");
			expect(result.value.projectId).toBe("mizantrack");
		}
	});

	it("jsVariableDeclarationWithSemicolon_ReturnsValidTrue", () => {
		const raw = `const firebaseConfig = {
  apiKey: 'key',
  authDomain: 'x.firebaseapp.com',
  projectId: 'proj',
};`;
		const result = parseFirebaseConfigJson(raw);
		expect(result.valid).toBe(true);
		if (result.valid) {
			expect(result.value.apiKey).toBe("key");
			expect(result.value.projectId).toBe("proj");
		}
	});

	it("exportDefaultWithTrailingComma_ReturnsValidTrue", () => {
		const raw = `export default {
  apiKey: "key",
  authDomain: "x.firebaseapp.com",
  projectId: "proj",
};`;
		const result = parseFirebaseConfigJson(raw);
		expect(result.valid).toBe(true);
	});

	it("fieldHints_OverrideZodMessages", () => {
		const result = parseFirebaseConfigJson(
			JSON.stringify({ authDomain: "x.firebaseapp.com", projectId: "proj" })
		);
		expect(result.valid).toBe(false);
		if (!result.valid) {
			const apiKeyError = result.errors.find((e) => e.field === "apiKey");
			expect(apiKeyError?.message).toContain("Firebase SDK config");
		}
	});
});
