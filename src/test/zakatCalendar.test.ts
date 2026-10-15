/**
 * Zakat calendar regression tests.
 *
 * The five trusted years (AH1440–1444, sheet years 2020–2024) are the owner's
 * reconciliation baseline. Every one of their 24 month boundaries is pinned to the exact
 * literal value the calendar used to hardcode, so a change in the generation algorithm
 * cannot silently move a month-end balance and alter the zakat owed for a closed year.
 */
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/local";
import {
	buildZakatYearDefinition,
	getUmalquraMonthLengths,
	getUmalquraRamadanStart,
	getZakatIslamicYearForDate,
	getZakatIslamicYearRange,
	PAKISTAN_RAMADAN_STARTS,
	resolveRamadanStart,
	toLocalDateKey,
	ZAKAT_EARLIEST_ISLAMIC_YEAR,
	ZAKAT_YEARS_FORWARD,
} from "@/lib/zakatCalendar";
import {
	getDefaultZakatIslamicYear,
	getZakatYearDefinition,
	getZakatYearDefinitionByIslamicYear,
	getZakatYearDefinitions,
} from "@/lib/zakatEngine";
import {
	buildZakatYearOverrideId,
	clearZakatYearOverride,
	listZakatYearOverrides,
	saveZakatYearOverride,
	toRamadanStartMap,
} from "@/lib/zakatYearRepository";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The literal boundaries the engine shipped as `YEAR_SPECS` before the calendar became
 * dynamic. These are copied verbatim — they are the contract, not a derived expectation.
 */
const TRUSTED_YEARS: Array<{
	sheetYear: number;
	islamicYear: number;
	starts: string[];
	ends: string[];
}> = [
	{
		sheetYear: 2020,
		islamicYear: 1440,
		starts: [
			"2019-05-07",
			"2019-06-05",
			"2019-07-05",
			"2019-08-03",
			"2019-09-01",
			"2019-10-01",
			"2019-10-30",
			"2019-11-29",
			"2019-12-28",
			"2020-01-27",
			"2020-02-26",
			"2020-03-26",
		],
		ends: [
			"2019-06-04",
			"2019-07-04",
			"2019-08-02",
			"2019-08-31",
			"2019-09-30",
			"2019-10-29",
			"2019-11-28",
			"2019-12-27",
			"2020-01-26",
			"2020-02-25",
			"2020-03-25",
			"2020-04-24",
		],
	},
	{
		sheetYear: 2021,
		islamicYear: 1441,
		starts: [
			"2020-04-25",
			"2020-05-25",
			"2020-06-23",
			"2020-07-23",
			"2020-08-21",
			"2020-09-19",
			"2020-10-19",
			"2020-11-17",
			"2020-12-17",
			"2021-01-15",
			"2021-02-14",
			"2021-03-15",
		],
		ends: [
			"2020-05-24",
			"2020-06-22",
			"2020-07-22",
			"2020-08-20",
			"2020-09-18",
			"2020-10-18",
			"2020-11-16",
			"2020-12-16",
			"2021-01-14",
			"2021-02-13",
			"2021-03-14",
			"2021-04-13",
		],
	},
	{
		sheetYear: 2022,
		islamicYear: 1442,
		starts: [
			"2021-04-14",
			"2021-05-14",
			"2021-06-12",
			"2021-07-12",
			"2021-08-10",
			"2021-09-09",
			"2021-10-08",
			"2021-11-07",
			"2021-12-06",
			"2022-01-05",
			"2022-02-03",
			"2022-03-05",
		],
		ends: [
			"2021-05-13",
			"2021-06-11",
			"2021-07-11",
			"2021-08-09",
			"2021-09-08",
			"2021-10-07",
			"2021-11-06",
			"2021-12-05",
			"2022-01-04",
			"2022-02-02",
			"2022-03-04",
			"2022-04-02",
		],
	},
	{
		sheetYear: 2023,
		islamicYear: 1443,
		starts: [
			"2022-04-04",
			"2022-05-04",
			"2022-06-02",
			"2022-07-02",
			"2022-08-01",
			"2022-08-30",
			"2022-09-29",
			"2022-10-28",
			"2022-11-27",
			"2022-12-27",
			"2023-01-25",
			"2023-02-23",
		],
		ends: [
			"2022-05-03",
			"2022-06-01",
			"2022-07-01",
			"2022-07-31",
			"2022-08-29",
			"2022-09-28",
			"2022-10-27",
			"2022-11-26",
			"2022-12-26",
			"2023-01-24",
			"2023-02-22",
			"2023-03-24",
		],
	},
	{
		sheetYear: 2024,
		islamicYear: 1444,
		starts: [
			"2023-03-23",
			"2023-04-21",
			"2023-05-21",
			"2023-06-19",
			"2023-07-19",
			"2023-08-17",
			"2023-09-16",
			"2023-10-16",
			"2023-11-15",
			"2023-12-14",
			"2024-01-13",
			"2024-02-11",
		],
		ends: [
			"2023-04-20",
			"2023-05-20",
			"2023-06-18",
			"2023-07-18",
			"2023-08-16",
			"2023-09-15",
			"2023-10-15",
			"2023-11-14",
			"2023-12-13",
			"2024-01-12",
			"2024-02-10",
			"2024-03-10",
		],
	},
];

