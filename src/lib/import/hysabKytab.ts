import { v4 as uuid, v5 as uuidv5 } from "uuid";
import * as XLSX from "xlsx";

import { scheduleAnalyticsRecompute } from "@/lib/analytics/scheduleRecompute";
import { db } from "@/lib/db/local";

import type { HKAccountRow, HKActivityRow, HKCategoryRow } from "./types";
import type { Transaction } from "@/types";

/** Stable namespace UUID for deterministic HK import transaction IDs. */
const HK_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const EXACT_COMPLEMENT_SCORE = 100;

/**
 * Deterministic transaction ID based on userId + row index.
 * Importing the same file twice always produces the same IDs → idempotent upserts.
 */
function makeHKTxnId(userId: string, rowIndex: number): string {
	return uuidv5(`${userId}|${rowIndex}`, HK_NAMESPACE);
}

/** Strip a trailing " (Closed)" marker (case-insensitive) from an HK name. */
function stripClosed(name: string): string {
	return name.replace(/\s*\(closed\)\s*$/i, "").trim();
}

/** Normalize for fuzzy lookup: lowercase, collapse whitespace/hyphens/tildes. */
function normalizeName(name: string): string {
	return name
		.toLowerCase()
		.replace(/[\s\-~]+/g, "")
		.trim();
}

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
	// Unrecognised format — fall back to 1 Jan 2000 so historical filters are not polluted
	return new Date(2000, 0, 1).getTime();
}

