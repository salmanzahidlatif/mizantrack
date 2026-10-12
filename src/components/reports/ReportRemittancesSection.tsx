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

import type { ReportRemittance } from "@/types";

const SCROLL_AFTER_ROWS = 6;

interface ReportRemittancesSectionProps {
	remittances: ReportRemittance[];
	total: number;
}

export function ReportRemittancesSection({ remittances, total }: ReportRemittancesSectionProps) {
	const totalCurrency = remittances[0]?.currency;

	return (
		<section
			className={cn(CARD_SURFACE, "space-y-4 p-4")}
			aria-labelledby="report-remittances-heading">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h2 id="report-remittances-heading" className="text-sm font-semibold">
						Remittances
					</h2>
					<p className="text-xs text-muted-foreground">
						Confirmed remittances in this period, in the selected currency.
					</p>
				</div>
				{remittances.length > 0 && (
					<CurrencyAmount amount={total} currency={totalCurrency} className="text-base" />
				)}
			</div>

			{remittances.length === 0 ? (
				<p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
					No confirmed remittances yet. Confirm a suggestion above to add one.
				</p>
			) : (
				<div
					className={cn(
						"overflow-x-auto",
						reportListScrollClass(remittances.length, SCROLL_AFTER_ROWS)
					)}
					tabIndex={0}
					role="group"
					aria-label="Confirmed remittances">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-28">Date</TableHead>
								<TableHead>Title</TableHead>
								<TableHead className="text-right">Amount</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{remittances.map((remittance) => (
								<TableRow key={remittance.transactionId}>
									<TableCell className="whitespace-nowrap text-muted-foreground">
										{format(remittance.date, "d MMM yyyy")}
									</TableCell>
									<TableCell className="max-w-48 truncate">{remittance.title}</TableCell>
									<TableCell className="text-right">
										<CurrencyAmount
											amount={remittance.amount}
											currency={remittance.currency}
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
