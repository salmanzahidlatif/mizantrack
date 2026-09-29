import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionMonthStrip } from "@/components/transactions/TransactionMonthStrip";
import { queryTransactionsWithStats } from "@/hooks/useTransactions";
import { getMonthRange } from "@/lib/dateRange";
import { db } from "@/lib/db/local";
import { UNCATEGORIZED_CATEGORY_FILTER } from "@/store/filter-store";

import type { Transaction } from "@/types";

const USER_ID = "transactions-filters-perf-user";
const OTHER_USER_ID = "transactions-filters-perf-other-user";
const ACCOUNT_ID = "transactions-filters-perf-account";
const CATEGORY_ID = "transactions-filters-perf-category";
const TIME_ZONE_OFFSET_MINUTES = 240;

function transaction(
	overrides: Partial<Transaction> & Pick<Transaction, "id" | "date">
): Transaction {
	return {
		userId: USER_ID,
		type: "Expense",
		amount: 10,
		accountId: ACCOUNT_ID,
		updatedAt: overrides.date,
		...overrides,
	};
}

describe("transactions month strip", () => {
	beforeEach(() => {
		Element.prototype.scrollIntoView = vi.fn();
	});

	it("announces the selected month, ignores global swipe navigation, and emits local month bounds", () => {
		const now = new Date("2026-09-29T13:52:21.000Z");
		const selectedMonth = getMonthRange(now, {
			timeZoneOffsetMinutes: TIME_ZONE_OFFSET_MINUTES,
		});
		const onSelectMonth = vi.fn();

		render(
			<TransactionMonthStrip
				selectedMonth={selectedMonth}
				now={now}
				timeZoneOffsetMinutes={TIME_ZONE_OFFSET_MINUTES}
				onSelectMonth={onSelectMonth}
			/>
		);

		expect(screen.getByLabelText("Browse transaction months")).toHaveAttribute(
			"data-swipe-navigation-ignore"
		);
		const selectedButton = screen.getByRole("button", {
			name: "Selected month, Sep 2026",
		});
		expect(selectedButton).toHaveAttribute("aria-current", "date");
		expect(selectedButton).toHaveAttribute("aria-pressed", "true");
		expect(screen.queryByRole("button", { name: "Select Oct 2026" })).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Select Aug 2026" }));

		expect(onSelectMonth).toHaveBeenCalledTimes(1);
		const [august] = onSelectMonth.mock.calls[0] as [ReturnType<typeof getMonthRange>];
		expect(august.from.toISOString()).toBe("2026-07-31T20:00:00.000Z");
		expect(august.to.toISOString()).toBe("2026-08-31T19:59:59.999Z");
	});
});

describe("transactions indexed filters", () => {
	beforeEach(async () => {
		await db.accounts.clear();
		await db.transactions.clear();
	});

	it("filters uncategorized transactions without including categorized rows", async () => {
		const now = Date.now();
		await db.transactions.bulkPut([
			transaction({ id: "uncategorized-1", date: now }),
			transaction({ id: "categorized", date: now - 1, categoryId: CATEGORY_ID }),
			transaction({ id: "uncategorized-2", date: now - 2 }),
		]);

		const result = await queryTransactionsWithStats(USER_ID, {
			categoryId: UNCATEGORIZED_CATEGORY_FILTER,
		});

		expect(result.transactions.map((item) => item.id)).toEqual([
			"uncategorized-1",
			"uncategorized-2",
		]);
		expect(result.transactions.every((item) => !item.categoryId)).toBe(true);
	});

	it("filters normal categories exactly", async () => {
		const now = Date.now();
		await db.transactions.bulkPut([
			transaction({ id: "food-1", date: now, categoryId: CATEGORY_ID }),
			transaction({ id: "uncategorized", date: now - 1 }),
			transaction({ id: "travel", date: now - 2, categoryId: "travel-category" }),
			transaction({ id: "food-2", date: now - 3, categoryId: CATEGORY_ID }),
		]);

		const result = await queryTransactionsWithStats(USER_ID, {
			categoryId: CATEGORY_ID,
		});

		expect(result.transactions.map((item) => item.id)).toEqual(["food-1", "food-2"]);
		expect(result.transactions.every((item) => item.categoryId === CATEGORY_ID)).toBe(true);
	});

	it("uses the user/date index so monthly queries do not scan a 10,000 row table", async () => {
		const september = getMonthRange(new Date("2026-09-15T12:00:00.000Z"), {
			timeZoneOffsetMinutes: TIME_ZONE_OFFSET_MINUTES,
		});
		const oldRows: Transaction[] = Array.from({ length: 10000 }, (_, index) =>
			transaction({
				id: `old-${index}`,
				date: Date.UTC(2025, 0, 1) + index * 60000,
			})
		);
		const monthRows: Transaction[] = Array.from({ length: 64 }, (_, index) =>
			transaction({
				id: `sept-${index}`,
				date: september.fromMs + index * 60000,
			})
		);
		const otherUserRows: Transaction[] = Array.from({ length: 96 }, (_, index) =>
			transaction({
				id: `other-${index}`,
				userId: OTHER_USER_ID,
				date: september.fromMs + index * 60000,
			})
		);
		await db.transactions.bulkPut([...oldRows, ...monthRows, ...otherUserRows]);

		const start = performance.now();
		const result = await queryTransactionsWithStats(USER_ID, {
			from: september.fromMs,
			to: september.toMs,
		});
		const duration = performance.now() - start;

		expect(result.stats.plan).toBe("user-date");
		expect(result.stats.indexedCandidateCount).toBe(64);
		expect(result.stats.matchedCount).toBe(64);
		expect(result.transactions).toHaveLength(64);
		expect(result.stats.indexedCandidateCount).toBeLessThan(oldRows.length + monthRows.length);
		expect({
			legacyUserIdScan: oldRows.length + monthRows.length,
			indexedCandidates: result.stats.indexedCandidateCount,
			durationMs: Math.round(duration * 10) / 10,
		}).toMatchObject({
			legacyUserIdScan: 10064,
			indexedCandidates: 64,
		});
	});
});
