"use client";

import { eachMonthOfInterval, format } from "date-fns";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { CARD_SURFACE } from "@/lib/motion";
import { upsertMonthlySalaryRow } from "@/lib/reports/reportRepository";
import { cn } from "@/lib/utils";

import type { ReportMonthlySalaryValues } from "@/lib/reports/reportRepository";
import type { ReportMonthlySalaryRow } from "@/types";

type SalaryTextField = "company";
type SalaryNumberField = "salaryPkr" | "salaryUsd" | "taxablePkr" | "providentFundRefund";
type SalaryField = SalaryTextField | SalaryNumberField;

const SALARY_FIELDS: Array<{ key: SalaryField; label: string; numeric: boolean }> = [
	{ key: "company", label: "Company", numeric: false },
	{ key: "salaryPkr", label: "Salary (PKR)", numeric: true },
	{ key: "salaryUsd", label: "Salary (USD)", numeric: true },
	// Typed in by the user exactly as they record it — never derived from anything.
	{ key: "taxablePkr", label: "Taxable (PKR)", numeric: true },
	{ key: "providentFundRefund", label: "Provident Fund Refund", numeric: true },
];

const MAX_MONTH_COLUMNS = 24;

interface ReportSalaryGridProps {
	userId: string;
	fiscalYearKey: string;
	fromMs: number;
	toMs: number;
	rows: ReportMonthlySalaryRow[];
}

function toInputValue(value: string | number | undefined): string {
	if (value === undefined) return "";
	return String(value);
}

export function ReportSalaryGrid({
	userId,
	fiscalYearKey,
	fromMs,
	toMs,
	rows,
}: ReportSalaryGridProps) {
	const [drafts, setDrafts] = useState<Record<string, string>>({});

	const months = useMemo(
		() =>
			eachMonthOfInterval({ start: new Date(fromMs), end: new Date(toMs) })
				.slice(0, MAX_MONTH_COLUMNS)
				.map((month) => ({ key: format(month, "yyyy-MM"), label: format(month, "MMM yy") })),
		[fromMs, toMs]
	);

	const rowByMonthKey = useMemo(() => new Map(rows.map((row) => [row.monthKey, row])), [rows]);

	function readStored(monthKey: string, field: SalaryField): string {
		return toInputValue(rowByMonthKey.get(monthKey)?.[field]);
	}

	async function persist(monthKey: string, field: SalaryField, rawValue: string) {
		const stored = readStored(monthKey, field);
		setDrafts((previous) => {
			const next = { ...previous };
			delete next[`${monthKey}:${field}`];
			return next;
		});
		if (rawValue === stored) return;

		const values: ReportMonthlySalaryValues = {};
		if (field === "company") {
			values.company = rawValue.trim() || undefined;
		} else {
			const parsed = rawValue === "" ? undefined : Number.parseFloat(rawValue);
			values[field] = parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;
		}

		try {
			await upsertMonthlySalaryRow(userId, fiscalYearKey, monthKey, values);
			toast.success("Salary grid saved.");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not save the salary grid.");
		}
	}

	return (
		<section className={cn(CARD_SURFACE, "space-y-4 p-4")} aria-labelledby="report-salary-heading">
			<div>
				<h2 id="report-salary-heading" className="text-sm font-semibold">
					Monthly salary
				</h2>
				<p className="text-xs text-muted-foreground">
					Every cell is your own number. Nothing in this grid is calculated.
				</p>
			</div>

			<div className="overflow-x-auto">
				<table className="w-full border-separate border-spacing-0 text-sm">
					<thead>
						<tr>
							<th
								scope="col"
								className="sticky left-0 z-10 bg-card px-2 py-2 text-left text-xs font-semibold text-muted-foreground">
								Month
							</th>
							{months.map((month) => (
								<th
									key={month.key}
									scope="col"
									className="px-2 py-2 text-left text-xs font-semibold whitespace-nowrap text-muted-foreground">
									{month.label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{SALARY_FIELDS.map((field) => (
							<tr key={field.key}>
								<th
									scope="row"
									className="sticky left-0 z-10 bg-card px-2 py-1 text-left text-xs font-medium whitespace-nowrap">
									{field.label}
								</th>
								{months.map((month) => {
									const draftKey = `${month.key}:${field.key}`;
									const value = drafts[draftKey] ?? readStored(month.key, field.key);

									return (
										<td key={draftKey} className="px-1 py-1">
											<Input
												aria-label={`${field.label} for ${month.label}`}
												type={field.numeric ? "number" : "text"}
												step={field.numeric ? "any" : undefined}
												inputMode={field.numeric ? "decimal" : undefined}
												value={value}
												className="h-9 w-28 min-w-28 text-xs"
												onChange={(event) =>
													setDrafts((previous) => ({
														...previous,
														[draftKey]: event.target.value,
													}))
												}
												onBlur={(event) => void persist(month.key, field.key, event.target.value)}
											/>
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</section>
	);
}
