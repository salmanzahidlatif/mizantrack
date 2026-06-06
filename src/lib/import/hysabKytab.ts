import { v4 as uuid } from "uuid";
import * as XLSX from "xlsx";

import { db } from "@/lib/db/local";

import type { HKAccountRow, HKActivityRow, HKCategoryRow } from "./types";
import type { Transaction } from "@/types";

function parseHKDate(raw: string): number {
	// Format: "29 00:00:00/07/2018" or "29/07/2018"
	const m1 = String(raw).match(/^(\d+)\s[\d:]+\/(\d+)\/(\d+)$/);
	if (m1) {
		// @ts-ignore
		return new Date(+m1[3], +m1[2] - 1, +m1[1]).getTime();
	}
	const m2 = String(raw).match(/^(\d+)\/(\d+)\/(\d+)$/);
	if (m2) {
		// @ts-ignore
		return new Date(+m2[3], +m2[2] - 1, +m2[1]).getTime();
	}
	return Date.now();
}

export async function importHysabKytab(file: File, userId: string) {
	const buffer = await file.arrayBuffer();
	const wb = XLSX.read(buffer);
	const now = Date.now();

	// Use the user's configured default currency; fall back to AED if not set
	const userConfig = await db.dbConfig.get(userId);
	const defaultCurrency = userConfig?.currency ?? "AED";

	// --- Accounts ---
	const accountSheet = wb.Sheets["ACCOUNT"];
	if (!accountSheet) {
		throw new Error("ACCOUNT sheet not found in the Excel file.");
	}

	const accRows = XLSX.utils.sheet_to_json<HKAccountRow>(accountSheet);
	const accountMap = new Map<string, string>(); // title → id

	for (const row of accRows) {
		const existing = await db.accounts
			.where("userId")
			.equals(userId)
			.and((a) => a.title === row["Title"])
			.first();

		const id = existing?.id ?? uuid();
		accountMap.set(row["Title"], id);

		await db.accounts.put({
			id,
			userId,
			title: row["Title"],
			openingBalance: Number(row["Opening Balance"]) || 0,
			currency: defaultCurrency,
			isArchived: false,
			updatedAt: now,
		});
	}

	// --- Categories ---
	const categorySheet = wb.Sheets["CATEGORY"];
	if (!categorySheet) {
		throw new Error("CATEGORY sheet not found in the Excel file.");
	}

	const catRows = XLSX.utils.sheet_to_json<HKCategoryRow>(categorySheet);
	const categoryMap = new Map<string, string>();

	for (const row of catRows) {
		const cleanTitle = String(row["Title"])
			.replace(/~\d+~\d+$/, "")
			.trim();
		const existing = await db.categories
			.where("userId")
			.equals(userId)
			.and((c) => c.title === cleanTitle)
			.first();

		const id = existing?.id ?? uuid();
		categoryMap.set(row["Title"], id);

		await db.categories.put({
			id,
			userId,
			title: cleanTitle,
			type: row["Category Type"] as "Income" | "Expense",
			updatedAt: now,
		});
	}

	// --- Transactions (with transfer pairing) ---
	const activitiesSheet = wb.Sheets["ACTIVITIES"];
	if (!activitiesSheet) {
		throw new Error("ACTIVITIES sheet not found in the Excel file.");
	}

	const actRows = XLSX.utils.sheet_to_json<HKActivityRow>(activitiesSheet);
	let imported = 0;
	let transfersPaired = 0;

	// Build transfer candidates: negative amount = source
	// const transferSources: HKTransferCandidate[] = [];
	const processedIndexes = new Set<number>();

	// First pass: identify all transfers
	const transfers = actRows
		.map((row, i: number) => ({ row, i }))
		.filter(({ row }) => row["Voucher Type"] === "Transfer");

	// Pair them: same date + same absolute amount + one negative one positive
	for (const { row, i } of transfers) {
		if (processedIndexes.has(i)) continue;

		const date = parseHKDate(String(row["Voucher Date"]));
		const amount = Number(row["Voucher Amount"]);
		const accountId = accountMap.get(row["Account Name"]) ?? "";

		if (amount < 0) {
			// This is the source — find the matching positive entry
			const matchIdx = transfers.findIndex(
				({ row: r2, i: i2 }) =>
					!processedIndexes.has(i2) &&
					i2 !== i &&
					parseHKDate(String(r2["Voucher Date"])) === date &&
					Math.abs(Number(r2["Voucher Amount"])) === Math.abs(amount) &&
					Number(r2["Voucher Amount"]) > 0
			);

			if (matchIdx !== -1) {
				const match = transfers[matchIdx];
				if (!match) continue; // safety check

				const toAccountId = accountMap.get(match.row["Account Name"]) ?? "";

				await db.transactions.put({
					id: uuid(),
					userId,
					type: "Transfer",
					date,
					amount: Math.abs(amount),
					description: row["Description"] ?? "",
					accountId,
					toAccountId,
					updatedAt: now,
				});

				processedIndexes.add(i);
				processedIndexes.add(match.i);
				transfersPaired++;
				imported++;
				continue;
			}
		}

		// Unmatched transfer — import as-is without toAccountId
		if (!processedIndexes.has(i)) {
			await db.transactions.put({
				id: uuid(),
				userId,
				type: "Transfer",
				date,
				amount: Math.abs(amount),
				description: row["Description"] ?? "",
				accountId,
				updatedAt: now,
			});
			processedIndexes.add(i);
			imported++;
		}
	}

	// Second pass: non-transfer transactions
	for (let i = 0; i < actRows.length; i++) {
		const row = actRows[i];
		if (!row) continue;

		if (row["Voucher Type"] === "Transfer") continue;

		const resolvedCategoryId = categoryMap.get(row["Category Name"] ?? "");
		const resolvedPlace = row["Place"] || undefined;

		const tx: Transaction = {
			id: uuid(),
			userId,
			type: row["Voucher Type"] as "Expense" | "Income",
			date: parseHKDate(String(row["Voucher Date"])),
			amount: Math.abs(Number(row["Voucher Amount"])),
			description: row["Description"] ?? "",
			accountId: accountMap.get(row["Account Name"]) ?? "",
			tags: row["Tags"]
				? String(row["Tags"])
						.split(",")
						.map((t: string) => t.trim())
				: [],
			updatedAt: now,
			...(resolvedCategoryId ? { categoryId: resolvedCategoryId } : {}),
			...(resolvedPlace ? { place: resolvedPlace } : {}),
		};

		if (row["Travel Currency Symbol"]) {
			tx.travelCurrency = {
				symbol: row["Travel Currency Symbol"],
				rate: Number(row["Travel Currency Rate"]) || 0,
				amount: Number(row["Travel Currency Amount"]) || 0,
				location: row["Travel Location"] ?? "",
			};
		}

		await db.transactions.put(tx);
		imported++;
	}

	return {
		accounts: accRows.length,
		categories: catRows.length,
		transactions: imported,
		transfersPaired,
	};
}
