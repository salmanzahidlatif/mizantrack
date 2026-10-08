import { normalizeCurrencyCode } from "@/lib/analytics/balanceMath";
import { recomputeAnalyticsNow } from "@/lib/analytics/scheduleRecompute";
import { db } from "@/lib/db/local";

import type { Account, Transaction } from "@/types";

export interface DuplicateAccountCandidate {
	account: Account;
	transactionCount: number;
	transactionIds: string[];
	openingBalance: number;
	isArchived: boolean;
}

export interface DuplicateAccountGroup {
	key: string;
	normalizedTitle: string;
	currency: string;
	candidates: DuplicateAccountCandidate[];
	totalTransactionCount: number;
	activeTransactionCount: number;
}

export interface MergeDuplicateAccountsResult {
	survivorId: string;
	loserIds: string[];
	movedTransactions: number;
	movedTransferLegs: number;
	selfTransfersCreated: number;
	absorbedOpeningBalance: number;
	softDeletedAccounts: number;
	activeTransactionsBefore: number;
	activeSurvivorTransactionsAfter: number;
}

/**
 * Hysab Kytab appends `~2`, `~3` … when it creates its own duplicate of an account,
 * so those suffixes are part of the duplicate identity rather than the real name.
 */
export function normalizeAccountTitle(title: string): string {
	return title.trim().replace(/~\d+$/, "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function accountCurrency(account: Account): string | undefined {
	const currency = normalizeCurrencyCode(account.currency);
	return currency === "" ? undefined : currency;
}

function getDuplicateKey(account: Account): string | undefined {
	const currency = accountCurrency(account);
	if (!currency) return undefined;
	return [currency, normalizeAccountTitle(account.title)].join("\u0000");
}

function referencesAccount(transaction: Transaction, accountId: string): boolean {
	return transaction.accountId === accountId || transaction.toAccountId === accountId;
}

export function buildAccountTransactionCounts(transactions: Transaction[]): Map<string, number> {
	const counts = new Map<string, number>();

	for (const transaction of transactions) {
		if (transaction.deletedAt) continue;
		for (const id of [transaction.accountId, transaction.toAccountId]) {
			if (!id) continue;
			counts.set(id, (counts.get(id) ?? 0) + 1);
		}
	}

	return counts;
}

function buildAccountTransactionIds(transactions: Transaction[]): Map<string, string[]> {
	const transactionIds = new Map<string, Set<string>>();

	for (const transaction of transactions) {
		if (transaction.deletedAt) continue;
		for (const id of [transaction.accountId, transaction.toAccountId]) {
			if (!id) continue;
			const ids = transactionIds.get(id) ?? new Set<string>();
			ids.add(transaction.id);
			transactionIds.set(id, ids);
		}
	}

	return new Map(
		Array.from(transactionIds.entries()).map(([accountId, ids]) => [accountId, Array.from(ids)])
	);
}

export function findDuplicateAccountGroups(
	accounts: Account[],
	transactions: Transaction[]
): DuplicateAccountGroup[] {
	const liveAccounts = accounts.filter((account) => !account.deletedAt);
	const groups = new Map<string, Account[]>();
	const transactionCounts = buildAccountTransactionCounts(transactions);
	const transactionIds = buildAccountTransactionIds(transactions);

	for (const account of liveAccounts) {
		const key = getDuplicateKey(account);
		if (!key) continue;
		const group = groups.get(key) ?? [];
		group.push(account);
		groups.set(key, group);
	}

	return Array.from(groups.entries())
		.filter(([, group]) => group.length > 1)
		.map(([key, group]) => {
			const first = group[0]!;
			const currency = accountCurrency(first)!;
			const groupAccountIds = new Set(group.map((account) => account.id));
			const activeTransactionCount = transactions.filter(
				(transaction) =>
					!transaction.deletedAt &&
					(groupAccountIds.has(transaction.accountId) ||
						(transaction.toAccountId ? groupAccountIds.has(transaction.toAccountId) : false))
			).length;
			const candidates = group
				.map((account) => ({
					account,
					transactionCount: transactionCounts.get(account.id) ?? 0,
					transactionIds: transactionIds.get(account.id) ?? [],
					openingBalance: account.openingBalance ?? 0,
					isArchived: Boolean(account.isArchived),
				}))
				.sort(
					(a, b) =>
						b.transactionCount - a.transactionCount ||
						a.account.title.localeCompare(b.account.title)
				);

			return {
				key,
				normalizedTitle: normalizeAccountTitle(first.title),
				currency,
				candidates,
				activeTransactionCount,
				totalTransactionCount: candidates.reduce(
					(total, candidate) => total + candidate.transactionCount,
					0
				),
			};
		})
		.sort(
			(a, b) =>
				a.currency.localeCompare(b.currency) || a.normalizedTitle.localeCompare(b.normalizedTitle)
		);
}

export async function loadDuplicateAccountGroups(userId: string): Promise<DuplicateAccountGroup[]> {
	const [accounts, transactions] = await Promise.all([
		db.accounts.where("userId").equals(userId).toArray(),
		db.transactions.where("userId").equals(userId).toArray(),
	]);

	return findDuplicateAccountGroups(accounts, transactions);
}

function assertSameDuplicateIdentity(accounts: Account[]) {
	const first = accounts[0];
	if (!first) throw new Error("Choose at least two accounts to merge.");

	const firstCurrency = accountCurrency(first);
	const firstTitle = normalizeAccountTitle(first.title);
	if (!firstCurrency) {
		throw new Error("Accounts without a currency are not merged by this tool.");
	}

	for (const account of accounts) {
		if (account.deletedAt) {
			throw new Error("Deleted accounts cannot be merged.");
		}
		if (accountCurrency(account) !== firstCurrency) {
			throw new Error("Only accounts in the same currency can be merged.");
		}
		if (normalizeAccountTitle(account.title) !== firstTitle) {
			throw new Error("Only duplicate accounts with the same title and currency can merge.");
		}
	}
}

export async function mergeDuplicateAccounts(
	userId: string,
	survivorId: string,
	loserIds: string[]
): Promise<MergeDuplicateAccountsResult> {
	const uniqueLoserIds = Array.from(new Set(loserIds)).filter((id) => id !== survivorId);
	if (uniqueLoserIds.length === 0) {
		throw new Error("Choose at least one duplicate account to merge.");
	}

	const now = Date.now();
	const candidateIds = [survivorId, ...uniqueLoserIds];
	let result: MergeDuplicateAccountsResult | undefined;

	await db.transaction("rw", db.accounts, db.transactions, async () => {
		const candidates = await db.accounts.where("id").anyOf(candidateIds).toArray();
		const byId = new Map(candidates.map((account) => [account.id, account]));
		const survivor = byId.get(survivorId);
		const losers = uniqueLoserIds.map((id) => byId.get(id));

		if (survivor?.userId !== userId) {
			throw new Error("Surviving account was not found.");
		}
		if (losers.some((account) => account?.userId !== userId)) {
			throw new Error("One or more duplicate accounts were not found.");
		}

		assertSameDuplicateIdentity([survivor, ...(losers as Account[])]);

		const transactionsInGroup = await db.transactions
			.where("userId")
			.equals(userId)
			.filter((transaction) => candidateIds.some((id) => referencesAccount(transaction, id)))
			.toArray();
		const activeTransactionsBefore = transactionsInGroup.filter(
			(transaction) => !transaction.deletedAt
		).length;

		const loserIdSet = new Set(uniqueLoserIds);
		let movedTransactions = 0;
		let movedTransferLegs = 0;
		let selfTransfersCreated = 0;

		for (const transaction of transactionsInGroup) {
			const changes: Partial<Transaction> = {};
			if (loserIdSet.has(transaction.accountId)) {
				changes.accountId = survivorId;
				movedTransactions += 1;
			}
			if (transaction.toAccountId && loserIdSet.has(transaction.toAccountId)) {
				changes.toAccountId = survivorId;
				movedTransferLegs += 1;
			}
			if (Object.keys(changes).length === 0) continue;

			const nextAccountId = changes.accountId ?? transaction.accountId;
			const nextToAccountId = changes.toAccountId ?? transaction.toAccountId;
			if (nextToAccountId && nextAccountId === nextToAccountId) {
				selfTransfersCreated += 1;
			}

			await db.transactions.update(transaction.id, { ...changes, updatedAt: now });
		}

		const absorbedOpeningBalance = (losers as Account[]).reduce(
			(total, account) => total + (account.openingBalance ?? 0),
			0
		);
		const survivorOpeningBalance =
			Math.round(((survivor.openingBalance ?? 0) + absorbedOpeningBalance) * 100) / 100;

		await db.accounts.update(survivorId, {
			openingBalance: survivorOpeningBalance,
			updatedAt: now,
		});

		for (const loser of losers as Account[]) {
			await db.accounts.update(loser.id, {
				openingBalance: 0,
				deletedAt: now,
				updatedAt: now,
			});
		}

		const survivorTransactions = await db.transactions
			.where("userId")
			.equals(userId)
			.filter((transaction) => !transaction.deletedAt && referencesAccount(transaction, survivorId))
			.toArray();
		const activeSurvivorTransactionsAfter = survivorTransactions.length;

		if (activeSurvivorTransactionsAfter !== activeTransactionsBefore) {
			throw new Error("Merge aborted because transaction counts would not be preserved.");
		}

		const orphaned = await db.transactions
			.where("userId")
			.equals(userId)
			.filter(
				(transaction) =>
					!transaction.deletedAt && uniqueLoserIds.some((id) => referencesAccount(transaction, id))
			)
			.count();
		if (orphaned > 0) {
			throw new Error("Merge aborted because some transactions still reference a merged account.");
		}

		result = {
			survivorId,
			loserIds: uniqueLoserIds,
			movedTransactions,
			movedTransferLegs,
			selfTransfersCreated,
			absorbedOpeningBalance: Math.round(absorbedOpeningBalance * 100) / 100,
			softDeletedAccounts: uniqueLoserIds.length,
			activeTransactionsBefore,
			activeSurvivorTransactionsAfter,
		};
	});

	await recomputeAnalyticsNow(userId);
	return result!;
}
