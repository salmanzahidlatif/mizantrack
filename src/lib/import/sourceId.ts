export const HYSAB_KYTAB_SOURCE_NAMESPACE = "hk" as const;

export type HysabKytabSourceEntity = "account" | "category" | "voucher" | "budget";

export interface SourceIdParts {
	namespace: typeof HYSAB_KYTAB_SOURCE_NAMESPACE;
	currency: string;
	entity: HysabKytabSourceEntity;
	id: string;
}

const SOURCE_ID_PATTERN = /^([^:]+):([A-Z]{3}):([^:]+):([^:]+)$/;

function normalizeSourcePart(value: string | number, label: string): string {
	const normalized = String(value).trim();
	if (normalized.length === 0) {
		throw new Error(`Source ID ${label} must not be empty.`);
	}
	if (normalized.includes(":")) {
		throw new Error(`Source ID ${label} must not contain ":".`);
	}
	return normalized;
}

function normalizeCurrency(currency: string): string {
	const normalized = normalizeSourcePart(currency, "currency").toUpperCase();
	if (!/^[A-Z]{3}$/.test(normalized)) {
		throw new Error("Source ID currency must be a 3-letter ISO code.");
	}
	return normalized;
}

/**
 * Builds a namespaced source identity for Hysab Kytab imports.
 *
 * Format: `hk:<CURRENCY>:<entity>:<source-record-id>`, for example
 * `hk:PKR:account:19` or `hk:AED:voucher:1791209290738`.
 * Currency is part of the identity because Hysab Kytab backups are imported
 * one currency at a time, and source table IDs can repeat across currencies.
 */
export function buildHysabKytabSourceId(
	currency: string,
	entity: HysabKytabSourceEntity,
	id: string | number
): string {
	return [
		HYSAB_KYTAB_SOURCE_NAMESPACE,
		normalizeCurrency(currency),
		normalizeSourcePart(entity, "entity"),
		normalizeSourcePart(id, "record id"),
	].join(":");
}

export function parseSourceId(sourceId: string): SourceIdParts | null {
	const match = SOURCE_ID_PATTERN.exec(sourceId.trim());
	if (!match) return null;

	const namespace = match[1];
	const currency = match[2];
	const entity = match[3];
	const id = match[4];
	if (!namespace || !currency || !entity || !id) return null;
	if (namespace !== HYSAB_KYTAB_SOURCE_NAMESPACE) return null;
	if (!["account", "category", "voucher", "budget"].includes(entity)) return null;

	return {
		namespace,
		currency,
		entity: entity as HysabKytabSourceEntity,
		id,
	};
}
