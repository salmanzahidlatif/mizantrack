import { format } from "date-fns";
import * as XLSX from "xlsx";

interface ZakatExportData {
	assessmentDate: Date;
	nisabStandard: "gold" | "silver";
	goldPricePerGram: number;
	silverPricePerGram: number;
	goldWeightGrams: number;
	nisabThreshold: number;
	totalZakatable: number;
	zakatObligation: number;
	referenceCurrency: string;
	accounts: Array<{
		title: string;
		currency: string;
		balance: number;
		exchangeRate: number;
		balanceInRef: number;
		zakatable: boolean;
	}>;
}

export function exportZakatSummary(data: ZakatExportData) {
	const wb = XLSX.utils.book_new();

	// Summary sheet
	const summary = [
		{ Field: "Assessment Date", Value: format(data.assessmentDate, "d MMMM yyyy") },
		{ Field: "Reference Currency", Value: data.referenceCurrency },
		{
			Field: "Nisab Standard",
			Value: data.nisabStandard === "gold" ? "Gold (85g)" : "Silver (595g)",
		},
		{ Field: "Gold Price per Gram (USD)", Value: data.goldPricePerGram },
		{ Field: "Silver Price per Gram (USD)", Value: data.silverPricePerGram || "—" },
		{ Field: "Gold Weight (grams)", Value: data.goldWeightGrams },
		{ Field: `Nisab Threshold (${data.referenceCurrency})`, Value: data.nisabThreshold.toFixed(2) },
		{
			Field: `Total Zakatable Wealth (${data.referenceCurrency})`,
			Value: data.totalZakatable.toFixed(2),
		},
		{
			Field: `Zakat Obligation (${data.referenceCurrency})`,
			Value: data.zakatObligation > 0 ? data.zakatObligation.toFixed(2) : "Not yet liable",
		},
	];

	XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Summary");

	// Accounts sheet
	const accountRows = data.accounts.map((a) => ({
		Account: a.title,
		Currency: a.currency,
		Balance: a.balance.toFixed(2),
		"Exchange Rate": a.exchangeRate,
		[`Balance (${data.referenceCurrency})`]: a.balanceInRef.toFixed(2),
		Zakatable: a.zakatable ? "Yes" : "No",
	}));

	XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(accountRows), "Accounts");

	const filename = `zakat-assessment-${format(data.assessmentDate, "yyyy-MM-dd")}.xlsx`;
	XLSX.writeFile(wb, filename);
}
