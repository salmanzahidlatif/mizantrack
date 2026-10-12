"use client";

import { format } from "date-fns";

import { reportListScrollClass } from "@/components/reports/reportScroll";
import { CurrencyAmount } from "@/components/shared/CurrencyAmount";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { CARD_SURFACE } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type { ReportIncome } from "@/types";

const SCROLL_AFTER_ROWS = 6;

interface ReportIncomesSectionProps {
	incomes: ReportIncome[];
	total: number;
}

export function ReportIncomesSection({ incomes, total }: ReportIncomesSectionProps) {
	const totalCurrency = incomes[0]?.currency;

	return (
		<section className={cn(CARD_SURFACE, "space-y-4 p-4")} aria-labelledby="report-incomes-heading">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h2 id="report-incomes-heading" className="text-sm font-semibold">
						Incomes
					</h2>
					<p className="text-xs text-muted-foreground">
						Income you confirmed for this period, in the selected currency.
					</p>
				</div>
				{incomes.length > 0 && (
					<CurrencyAmount amount={total} currency={totalCurrency} className="text-base" />
				)}
			</div>

			{incomes.length === 0 ? (
				<p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
					No confirmed income yet. Confirm a suggestion above to add one.
				</p>
			) : (
				<div
					className={cn(
						"overflow-x-auto",
						reportListScrollClass(incomes.length, SCROLL_AFTER_ROWS)
					)}
					tabIndex={0}
					role="group"
					aria-label="Confirmed incomes">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-28">Date</TableHead>
								<TableHead>Title</TableHead>
								<TableHead className="text-right">Amount</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{incomes.map((income) => (
								<TableRow key={income.transactionId}>
									<TableCell className="whitespace-nowrap text-muted-foreground">
										{format(income.date, "d MMM yyyy")}
									</TableCell>
									<TableCell className="max-w-48 truncate">{income.title}</TableCell>
									<TableCell className="text-right">
										<CurrencyAmount
											amount={income.amount}
											currency={income.currency}
											className="text-sm"
										/>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</section>
	);
}
