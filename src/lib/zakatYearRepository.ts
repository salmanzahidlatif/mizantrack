/**
 * Persistence for the per-year zakat inputs the owner can override.
 *
 * A record stores ONLY inputs: the 1 Ramaḍān date, a Past Remaining the owner typed,
 * and where each came from. The twelve months are recomputed from the anchor and the
 * automatic Past Remaining is recomputed from the previous year, so there is one source
 * of truth and a stored value can never contradict what the engine derives.
 */

import { db } from "@/lib/db/local";
import { resolveRamadanStart, startOfLocalDay } from "@/lib/zakatCalendar";

import type { ZakatYearOverride, ZakatYearSource } from "@/types";

export function buildZakatYearOverrideId(userId: string, islamicYear: number): string {
	return `${userId}:${islamicYear}`;
}

/**
 * Loads a user's saved anchors as an Islamic-year → local-midnight `Date` map.
 *
 * Only hand-set anchors are returned. A record written purely to hold a Past Remaining
 * still carries the announced or computed date of the day it was created; replaying that
 * would freeze a default that is meant to keep tracking the calendar.
 */
export function toRamadanStartMap(overrides: ZakatYearOverride[]): Map<number, Date> {
	const starts = new Map<number, Date>();
	for (const override of overrides) {
		if (override.deletedAt) continue;
		if (override.source !== "manual") continue;
		starts.set(override.islamicYear, new Date(override.ramadanStart));
	}
	return starts;
}

/** Loads the Past Remaining figures the owner typed, by Islamic year. */
export function toPastRemainingOverrideMap(overrides: ZakatYearOverride[]): Map<number, number> {
	const pastRemaining = new Map<number, number>();
	for (const override of overrides) {
		if (override.deletedAt) continue;
		if (override.pastRemainingOverride === undefined) continue;
		if (!Number.isFinite(override.pastRemainingOverride)) continue;
		pastRemaining.set(override.islamicYear, override.pastRemainingOverride);
	}
	return pastRemaining;
}

export async function listZakatYearOverrides(userId: string): Promise<ZakatYearOverride[]> {
	const overrides = await db.zakatYears.where("userId").equals(userId).toArray();
	return overrides.filter((override) => !override.deletedAt);
}

/** The live record for a year, ignoring one that has been reset to its defaults. */
async function getLiveOverride(
	userId: string,
	islamicYear: number
): Promise<ZakatYearOverride | undefined> {
	const existing = await db.zakatYears.get(buildZakatYearOverrideId(userId, islamicYear));
	return existing && !existing.deletedAt ? existing : undefined;
}

/**
 * Saves a 1 Ramaḍān anchor. The date is normalised to local midnight so the stored
 * timestamp always lines up with the month boundaries derived from it.
 *
 * Any Past Remaining already saved for the year is left untouched: the two overrides are
 * independent inputs that happen to share a row.
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
	const existing = await getLiveOverride(userId, islamicYear);
	const record: ZakatYearOverride = {
		...existing,
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
 *
 * A Past Remaining the owner typed survives the reset: the row stays alive carrying the
 * default anchor, which `toRamadanStartMap` ignores because it is no longer manual.
 */
export async function clearZakatYearOverride(userId: string, islamicYear: number): Promise<void> {
	const existing = await db.zakatYears.get(buildZakatYearOverrideId(userId, islamicYear));
	if (!existing) return;

	const now = Date.now();
	if (!existing.deletedAt && existing.pastRemainingOverride !== undefined) {
		const fallback = resolveRamadanStart(islamicYear);
		await db.zakatYears.put({
			...existing,
			ramadanStart: startOfLocalDay(fallback.date).getTime(),
			source: fallback.source,
			updatedAt: now,
		});
		return;
	}

	await db.zakatYears.update(existing.id, { deletedAt: now, updatedAt: now });
}

/**
 * Pins the Past Remaining for a year to a figure the owner typed, in place of the balance
 * carried automatically from the previous year. Negative values are kept: an overpayment
 * carries forward as a credit that reduces the next year's Total To Pay.
 */
export async function saveZakatPastRemainingOverride({
	userId,
	islamicYear,
	pastRemaining,
}: {
	userId: string;
	islamicYear: number;
	pastRemaining: number;
}): Promise<ZakatYearOverride> {
	if (!Number.isFinite(pastRemaining)) {
		throw new Error(`Past Remaining must be a finite number, received: ${pastRemaining}`);
	}

	const existing = await getLiveOverride(userId, islamicYear);
	const anchor = existing
		? { date: new Date(existing.ramadanStart), source: existing.source }
		: resolveRamadanStart(islamicYear);

	const record: ZakatYearOverride = {
		...existing,
		id: buildZakatYearOverrideId(userId, islamicYear),
		userId,
		islamicYear,
		ramadanStart: startOfLocalDay(anchor.date).getTime(),
		source: anchor.source,
		pastRemainingOverride: pastRemaining,
		pastRemainingSource: "manual",
		updatedAt: Date.now(),
		deletedAt: undefined,
	};

	await db.zakatYears.put(record);
	return record;
}

/**
 * Drops a typed Past Remaining so the year carries the previous year's balance again.
 *
 * The row is kept alive when it still holds a hand-set anchor, and tombstoned otherwise,
 * so the reset reaches the user's other devices either way.
 */
export async function clearZakatPastRemainingOverride(
	userId: string,
	islamicYear: number
): Promise<void> {
	const existing = await db.zakatYears.get(buildZakatYearOverrideId(userId, islamicYear));
	if (existing?.pastRemainingOverride === undefined) return;

	const now = Date.now();
	if (!existing.deletedAt && existing.source === "manual") {
		const kept: ZakatYearOverride = { ...existing, updatedAt: now };
		delete kept.pastRemainingOverride;
		delete kept.pastRemainingSource;
		await db.zakatYears.put(kept);
		return;
	}

	await db.zakatYears.update(existing.id, { deletedAt: now, updatedAt: now });
}
