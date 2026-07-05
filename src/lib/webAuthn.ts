/**
 * WebAuthn biometric authentication (Face ID / fingerprint).
 * Uses the Web Authentication API (navigator.credentials).
 * Credentials are device-local and never synced to Firebase.
 */

/** Returns true if WebAuthn platform authenticator is available. */
export function isBiometricAvailable(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.PublicKeyCredential !== "undefined" &&
		typeof navigator.credentials?.create === "function"
	);
}

/**
 * Register a new biometric credential for the user.
 * @param userId       Dexie userId (Google sub) — used as the opaque credential ID.
 * @param userDisplay  Human-readable name shown in the OS passkey prompt (name/email).
 * Returns a Base64-encoded credentialId to store in dbConfig.
 * Throws if the user cancels or biometrics are unavailable.
 */
export async function registerBiometric(userId: string, userDisplay?: string): Promise<string> {
	if (!isBiometricAvailable()) {
		throw new Error("WebAuthn is not available on this device.");
	}

	const challenge = crypto.getRandomValues(new Uint8Array(32));
	const displayName = userDisplay || "MizanTrack User";

	const credential = (await navigator.credentials.create({
		publicKey: {
			challenge,
			rp: { name: "MizanTrack", id: window.location.hostname },
			user: {
				id: new TextEncoder().encode(userId),
				name: displayName,
				displayName,
			},
			pubKeyCredParams: [
				{ type: "public-key", alg: -7 }, // ES256
				{ type: "public-key", alg: -257 }, // RS256
			],
			authenticatorSelection: {
				authenticatorAttachment: "platform",
				userVerification: "required",
				residentKey: "preferred",
			},
			timeout: 60_000,
		},
	})) as PublicKeyCredential | null;

	if (!credential) throw new Error("Biometric registration cancelled.");

	return btoa(String.fromCharCode(...new Uint8Array(credential.rawId)));
}

/**
 * Authenticate using a previously registered biometric credential.
 * Returns true on success, false if the user cancels.
 * Throws on hardware or protocol errors.
 */
export async function authenticateBiometric(credentialIdBase64: string): Promise<boolean> {
	if (!isBiometricAvailable()) return false;

	const challenge = crypto.getRandomValues(new Uint8Array(32));

	// Decode the stored credentialId
	const rawId = Uint8Array.from(atob(credentialIdBase64), (c) => c.charCodeAt(0));

	try {
		const assertion = await navigator.credentials.get({
			publicKey: {
				challenge,
				rpId: window.location.hostname,
				allowCredentials: [{ type: "public-key", id: rawId }],
				userVerification: "required",
				timeout: 60_000,
			},
		});

		return assertion !== null;
	} catch (err) {
		// NotAllowedError = user cancelled
		if (err instanceof DOMException && err.name === "NotAllowedError") return false;
		throw err;
	}
}
