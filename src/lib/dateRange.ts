import {
	startOfDay,
	endOfDay,
	startOfWeek,
	endOfWeek,
	startOfMonth,
	endOfMonth,
	startOfQuarter,
	endOfQuarter,
	startOfYear,
	endOfYear,
} from "date-fns";

import type { FilterPeriod, DateRange } from "@/types";

export function getDateRange(
	period: FilterPeriod,
	fiscalYearStartMonth = 7, // July
	customRange?: DateRange
): DateRange {
	const now = new Date();
	const y = now.getFullYear();
	const m = now.getMonth() + 1; // 1-based

	switch (period) {
		case "today":
			return { from: startOfDay(now), to: endOfDay(now) };

		case "week":
			return {
				from: startOfWeek(now, { weekStartsOn: 0 }),
				to: endOfWeek(now, { weekStartsOn: 0 }),
			};

		case "month":
			return { from: startOfMonth(now), to: endOfMonth(now) };

		case "quarter":
			return { from: startOfQuarter(now), to: endOfQuarter(now) };

		case "half-year": {
			const inFirstHalf = m <= 6;
			return {
				from: inFirstHalf ? new Date(y, 0, 1) : new Date(y, 6, 1),
				to: inFirstHalf ? new Date(y, 5, 30, 23, 59, 59) : new Date(y, 11, 31, 23, 59, 59),
			};
		}

		case "year":
			return { from: startOfYear(now), to: endOfYear(now) };

		case "fiscal-year": {
			const fsm = fiscalYearStartMonth - 1; // 0-based month index
			const fyStartYear = m - 1 >= fsm ? y : y - 1;
			const fyStart = new Date(fyStartYear, fsm, 1);
			const fyEnd = new Date(fyStartYear + 1, fsm, 0, 23, 59, 59);
			return { from: fyStart, to: fyEnd };
		}

		case "custom":
			return customRange ?? { from: startOfMonth(now), to: endOfMonth(now) };

		case "all":
			// Return epoch-start (0) as `from` so useTransactions skips the from-filter (0 is falsy)
			return { from: new Date(0), to: new Date(8640000000000000) };

		default:
			return { from: startOfMonth(now), to: endOfMonth(now) };
	}
}