describe("Trusted zakat years (AH1440–1444)", () => {
	for (const trusted of TRUSTED_YEARS) {
		it(`reproduces every AH${trusted.islamicYear} boundary exactly`, () => {
			const definition = buildZakatYearDefinition(trusted.islamicYear);

			expect(definition.months.map((month) => toLocalDateKey(month.startDate))).toEqual(
				trusted.starts
			);
			expect(definition.months.map((month) => toLocalDateKey(month.endDate))).toEqual(trusted.ends);
		});

		it(`keeps AH${trusted.islamicYear} on sheet year ${trusted.sheetYear}`, () => {
			const definition = buildZakatYearDefinition(trusted.islamicYear);

			expect(definition.sheetYear).toBe(trusted.sheetYear);
			expect(definition.zakatYear).toBe(`${trusted.islamicYear}-${trusted.islamicYear + 1}`);
			expect(definition.label).toBe(
				`${trusted.sheetYear} (${trusted.islamicYear}–${trusted.islamicYear + 1})`
			);
			expect(definition.ramadanSource).toBe("announced");
		});

		it(`rolls the Islamic year at al-Muḥarram for AH${trusted.islamicYear}`, () => {
			const definition = buildZakatYearDefinition(trusted.islamicYear);

			expect(definition.months.map((month) => month.islamicYear)).toEqual([
				...Array.from({ length: 4 }, () => trusted.islamicYear),
				...Array.from({ length: 8 }, () => trusted.islamicYear + 1),
			]);
		});
	}

	it("looks the trusted years up by sheet year without touching their boundaries", () => {
		for (const trusted of TRUSTED_YEARS) {
			// The dynamic window is centred on today, so pin a date inside the year itself.
			const inYear = new Date(`${trusted.starts[0]!}T12:00:00`);
			const definition = getZakatYearDefinition(trusted.sheetYear, { date: inYear });

			expect(definition.islamicYear).toBe(trusted.islamicYear);
			expect(definition.months.map((month) => toLocalDateKey(month.startDate))).toEqual(
				trusted.starts
			);
		}
	});
});

