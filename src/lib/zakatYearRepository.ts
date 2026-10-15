/**
 * Persistence for zakat year anchors.
 *
 * A record stores ONLY the 1 Ramaḍān date and where it came from. The twelve months are
 * recomputed from that anchor every time, so there is one source of truth and a stored
 * month can never contradict its own start date.
 */

import { db } from "@/lib/db/local";
import { startOfLocalDay } from "@/lib/zakatCalendar";

import type { ZakatYearOverride, ZakatYearSource } from "@/types";

export function buildZakatYearOverrideId(userId: string, islamicYear: number): string {
	return `${userId}:${islamicYear}`;
}

/** Loads a user's saved anchors as an Islamic-year → local-midnight `Date` map. */
export function toRamadanStartMap(overrides: ZakatYearOverride[]): Map<number, Date> {
	const starts = new Map<number, Date>();
	for (const override of overrides) {
		if (override.deletedAt) continue;
		starts.set(override.islamicYear, new Date(override.ramadanStart));
	}
	return starts;
}

export async function listZakatYearOverrides(userId: string): Promise<ZakatYearOverride[]> {
	const overrides = await db.zakatYears.where("userId").equals(userId).toArray();
	return overrides.filter((override) => !override.deletedAt);
}

/**
 * Saves a 1 Ramaḍān anchor. The date is normalised to local midnight so the stored
 * timestamp always lines up with the month boundaries derived from it.
 */
export async function saveZakatYearOverride({
	userId,
	islamicYear,
	ramadanStart,
	source = "manual",
}: {
	userId: string;
	islamicYear: number;
	ramadanStart: Date;
	source?: ZakatYearSource;
}): Promise<ZakatYearOverride> {
	const record: ZakatYearOverride = {
		id: buildZakatYearOverrideId(userId, islamicYear),
		userId,
		islamicYear,
		ramadanStart: startOfLocalDay(ramadanStart).getTime(),
		source,
		updatedAt: Date.now(),
		deletedAt: undefined,
	};

	await db.zakatYears.put(record);
	return record;
}

/**
 * Drops a saved anchor so the year falls back to its announced or computed default.
 * Soft-deleted rather than removed, so the reset propagates to the user's other devices.
 */
export async function clearZakatYearOverride(userId: string, islamicYear: number): Promise<void> {
	const id = buildZakatYearOverrideId(userId, islamicYear);
	const existing = await db.zakatYears.get(id);
	if (!existing) return;

	const now = Date.now();
	await db.zakatYears.update(id, { deletedAt: now, updatedAt: now });
}
