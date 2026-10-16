/**
 * Persistence for the per-year zakat inputs the owner can override.
 *
 * A record stores ONLY inputs: the 1 Ramaḍān date, a Past Remaining the owner typed,
 * the accounts chosen for the year, whether closed accounts count towards it, and where
 * each came from. The twelve months are recomputed from the anchor and the automatic
 * Past Remaining is recomputed from the previous year, so there is one source of truth
 * and a stored value can never contradict what the engine derives.
 *
 * The account selection belongs to the YEAR, not to the app: accounts open and close, so
 * the owner's `2020` sheet includes a closed Alfalah row that `2024` has no row for. One
 * global selection would silently rewrite the years he has already settled.
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

/**
 * The accounts chosen for each year, by Islamic year.
 *
 * A year missing from the map was never touched and the screen may pre-select for it. A
 * year mapped to an EMPTY array was deliberately emptied, and that choice wins over the
 * fallback — an explicit "none of them" must never silently re-select everything.
 */
export function toZakatAccountSelectionMap(overrides: ZakatYearOverride[]): Map<number, string[]> {
	const selections = new Map<number, string[]>();
	for (const override of overrides) {
		if (override.deletedAt) continue;
		if (!Array.isArray(override.selectedAccountIds)) continue;
		selections.set(
			override.islamicYear,
			override.selectedAccountIds.filter((id) => typeof id === "string")
		);
	}
	return selections;
}

/** Whether each year counts its closed accounts. Absent means the default applies. */
export function toZakatShowArchivedAccountsMap(
	overrides: ZakatYearOverride[]
): Map<number, boolean> {
	const flags = new Map<number, boolean>();
	for (const override of overrides) {
		if (override.deletedAt) continue;
		if (typeof override.showArchivedAccounts !== "boolean") continue;
		flags.set(override.islamicYear, override.showArchivedAccounts);
	}
	return flags;
}

export async function listZakatYearOverrides(userId: string): Promise<ZakatYearOverride[]> {
	const overrides = await db.zakatYears.where("userId").equals(userId).toArray();
	return overrides.filter((override) => !override.deletedAt);
}

/**
 * Whether a row still holds the owner's account choices. A row carrying them must stay
 * alive when another input on it is reset, or clearing an anchor would quietly re-open
 * every account for a year that had been narrowed down.
 */
function holdsSelection(override: ZakatYearOverride): boolean {
	return (
		Array.isArray(override.selectedAccountIds) || typeof override.showArchivedAccounts === "boolean"
	);
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
	if (
		!existing.deletedAt &&
		(existing.pastRemainingOverride !== undefined || holdsSelection(existing))
	) {
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
	if (!existing.deletedAt && (existing.source === "manual" || holdsSelection(existing))) {
		const kept: ZakatYearOverride = { ...existing, updatedAt: now };
		delete kept.pastRemainingOverride;
		delete kept.pastRemainingSource;
		await db.zakatYears.put(kept);
		return;
	}

	await db.zakatYears.update(existing.id, { deletedAt: now, updatedAt: now });
}

/**
 * Saves the accounts chosen for one zakat year.
 *
 * The list is stored verbatim, including empty: an empty selection is the owner saying
 * "none of these count this year", which is a real answer and must survive a reload.
 * Everything else on the row — the anchor, the Past Remaining — is left untouched.
 */
export async function saveZakatYearAccountSelection({
	userId,
	islamicYear,
	selectedAccountIds,
}: {
	userId: string;
	islamicYear: number;
	selectedAccountIds: Iterable<string>;
}): Promise<ZakatYearOverride> {
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
		selectedAccountIds: [...new Set(selectedAccountIds)],
		updatedAt: Date.now(),
		deletedAt: undefined,
	};

	await db.zakatYears.put(record);
	return record;
}

/**
 * Saves whether a year counts its closed accounts.
 *
 * The toggle is an INCLUSION filter, not a view preference: with it off, an archived
 * account is excluded from the year's grid and totals even when it is still selected.
 * The selection underneath is kept, so switching the toggle back on restores it.
 */
export async function saveZakatYearShowArchivedAccounts({
	userId,
	islamicYear,
	showArchivedAccounts,
}: {
	userId: string;
	islamicYear: number;
	showArchivedAccounts: boolean;
}): Promise<ZakatYearOverride> {
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
		showArchivedAccounts,
		updatedAt: Date.now(),
		deletedAt: undefined,
	};

	await db.zakatYears.put(record);
	return record;
}

/**
 * Drops a year's saved account choices so the screen pre-selects for it again.
 *
 * The row is kept alive when it still holds an anchor or a Past Remaining, and
 * tombstoned otherwise, so the reset reaches the user's other devices either way.
 */
export async function clearZakatYearAccountSelection(
	userId: string,
	islamicYear: number
): Promise<void> {
	const existing = await db.zakatYears.get(buildZakatYearOverrideId(userId, islamicYear));
	if (!existing || !holdsSelection(existing)) return;

	const now = Date.now();
	if (
		!existing.deletedAt &&
		(existing.source === "manual" || existing.pastRemainingOverride !== undefined)
	) {
		const kept: ZakatYearOverride = { ...existing, updatedAt: now };
		delete kept.selectedAccountIds;
		delete kept.showArchivedAccounts;
		await db.zakatYears.put(kept);
		return;
	}

	await db.zakatYears.update(existing.id, { deletedAt: now, updatedAt: now });
}