function normalizeTransferText(value: unknown): string {
	return String(value ?? "")
		.toLowerCase()
		.replace(/\s*\(closed\)\s*$/i, "")
		.replace(/~/g, "-")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

function normalizeTransferToken(value: unknown): string {
	return normalizeTransferText(value).replace(/\s+/g, "");
}

function getTransferMatchKey(row: HKActivityRow): string {
	const dateStr = String(row["Voucher Date"] ?? "").trim();
	const absAmount = Math.abs(Number(row["Voucher Amount"]));
	const dateKey = dateStr === "" ? `EMPTY|${normalizeTransferText(row["Description"])}` : dateStr;
	return `${dateKey}|${absAmount.toFixed(2)}`;
}

function getTransferPairScore(sourceRow: HKActivityRow, destRow: HKActivityRow): number {
	const sourceDescription = normalizeTransferText(sourceRow["Description"]);
	const destDescription = normalizeTransferText(destRow["Description"]);
	const sourceAccount = normalizeTransferText(sourceRow["Account Name"]);
	const destAccount = normalizeTransferText(destRow["Account Name"]);
	const sourceDescriptionToken = normalizeTransferToken(sourceRow["Description"]);
	const destDescriptionToken = normalizeTransferToken(destRow["Description"]);
	const sourceAccountToken = normalizeTransferToken(sourceRow["Account Name"]);
	const destAccountToken = normalizeTransferToken(destRow["Account Name"]);
	const sourceMentionsDestination = destAccount !== "" && sourceDescription.includes(destAccount);
	const destinationMentionsSource = sourceAccount !== "" && destDescription.includes(sourceAccount);

	let score = 0;

	if (
		sourceDescriptionToken &&
		destDescriptionToken &&
		sourceDescriptionToken === destAccountToken &&
		destDescriptionToken === sourceAccountToken
	) {
		score += EXACT_COMPLEMENT_SCORE;
	}

	if (sourceMentionsDestination && destinationMentionsSource) {
		score += 60;
	} else {
		if (sourceMentionsDestination) score += 25;
		if (destinationMentionsSource) score += 25;
	}

	if (sourceDescription && sourceDescription === destDescription) score += 10;

	return score;
}

export async function importHysabKytab(file: File, userId: string, targetCurrency?: string) {
	const buffer = await file.arrayBuffer();
	const wb = XLSX.read(buffer);
	const now = Date.now();

	// Use targetCurrency if provided (from import wizard), otherwise fall back to user config or PKR
	const userConfig = await db.dbConfig.get(userId);
	const defaultCurrency = targetCurrency ?? userConfig?.currency ?? "PKR";

	// --- Accounts ---
	const accountSheet = wb.Sheets["ACCOUNT"];
	if (!accountSheet) {
		throw new Error("ACCOUNT sheet not found in the Excel file.");
	}

	const accRows = XLSX.utils.sheet_to_json<HKAccountRow>(accountSheet);
	const accountMap = new Map<string, string>(); // rawName → id
	const normalizedAccountMap = new Map<string, string>(); // normalized → id

	for (const row of accRows) {
		const rawTitle = row["Title"];
		const isClosed = /\s*\(closed\)\s*$/i.test(rawTitle);
		// Strip (Closed), trim spaces, convert HK tilde-encoding to hyphens
		const cleanTitle = (isClosed ? stripClosed(rawTitle) : rawTitle.trim()).replace(/~/g, "-");

		const existing = await db.accounts
			.where("userId")
			.equals(userId)
			.and((a) => a.title === cleanTitle)
			.first();

		const id = existing?.id ?? uuid();

		// Register under every lookup variant so activity references always resolve
		accountMap.set(rawTitle, id); // exact raw (e.g. "Huma Bajo " or "Saving~2")
		accountMap.set(rawTitle.trim(), id); // trimmed
		accountMap.set(cleanTitle, id); // final display name
		if (isClosed) {
			accountMap.set(stripClosed(rawTitle), id); // without (Closed) suffix
		}
		normalizedAccountMap.set(normalizeName(cleanTitle), id); // fuzzy

		await db.accounts.put({
			id,
			userId,
			title: cleanTitle,
			openingBalance: Number(row["Opening Balance"]) || 0,
			currency: defaultCurrency,
			isArchived: isClosed,
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
			.replace(/~/g, "-")
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

	const autoCreatedAccounts = new Set<string>();

	/**
	 * Resolve activity account name → Dexie account ID.
	 * Auto-creates an archived account if not found — no transaction is ever skipped.
	 * Empty names and "No Account" placeholder become an archived "No Account" account.
	 */
	const resolveOrCreateAccountId = async (name: string): Promise<string> => {
		const lookup = name?.trim() || "No Account";

		// Fast path: check all registered map variants
		const found =
			accountMap.get(name) ??
			accountMap.get(lookup) ??
			accountMap.get(stripClosed(lookup)) ??
			normalizedAccountMap.get(normalizeName(lookup));
		if (found) return found;

		// Slow path: auto-create an archived account for deleted/renamed/missing accounts
		const cleanTitle = lookup.replace(/~/g, "-");

		// Already auto-created earlier in this import run?
		const alreadyCreated = accountMap.get(cleanTitle);
		if (alreadyCreated) return alreadyCreated;

		// Check DB in case it exists from a prior import
		const dbExisting = await db.accounts
			.where("userId")
			.equals(userId)
			.and((a) => a.title === cleanTitle)
			.first();

		const id = dbExisting?.id ?? uuid();
		accountMap.set(name, id);
		accountMap.set(cleanTitle, id);
		normalizedAccountMap.set(normalizeName(cleanTitle), id);

		if (!dbExisting) {
			await db.accounts.put({
				id,
				userId,
				title: cleanTitle,
				openingBalance: 0,
				currency: defaultCurrency,
				isArchived: true,
				updatedAt: now,
			});
		}
		autoCreatedAccounts.add(cleanTitle);
		return id;
	};

	let imported = 0;
	let transfersPaired = 0;
	let unmatchedTransferAdjustments = 0;

	const processedIndexes = new Set<number>();

	// First pass: identify all transfers
	const transfers = actRows
		.map((row, i: number) => ({ row, i }))
		.filter(({ row }) => row["Voucher Type"] === "Transfer");

	/**
	 * Pre-process all transfers to find matching pairs BEFORE importing.
	 * This handles:
	 * 1. Empty dates (matched by description similarity)
	 * 2. Order independence (positive-before-negative or vice versa)
	 * 3. Bidirectional matching (either sign can initiate the match)
	 */
	interface TransferPair {
		sourceIdx: number;
		destIdx: number;
		sourceRow: HKActivityRow;
		destRow: HKActivityRow;
	}

	const pairs: TransferPair[] = [];

	// Build a map of candidates by date+amount for deterministic matching.
	const candidatesByKey = new Map<
		string,
		Array<{ row: HKActivityRow; i: number; amount: number }>
	>();

	for (const { row, i } of transfers) {
		const amount = Number(row["Voucher Amount"]);
		const key = getTransferMatchKey(row);

		if (!candidatesByKey.has(key)) {
			candidatesByKey.set(key, []);
		}
		candidatesByKey.get(key)!.push({ row, i, amount });
	}

	// Match pairs from the candidate map
	for (const [_key, candidates] of candidatesByKey.entries()) {
		if (candidates.length < 2) continue; // No pairs possible

		const negatives = candidates.filter((c) => c.amount < 0);
		const positives = candidates.filter((c) => c.amount > 0);
		const pairCandidates = negatives.flatMap((neg) =>
			positives
				.filter(
					(pos) =>
						normalizeTransferToken(pos.row["Account Name"]) !==
						normalizeTransferToken(neg.row["Account Name"])
				)
				.map((pos) => ({
					neg,
					pos,
					score: getTransferPairScore(neg.row, pos.row),
					distance: Math.abs(neg.i - pos.i),
					accountPairKey: `${normalizeTransferText(neg.row["Account Name"])}→${normalizeTransferText(
						pos.row["Account Name"]
					)}`,
				}))
		);

		pairCandidates.sort(
			(a, b) =>
				b.score - a.score ||
				a.distance - b.distance ||
				a.accountPairKey.localeCompare(b.accountPairKey) ||
				a.neg.i - b.neg.i ||
				a.pos.i - b.pos.i
		);

		const usedNegatives = new Set<number>();
		const usedPositives = new Set<number>();

		for (const candidate of pairCandidates) {
			const { neg, pos } = candidate;
			if (usedNegatives.has(neg.i) || usedPositives.has(pos.i)) continue;

			pairs.push({
				sourceIdx: neg.i,
				destIdx: pos.i,
				sourceRow: neg.row,
				destRow: pos.row,
			});

			usedNegatives.add(neg.i);
			usedPositives.add(pos.i);
			processedIndexes.add(neg.i);
			processedIndexes.add(pos.i);
		}
	}

	// Import all paired transfers
	for (const pair of pairs) {
		const date = parseHKDate(String(pair.sourceRow["Voucher Date"]));
		const amount = Math.abs(Number(pair.sourceRow["Voucher Amount"]));
		const accountId = await resolveOrCreateAccountId(pair.sourceRow["Account Name"]);
		const toAccountId = await resolveOrCreateAccountId(pair.destRow["Account Name"]);

		await db.transactions.put({
			id: makeHKTxnId(userId, pair.sourceIdx),
			userId,
			type: "Transfer",
			date,
			amount,
			description: pair.sourceRow["Description"] ?? "",
			accountId,
			toAccountId,
			updatedAt: now,
		});

		transfersPaired++;
		imported++;
	}

	// Import unmatched transfers as explicit one-sided adjustments.
	// A Transfer without a counterparty is invalid in MizanTrack because balance
	// math must conserve transfers. The HK sign tells us whether the one-sided row
	// increases or decreases the named account, so keep it visible as Income/Expense
	// rather than silently leaking value through a destination-less transfer.
	for (const { row, i } of transfers) {
		if (processedIndexes.has(i)) continue;

		const date = parseHKDate(String(row["Voucher Date"]));
		const rawAmount = Number(row["Voucher Amount"]);
		const amount = Math.abs(rawAmount);
		const accountId = await resolveOrCreateAccountId(row["Account Name"]);
		const type: "Income" | "Expense" = rawAmount > 0 ? "Income" : "Expense";
		const description = row["Description"]
			? `[HK unmatched transfer] ${row["Description"]}`
			: "[HK unmatched transfer]";

		await db.transactions.put({
			id: makeHKTxnId(userId, i),
			userId,
			type,
			date,
			amount,
			description,
			accountId,
			updatedAt: now,
		});

		unmatchedTransferAdjustments++;
		imported++;
	}

	// Second pass: non-transfer transactions
	for (let i = 0; i < actRows.length; i++) {
		const row = actRows[i];
		if (!row) continue;

		if (row["Voucher Type"] === "Transfer") continue;

		const accountId = await resolveOrCreateAccountId(row["Account Name"]);
		const resolvedCategoryId = categoryMap.get(row["Category Name"] ?? "");
		const resolvedPlace = row["Place"] ?? undefined;

		const tx: Transaction = {
			id: makeHKTxnId(userId, i),
			userId,
			type: row["Voucher Type"] as "Expense" | "Income",
			date: parseHKDate(String(row["Voucher Date"])),
			amount: Math.abs(Number(row["Voucher Amount"])),
			description: row["Description"] ?? "",
			accountId,
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
			const travelRate = Number(row["Travel Currency Rate"]);
			const travelAmount = Number(row["Travel Currency Amount"]);

			tx.travelCurrency = {
				symbol: row["Travel Currency Symbol"],
				rate: Number.isFinite(travelRate) ? travelRate : 0,
				amount: Number.isFinite(travelAmount) ? travelAmount : 0,
				location: row["Travel Location"] ?? "",
			};
		}

		await db.transactions.put(tx);
		imported++;
	}

	if (autoCreatedAccounts.size > 0) {
		console.warn("[HK Import] Auto-created archived accounts for missing/deleted names:", [
			...autoCreatedAccounts,
		]);
	}
	scheduleAnalyticsRecompute(userId);

	return {
		accounts: accRows.length,
		categories: catRows.length,
		transactions: imported,
		transfersPaired,
		unmatchedTransferAdjustments,
		autoCreated: autoCreatedAccounts.size,
		autoCreatedAccounts: [...autoCreatedAccounts],
	};
}
