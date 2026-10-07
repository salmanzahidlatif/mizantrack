import * as XLSX from "xlsx";

import { db } from "./db/local";
import {
	buildHysabKytabSqliteExport,
	HYSAB_KYTAB_SQLITE_FLEX_MAPPING,
} from "./export/hysabKytabSqlite";
import { buildMizanTrackBackupWorkbook } from "./export/mizanTrackWorkbook";

import type { DateRange } from "@/types";

export interface ExportOptions {
	/** Only export accounts/transactions in this currency. */
	currency: string;
	/** If false, only non-archived accounts are included in the ACCOUNT sheet (and their transactions). Archived accounts are always still resolvable so their transactions are never orphaned. */
	includeArchivedAccounts: boolean;
}

function normalizeCurrency(value: string | undefined): string {
	return value?.trim().toUpperCase() ?? "";
}

export async function exportToExcel(userId: string, range: DateRange, options: ExportOptions) {
	const { currency, includeArchivedAccounts } = options;
	const selectedCurrency = normalizeCurrency(currency);

	const [allAccounts, categories, allTransactions] = await Promise.all([
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

	// Every non-deleted account is resolvable for transaction lookups (even if
	// archived and excluded from the ACCOUNT sheet below) — this avoids ever
	// silently blanking out a transaction's "Account Name" column.
	const accMap = new Map(allAccounts.map((a) => [a.id, a.title]));
	const catMap = new Map(categories.map((c) => [c.id, c.title]));

	// Accounts actually listed in the ACCOUNT sheet: filtered by currency, and
	// by active-only vs. all (archived included) per the user's choice.
	const accountsInCurrency = allAccounts.filter(
		(a) =>
			(normalizeCurrency(a.currency) === selectedCurrency || !normalizeCurrency(a.currency)) &&
			(includeArchivedAccounts || !a.isArchived)
	);
	const accountIdsInCurrency = new Set(accountsInCurrency.map((a) => a.id));

	// A transaction belongs to this export if its source account (or, for
	// transfers, either the source or destination account) is in the selected
	// currency — this keeps both legs of a same-currency transfer together.
	const transactions = allTransactions.filter((t) => {
		const sourceInCurrency = accountIdsInCurrency.has(t.accountId);
		const destInCurrency = Boolean(t.toAccountId) && accountIdsInCurrency.has(t.toAccountId!);
		return sourceInCurrency || destInCurrency;
	});

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

	const wb = await buildMizanTrackBackupWorkbook(userId);

	XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(actRows), "ACTIVITIES");
	XLSX.utils.book_append_sheet(
		wb,
		XLSX.utils.json_to_sheet(
			accountsInCurrency.map((a) => ({
				Title: a.isArchived ? `${a.title} (Closed)` : a.title,
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

	XLSX.writeFile(wb, `mizantrack-backup-${selectedCurrency || "all"}-${Date.now()}.xlsx`);
}

function writeBinaryFile(bytes: Uint8Array, filename: string) {
	const blobPart = bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength
	) as ArrayBuffer;
	const blob = new Blob([blobPart], { type: "application/vnd.sqlite3" });
	const url = URL.createObjectURL(blob);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = filename;
	document.body.appendChild(anchor);
	anchor.click();
	anchor.remove();
	URL.revokeObjectURL(url);
}

export async function exportToHysabKytabSqliteDb(
	userId: string,
	range: DateRange,
	options: ExportOptions
) {
	const { bytes } = await buildHysabKytabSqliteExport(userId, range, options);
	writeBinaryFile(bytes, `mizantrack-hysab-kytab-${options.currency}-${Date.now()}.db`);
}

export {
	buildHysabKytabSqliteExport,
	buildMizanTrackBackupWorkbook,
	HYSAB_KYTAB_SQLITE_FLEX_MAPPING,
};
export {
	buildMizanTrackBackupWorkbookBytes,
	decodeMizanTrackBackupWorkbook,
	MIZAN_TRACK_BACKUP_ENCODING,
	MIZAN_TRACK_BACKUP_SHEETS,
	SECURITY_EXCLUDED_DB_CONFIG_FIELDS,
} from "./export/mizanTrackWorkbook";
