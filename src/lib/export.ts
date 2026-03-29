import * as XLSX from "xlsx";

import { db } from "./db/local";

import type { DateRange } from "@/types";

export async function exportToExcel(userId: string, range: DateRange) {
	const [accounts, categories, transactions] = await Promise.all([
		db.accounts
			.where("userId")
			.equals(userId)
			.filter((a) => !a.deletedAt)
			.toArray(),
		db.categories
			.where("userId")
			.equals(userId)
			.filter((c) => !c.deletedAt)
			.toArray(),
		db.transactions
			.where("userId")
			.equals(userId)
			.filter((t) => !t.deletedAt && t.date >= range.from.getTime() && t.date <= range.to.getTime())
			.toArray(),
	]);

	const accMap = new Map(accounts.map((a) => [a.id, a.title]));
	const catMap = new Map(categories.map((c) => [c.id, c.title]));

	const actRows = transactions.map((t) => ({
		"Voucher Type": t.type,
		"Voucher Date": new Date(t.date).toLocaleDateString("en-GB"),
		"Voucher Amount": t.type === "Expense" ? -t.amount : t.amount,
		Description: t.description ?? "",
		"Category Name": catMap.get(t.categoryId ?? "") ?? "No Category",
		"Account Name": accMap.get(t.accountId) ?? "",
		Tags: t.tags?.join(",") ?? "",
		Place: t.place ?? "",
		"Travel Currency Rate": t.travelCurrency?.rate ?? 0,
		"Travel Currency Symbol": t.travelCurrency?.symbol ?? "",
		"Travel Currency Amount": t.travelCurrency?.amount ?? 0,
		"Travel Location": t.travelCurrency?.location ?? "",
	}));

	const wb = XLSX.utils.book_new();

	XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(actRows), "ACTIVITIES");
	XLSX.utils.book_append_sheet(
		wb,
		XLSX.utils.json_to_sheet(
			accounts.map((a) => ({
				Title: a.title,
				"Opening Balance": a.openingBalance,
				"Balance Amount": 0,
				"Closing Balance": 0,
			}))
		),
		"ACCOUNT"
	);
	XLSX.utils.book_append_sheet(
		wb,
		XLSX.utils.json_to_sheet(
			categories.map((c) => ({
				Title: c.title,
				"Balance Amount": 0,
				"Category Type": c.type,
			}))
		),
		"CATEGORY"
	);

	XLSX.writeFile(wb, `mizantrack-export-${Date.now()}.xlsx`);
}