describe("Umm al-Qura generation", () => {
	it("matches the published 1 Ramaḍān dates", () => {
		expect(toLocalDateKey(getUmalquraRamadanStart(1440))).toBe("2019-05-06");
		expect(toLocalDateKey(getUmalquraRamadanStart(1444))).toBe("2023-03-23");
		expect(toLocalDateKey(getUmalquraRamadanStart(1446))).toBe("2025-03-01");
	});

	it("reproduces the owner's real AH1444 month lengths", () => {
		expect(getUmalquraMonthLengths(1444)).toEqual([29, 30, 29, 30, 29, 30, 30, 30, 29, 30, 29, 29]);
	});

	it("produces twelve contiguous months totalling 354 or 355 days across AH1430–1460", () => {
		for (let islamicYear = 1430; islamicYear <= 1460; islamicYear += 1) {
			const definition = buildZakatYearDefinition(islamicYear);
			expect(definition.months, `AH${islamicYear}`).toHaveLength(12);

			for (const month of definition.months) {
				const length =
					Math.round((month.endDate.getTime() - month.startDate.getTime()) / MS_PER_DAY) + 1;
				expect([29, 30], `AH${islamicYear} ${month.month}`).toContain(length);
			}

			for (let index = 1; index < 12; index += 1) {
				const previousEnd = definition.months[index - 1]!.endDate;
				const currentStart = definition.months[index]!.startDate;
				const gapDays = Math.round((currentStart.getTime() - previousEnd.getTime()) / MS_PER_DAY);
				expect(gapDays, `gap before month ${index} of AH${islamicYear}`).toBe(1);
			}

			const totalDays =
				Math.round(
					(definition.months[11]!.endDate.getTime() - definition.months[0]!.startDate.getTime()) /
						MS_PER_DAY
				) + 1;
			expect(totalDays, `AH${islamicYear} length`).toBeGreaterThanOrEqual(354);
			expect(totalDays, `AH${islamicYear} length`).toBeLessThanOrEqual(355);
		}
	});

	it("regenerates AH1445 and AH1446 from umalqura instead of the old placeholder pattern", () => {
		// The stored sheets used a naive alternating 30/29 run that was never calculated.
		const placeholder = [30, 29, 30, 29, 30, 29, 30, 29, 30, 29, 30, 29];

		expect(getUmalquraMonthLengths(1445)).toEqual([30, 29, 29, 30, 29, 30, 30, 30, 29, 30, 30, 29]);
		expect(getUmalquraMonthLengths(1445)).not.toEqual(placeholder);
		expect(getUmalquraMonthLengths(1446)).toEqual([29, 30, 29, 29, 30, 29, 30, 30, 30, 29, 30, 29]);
		expect(getUmalquraMonthLengths(1446)).not.toEqual(placeholder);

		// The anchors are still the announced sightings; only the month shape changed.
		expect(toLocalDateKey(buildZakatYearDefinition(1445).months[0]!.startDate)).toBe("2024-03-12");
		expect(toLocalDateKey(buildZakatYearDefinition(1446).months[0]!.startDate)).toBe("2025-03-02");
		expect(toLocalDateKey(buildZakatYearDefinition(1445).months[11]!.endDate)).toBe("2025-03-01");
		expect(toLocalDateKey(buildZakatYearDefinition(1446).months[11]!.endDate)).toBe("2026-02-18");
	});
});

describe("Ramaḍān anchoring", () => {
	it("prefers the announced Pakistan date over the +1 estimate", () => {
		for (const [year, announced] of Object.entries(PAKISTAN_RAMADAN_STARTS)) {
			const resolved = resolveRamadanStart(Number(year));
			expect(resolved.source).toBe("announced");
			expect(toLocalDateKey(resolved.date)).toBe(announced);
		}
	});

	it("honours the AH1443 (+2) and AH1444 (+0) exceptions to the +1 rule", () => {
		const offsetFromUmalqura = (islamicYear: number) =>
			Math.round(
				(resolveRamadanStart(islamicYear).date.getTime() -
					getUmalquraRamadanStart(islamicYear).getTime()) /
					MS_PER_DAY
			);

		expect(offsetFromUmalqura(1440)).toBe(1);
		expect(offsetFromUmalqura(1441)).toBe(1);
		expect(offsetFromUmalqura(1442)).toBe(1);
		expect(offsetFromUmalqura(1443)).toBe(2);
		expect(offsetFromUmalqura(1444)).toBe(0);
		expect(offsetFromUmalqura(1445)).toBe(1);
		expect(offsetFromUmalqura(1446)).toBe(1);
	});

	it("falls back to umalqura + 1 day for years with no announcement", () => {
		const resolved = resolveRamadanStart(1450);
		expect(resolved.source).toBe("computed");
		expect(
			Math.round((resolved.date.getTime() - getUmalquraRamadanStart(1450).getTime()) / MS_PER_DAY)
		).toBe(1);
	});

	it("lets a manual anchor override the announced date and regenerate the months", () => {
		const announced = buildZakatYearDefinition(1446);
		const overridden = buildZakatYearDefinition(1446, new Date(2025, 2, 4));

		expect(overridden.ramadanSource).toBe("manual");
		expect(toLocalDateKey(announced.months[0]!.startDate)).toBe("2025-03-02");
		expect(toLocalDateKey(overridden.months[0]!.startDate)).toBe("2025-03-04");

		// Shifting the anchor shifts every month by the same two days; the shape is unchanged.
		for (let index = 0; index < 12; index += 1) {
			const shift = Math.round(
				(overridden.months[index]!.startDate.getTime() -
					announced.months[index]!.startDate.getTime()) /
					MS_PER_DAY
			);
			expect(shift).toBe(2);
		}
		expect(toLocalDateKey(overridden.months[11]!.endDate)).toBe("2026-02-20");
	});
});

