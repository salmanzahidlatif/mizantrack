/**
 * PIN cryptography — all hashing via the Web Crypto API (SHA-256).
 * Plaintext PINs never leave this module.
 */

/**
 * Hash a PIN string using SHA-256.
 * Returns a deterministic lowercase 64-character hex string.
 */
export async function hashPin(pin: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(pin);
	const hashBuffer = await crypto.subtle.digest("SHA-256", data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compare a user-entered PIN against a stored SHA-256 hex hash.
 * Returns true if the PIN matches, false otherwise.
 */
export async function verifyPin(pin: string, storedHash: string): Promise<boolean> {
	if (!pin || !storedHash) return false;
	const hash = await hashPin(pin);
	return hash === storedHash.toLowerCase();
}
