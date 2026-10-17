/**
 * Auditing a saved zakat calculation against the data as it stands now.
 *
 * A saved calculation is a RECORD, not a cache. "On this date I assessed X and paid Y" is
 * a determination made at a point in time, and a bookkeeping error fixed three years
 * later must not silently rewrite it. So the snapshot is kept exactly as it was saved —
 * and the year is recomputed live beside it, so the owner can SEE that the two have
 * parted company instead of discovering it when next year's Past Remaining looks wrong.
 *
 * Carry-forward deliberately keeps recomputing live: the chain has to reflect the books
 * as they actually are. This module is what makes that honest, by flagging every saved
 * figure the live books no longer agree with.
 *
 * Nothing here computes tax. Zakat is a religious obligation; this module only compares
 * two figures the engine produced.
 */

import { calculateZakatAssessment } from "@/lib/zakatEngine";
import {
	buildZakatYearAssessment,
	DEFAULT_ZAKAT_RATE_PERCENT,
	type ZakatYearAssessmentContext,
} from "@/lib/zakatYearAssessment";

import type { ZakatCalculation } from "@/types";

/**
 * Money is summed as floating point, so a run of additions leaves artefacts such as
 * 0.0000000004365574569 where the true difference is zero. Every figure is rounded to the
 * minor unit it is denominated in before it is compared, or sub-cent noise would flag a
 * snapshot as stale when not one rupee has moved.
 *
 * (The reports engine rounds the same way. Zakat keeps its own copy on purpose: this is a
 * religious obligation and must never depend on the reporting code.)
 */
export function toZakatCurrencyPrecision(amount: number): number {
	if (!Number.isFinite(amount)) return 0;
	return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * - `matches`: the year still recomputes to the figures that were saved
 * - `diverged`: the books have changed since; both figures are reported
 * - `unchecked`: the year could not be recomputed, so nothing is claimed either way
 */
export type ZakatSnapshotStatus = "matches" | "diverged" | "unchecked";

export type ZakatSnapshotFigureKey = "totalZakatable" | "zakatObligation" | "goldValue";

export interface ZakatSnapshotFigure {
	key: ZakatSnapshotFigureKey;
	label: string;
	/** What was saved, rounded to the minor unit. */
	saved: number;
	/** What the same year works out to now, rounded to the minor unit. */
	current: number;
	/** `current - saved`; positive means the books now say more than was assessed. */
	delta: number;
	changed: boolean;
}

export interface ZakatSnapshotAudit {
	calculationId: string;
	islamicYear?: number;
	status: ZakatSnapshotStatus;
	/** Every compared figure, in reading order. */
	figures: ZakatSnapshotFigure[];
	/** Only the ones that moved. Empty whenever the status is not `diverged`. */
	differences: ZakatSnapshotFigure[];
}

/** The figures a saved calculation is judged on. */
export interface ZakatSnapshotFigures {
	totalZakatable: number;
	zakatObligation: number;
	goldValue: number;
}

const FIGURE_LABELS: Record<ZakatSnapshotFigureKey, string> = {
	totalZakatable: "Total zakatable",
	zakatObligation: "Zakat obligation",
	goldValue: "Gold value",
};

/**
 * The Islamic year a saved calculation belongs to.
 *
 * Calculations store the year as the sheet's label, `"1444-1445"`; the Islamic year the
 * Ramaḍān falls in is the first half and is the stable identity of a zakat year.
 */
export function getZakatSnapshotIslamicYear(islamicYear: string | undefined): number | undefined {
	if (typeof islamicYear !== "string") return undefined;
	const parsed = Number.parseInt(islamicYear.split("-")[0] ?? "", 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}

export function toZakatSnapshotFigures(calculation: ZakatCalculation): ZakatSnapshotFigures {
	return {
		totalZakatable: calculation.totalZakatable,
		zakatObligation: calculation.zakatObligation,
		goldValue: calculation.totalGoldValue,
	};
}

/**
 * Compares one saved calculation against the same year as it recomputes today.
 *
 * `current` is undefined while the live books are still loading, or when the year cannot
 * be identified — the snapshot is then reported as `unchecked` rather than as matching,
 * because "we have not looked" and "we looked and it agrees" are not the same statement.
 */
export function auditZakatSnapshot(
	calculation: ZakatCalculation,
	current: ZakatSnapshotFigures | undefined
): ZakatSnapshotAudit {
	const islamicYear = getZakatSnapshotIslamicYear(calculation.islamicYear);
	const saved = toZakatSnapshotFigures(calculation);

	if (!current) {
		return {
			calculationId: calculation.id,
			islamicYear,
			status: "unchecked",
			figures: [],
			differences: [],
		};
	}

	const figures = (Object.keys(FIGURE_LABELS) as ZakatSnapshotFigureKey[]).map((key) => {
		// The MOVE is what is rounded, not the two figures separately: 3,213,671.076 and
		// 3,213,671.072 round to different paisa while nothing has actually happened, and
		// a sheet of such false flags would teach the owner to ignore the real ones.
		const delta = toZakatCurrencyPrecision(current[key] - saved[key]);
		return {
			key,
			label: FIGURE_LABELS[key],
			saved: toZakatCurrencyPrecision(saved[key]),
			current: toZakatCurrencyPrecision(current[key]),
			delta,
			changed: delta !== 0,
		};
	});
	const differences = figures.filter((figure) => figure.changed);

	return {
		calculationId: calculation.id,
		islamicYear,
		status: differences.length > 0 ? "diverged" : "matches",
		figures,
		differences,
	};
}

/**
 * Audits a whole page of saved calculations off ONE prepared context.
 *
 * Each Islamic year's grid is built once however many snapshots were saved against it —
 * a year's month-end grid walks every transaction twelve times, so rebuilding it per row
 * would make a long history crawl. A snapshot is then re-assessed on its OWN basis and
 * rate, so a year deliberately settled on MAXIMUM, or at a rate other than 2.5%, is
 * compared like with like and only a change in the BOOKS can flag it.
 */
export function auditZakatSnapshots(
	calculations: readonly ZakatCalculation[],
	context: ZakatYearAssessmentContext | undefined
): Map<string, ZakatSnapshotAudit> {
	const audits = new Map<string, ZakatSnapshotAudit>();
	if (!context) {
		for (const calculation of calculations) {
			audits.set(calculation.id, auditZakatSnapshot(calculation, undefined));
		}
		return audits;
	}

	const assessmentsByYear = new Map<number, ReturnType<typeof buildZakatYearAssessment>>();
	for (const calculation of calculations) {
		const islamicYear = getZakatSnapshotIslamicYear(calculation.islamicYear);
		if (islamicYear === undefined) {
			audits.set(calculation.id, auditZakatSnapshot(calculation, undefined));
			continue;
		}

		let live = assessmentsByYear.get(islamicYear);
		if (!live) {
			live = buildZakatYearAssessment(context, islamicYear);
			assessmentsByYear.set(islamicYear, live);
		}

		const assessment = calculateZakatAssessment({
			...live.input,
			basis: calculation.basis ?? "minimum",
			ratePercent: calculation.ratePercent ?? DEFAULT_ZAKAT_RATE_PERCENT,
		});

		audits.set(
			calculation.id,
			auditZakatSnapshot(calculation, {
				totalZakatable: assessment.totalZakatable,
				zakatObligation: assessment.zakatObligation,
				goldValue: assessment.goldValue,
			})
		);
	}

	return audits;
}