describe("Dynamic zakat year range", () => {
	it("starts at the owner's first recorded year and runs five years ahead", () => {
		const today = new Date(2026, 9, 14);
		const current = getZakatIslamicYearForDate(today);
		const years = getZakatIslamicYearRange(today);

		expect(current).toBe(1447);
		// The records begin with AH1440; there is nothing to report before it.
		expect(years[0]).toBe(ZAKAT_EARLIEST_ISLAMIC_YEAR);
		expect(years[0]).toBe(1440);
		expect(years.at(-1)).toBe(current + ZAKAT_YEARS_FORWARD);
		expect(years).toHaveLength(current + ZAKAT_YEARS_FORWARD - ZAKAT_EARLIEST_ISLAMIC_YEAR + 1);
		expect(years).toContain(1444);
		expect(years).not.toContain(1439);
	});

	it("places a date on the correct side of a Ramaḍān boundary", () => {
		// AH1446 runs 2025-03-02 → 2026-02-18.
		expect(getZakatIslamicYearForDate(new Date(2025, 2, 1))).toBe(1445);
		expect(getZakatIslamicYearForDate(new Date(2025, 2, 2))).toBe(1446);
		expect(getZakatIslamicYearForDate(new Date(2026, 1, 18))).toBe(1446);
		expect(getZakatIslamicYearForDate(new Date(2026, 1, 19))).toBe(1447);
	});

	it("maps each generated year onto the Gregorian year it ends in", () => {
		for (const definition of getZakatYearDefinitions({ date: new Date(2026, 9, 14) })) {
			expect(definition.sheetYear).toBe(definition.months[11]!.endDate.getFullYear());
		}
	});

	it("defaults to the zakat year containing the given date", () => {
		expect(getDefaultZakatIslamicYear(new Date(2023, 5, 1))).toBe(1444);
		expect(getDefaultZakatIslamicYear(new Date(2019, 4, 7))).toBe(1440);
	});

	it("applies saved anchors when generating the window", () => {
		const ramadanStarts = new Map([[1447, new Date(2026, 1, 21)]]);
		const definition = getZakatYearDefinitionByIslamicYear(1447, { ramadanStarts });

		expect(definition.ramadanSource).toBe("manual");
		expect(toLocalDateKey(definition.months[0]!.startDate)).toBe("2026-02-21");
	});
});

describe("Zakat year overrides in Dexie", () => {
	const USER_ID = "user-zakat-calendar";

	beforeEach(async () => {
		await db.zakatYears.clear();
	});

	it("round-trips an anchor and regenerates the months from it", async () => {
		const saved = await saveZakatYearOverride({
			userId: USER_ID,
			islamicYear: 1447,
			ramadanStart: new Date(2026, 1, 21, 17, 45),
		});

		expect(saved.id).toBe(buildZakatYearOverrideId(USER_ID, 1447));
		expect(saved.source).toBe("manual");
		// Stored at local midnight, not the time of day the user happened to pick.
		expect(toLocalDateKey(new Date(saved.ramadanStart))).toBe("2026-02-21");
		expect(new Date(saved.ramadanStart).getHours()).toBe(0);

		const stored = await db.zakatYears.get(saved.id);
		expect(stored?.pendingSync).toBe(true);

		const ramadanStarts = toRamadanStartMap(await listZakatYearOverrides(USER_ID));
		const definition = buildZakatYearDefinition(1447, ramadanStarts.get(1447));

		expect(definition.ramadanSource).toBe("manual");
		expect(toLocalDateKey(definition.months[0]!.startDate)).toBe("2026-02-21");
		expect(definition.months).toHaveLength(12);
	});

	it("soft-deletes on reset so the default anchor returns", async () => {
		await saveZakatYearOverride({
			userId: USER_ID,
			islamicYear: 1446,
			ramadanStart: new Date(2025, 2, 4),
		});
		await clearZakatYearOverride(USER_ID, 1446);

		const stored = await db.zakatYears.get(buildZakatYearOverrideId(USER_ID, 1446));
		expect(stored?.deletedAt).toBeTypeOf("number");

		const ramadanStarts = toRamadanStartMap(await listZakatYearOverrides(USER_ID));
		expect(ramadanStarts.has(1446)).toBe(false);
		expect(
			toLocalDateKey(buildZakatYearDefinition(1446, ramadanStarts.get(1446)).months[0]!.startDate)
		).toBe("2025-03-02");
	});
});
