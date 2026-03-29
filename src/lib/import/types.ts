import type { TransactionType } from "@/types";

export interface HKAccountRow {
	Title: string;
	"Opening Balance"?: number;
	"Balance Amount"?: number;
	"Closing Balance"?: number;
}

export interface HKCategoryRow {
	Title: string;
	"Balance Amount"?: number;
	"Category Type": "Income" | "Expense";
}

export interface HKActivityRow {
	"Voucher Type": TransactionType;
	"Voucher Date": string;
	"Voucher Amount": number;
	Description?: string;
	"Category Name"?: string;
	"Account Name": string;
	Tags?: string;
	Place?: string;
	"Travel Currency Rate"?: number;
	"Travel Currency Symbol"?: string;
	"Travel Currency Amount"?: number;
	"Travel Location"?: string;
}

export interface HKTransferCandidate {
	date: number;
	amount: number;
	accountId: string;
	rowIndex: number;
}
