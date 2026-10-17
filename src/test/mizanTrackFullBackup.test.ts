/**
 * Regression tests for the native MizanTrack full backup and restore.
 *
 * Covers: every Dexie table is backed up or explicitly excluded
 *         a full round trip through export → wipe → import matches field for field
 *         a second import of the same file writes nothing
 *         last-write-wins: an older incoming record loses, a newer one wins
 *         a soft-deleted record stays deleted
 *         a restore into a database that already holds unrelated data
 *         excluded tables and secrets never reach the file
 *         an unknown format version is refused without applying anything
 *         zakat and report inputs specifically survive
 */
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db, MIZAN_TRACK_DEXIE_VERSION, withoutSyncDirtyTracking } from "@/lib/db/local";
import { CORE_SYNC_TABLES } from "@/lib/db/sync";
import {
	buildMizanTrackFullBackup,
	buildMizanTrackFullBackupFilename,
	MIZAN_TRACK_FULL_BACKUP_DB_CONFIG_FIELDS,
	MIZAN_TRACK_FULL_BACKUP_EXCLUDED_DB_CONFIG_FIELDS,
	MIZAN_TRACK_FULL_BACKUP_EXCLUDED_TABLES,
	MIZAN_TRACK_FULL_BACKUP_FORMAT,
	MIZAN_TRACK_FULL_BACKUP_FORMAT_VERSION,
	MIZAN_TRACK_FULL_BACKUP_TABLES,
	serializeMizanTrackFullBackup,
} from "@/lib/export";
import {
	parseMizanTrackFullBackup,
	restoreMizanTrackFullBackup,
} from "@/lib/import/mizanTrackFullBackup";

import type { SyncDirtyFields } from "@/lib/db/local";
import type { MizanTrackFullBackupTable } from "@/lib/export/mizanTrackFullBackup";
import type {
	Account,
	Budget,
	Category,
	DbConfig,
	GoldItem,
	ReportAccountTag,
	ReportManualEntry,
	ReportMonthlySalaryRow,
	ReportProject,
	ReportTransactionTag,
	Transaction,
	ZakatCalculation,
	ZakatGoldYear,
	ZakatPayment,
	ZakatYearOverride,
} from "@/types";

vi.mock("@/lib/analytics/scheduleRecompute", () => ({
	flushAnalyticsRecompute: vi.fn(),
	recomputeAnalyticsNow: vi.fn(),
	scheduleAnalyticsRecompute: vi.fn(),
}));

const USER_ID = "full-backup-user";
const OTHER_USER_ID = "full-backup-other-user";
const BASE = 1_700_000_000_000;

function account(id: string, patch: Partial<Account> = {}): Account {
	return {
		id,
		userId: USER_ID,
		title: `Account ${id}`,
		openingBalance: 1_000,
		currency: "PKR",
		isArchived: false,
		updatedAt: BASE,
		...patch,
	};
}

function category(id: string, patch: Partial<Category> = {}): Category {
	return {
		id,
		userId: USER_ID,
		title: `Category ${id}`,
		type: "Expense",
		currency: "PKR",
		updatedAt: BASE,
		...patch,
	};
}

function transaction(id: string, patch: Partial<Transaction> = {}): Transaction {
	return {
		id,
		userId: USER_ID,
		type: "Expense",
		date: BASE,
		amount: 250,
		accountId: "acc-1",
		categoryId: "cat-1",
		updatedAt: BASE,
		...patch,
	};
}

function budget(id: string, patch: Partial<Budget> = {}): Budget {
	return {
		id,
		userId: USER_ID,
		categoryId: "cat-1",
		period: "2024-07",
		amount: 5_000,
		currency: "PKR",
		active: true,
		updatedAt: BASE,
		...patch,
	};
}

function goldItem(id: string, patch: Partial<GoldItem> = {}): GoldItem {
	return {
		id,
		userId: USER_ID,
		currency: "PKR",
		title: "Wedding set",
		weight: 170.52,
		purity: "21k",
		purchaseDate: BASE,
		purchasePrice: 900_000,
		notes: "inherited",
		updatedAt: BASE,
		...patch,
	};
}

function zakatCalculation(id: string, patch: Partial<ZakatCalculation> = {}): ZakatCalculation {
	return {
		id,
		userId: USER_ID,
		currency: "PKR",
		islamicYear: "1446-1447",
		assessmentDate: BASE,
		goldPricePerGram: 18_846.3,
		goldPricesByPurity: { "21k": 18_846.3, "22k": 19_600 },
		referenceCurrency: "PKR",
		basis: "minimum",
		ratePercent: 2.5,
		totalGoldWeightGrams: 170.52,
		totalGoldValue: 3_213_867.4,
		accountBalances: [
			{
				accountId: "acc-1",
				accountTitle: "Account acc-1",
				balance: 120_000,
				currency: "PKR",
				exchangeRate: 1,
				zakatable: true,
				accountType: "asset",
			},
		],
		totalZakatable: 3_333_867.4,
		zakatObligation: 83_346.69,
		monthlyBalances: [
			{ month: "Ramaḍān 1446", gregorianDate: "2025-03-02", totalWealth: 3_333_867.4 },
		],
		createdAt: BASE,
		updatedAt: BASE,
		...patch,
	};
}

function zakatPayment(id: string, patch: Partial<ZakatPayment> = {}): ZakatPayment {
	return {
		id,
		userId: USER_ID,
		calculationId: "zc-1",
		islamicYear: "1446-1447",
		date: BASE,
		amount: 40_000,
		currency: "PKR",
		recipient: "Local Masjid",
		notes: "first instalment",
		createdAt: BASE,
		updatedAt: BASE,
		...patch,
	};
}

function zakatYear(islamicYear: number, patch: Partial<ZakatYearOverride> = {}): ZakatYearOverride {
	return {
		id: `${USER_ID}:${islamicYear}`,
		userId: USER_ID,
		islamicYear,
		ramadanStart: BASE,
		source: "manual",
		pastRemainingOverride: 12_345,
		pastRemainingSource: "manual",
		selectedAccountIds: ["acc-1", "acc-2"],
		showArchivedAccounts: true,
		updatedAt: BASE,
		...patch,
	};
}

function zakatGoldYear(islamicYear: number, patch: Partial<ZakatGoldYear> = {}): ZakatGoldYear {
	return {
		id: `${USER_ID}:PKR:${islamicYear}`,
		userId: USER_ID,
		currency: "PKR",
		islamicYear,
		pricesByPurity: { "21k": 16_778.12, "22k": 17_500 },
		gramsByPurity: { "21k": 170.52 },
		priceDate: BASE,
		updatedAt: BASE,
		...patch,
	};
}

function reportAccountTag(id: string, patch: Partial<ReportAccountTag> = {}): ReportAccountTag {
	return {
		id,
		userId: USER_ID,
		accountId: "acc-1",
		includeInReport: true,
		isRemittanceSource: true,
		updatedAt: BASE,
		...patch,
	};
}

function reportProject(id: string, patch: Partial<ReportProject> = {}): ReportProject {
	return {
		id,
		userId: USER_ID,
		title: "BWC 7 Marla Overseas Block",
		note: "quarterly instalments",
		sortOrder: 1,
		updatedAt: BASE,
		...patch,
	};
}

function reportTransactionTag(
	id: string,
	patch: Partial<ReportTransactionTag> = {}
): ReportTransactionTag {
	return {
		id,
		userId: USER_ID,
		transactionId: "txn-1",
		role: "plot-payment",
		projectId: "proj-1",
		confirmed: true,
		updatedAt: BASE,
		...patch,
	};
}

function reportManualEntry(id: string, patch: Partial<ReportManualEntry> = {}): ReportManualEntry {
	return {
		id,
		userId: USER_ID,
		label: "Nayatel tax",
		amount: 4_285,
		currency: "PKR",
		section: "other",
		date: BASE,
		note: "annual",
		fiscalYearKey: "2024-2025",
		updatedAt: BASE,
		...patch,
	};
}

function reportMonthlySalaryRow(
	id: string,
	patch: Partial<ReportMonthlySalaryRow> = {}
): ReportMonthlySalaryRow {
	return {
		id,
		userId: USER_ID,
		fiscalYearKey: "2024-2025",
		monthKey: "2024-07",
		company: "Acme",
		salaryPkr: 500_000,
		salaryUsd: 1_800,
		taxablePkr: 450_000,
		providentFundRefund: 10_000,
		updatedAt: BASE,
		...patch,
	};
}

function fullDbConfig(): DbConfig {
	return {
		id: USER_ID,
		firebaseConfig: '{"apiKey":"super-secret-key"}',
		enabled: true,
		currency: "PKR",
		fiscalYearStartMonth: 7,
		goldApiKey: "gold-api-secret",
		lastGoldPricePerGram: 18_846.3,
		lastGoldPriceFetchedAt: BASE,
		pinHash: "0f".repeat(32),
		appLockEnabled: true,
		biometricEnabled: true,
		biometricCredentialId: "webauthn-credential-secret",
		enabledCurrencies: ["PKR", "AED"],
		hideAmounts: true,
	};
}

async function seedEverything(): Promise<void> {
	await withoutSyncDirtyTracking(async () => {
		await db.dbConfig.put(fullDbConfig());
		await db.accounts.bulkPut([
			account("acc-1"),
			account("acc-2", { accountType: "liability", color: "#f00", icon: "wallet" }),
			account("acc-archived", { isArchived: true, sourceId: "hk:PKR:account:19" }),
			account("acc-deleted", { deletedAt: BASE + 10 }),
		]);
		await db.categories.bulkPut([
			category("cat-1"),
			category("cat-2", { type: "Income", parentId: "cat-1", sourceId: "hk:PKR:category:5" }),
		]);
		await db.transactions.bulkPut([
			transaction("txn-1"),
			transaction("txn-2", {
				type: "Transfer",
				accountId: "acc-1",
				toAccountId: "acc-2",
				categoryId: undefined,
				tags: ["travel"],
				place: "Dubai",
				travelCurrency: { symbol: "AED", rate: 76.5, amount: 100, location: "Dubai" },
			}),
			transaction("txn-deleted", { deletedAt: BASE + 10 }),
		]);
		await db.budgets.bulkPut([budget("bud-1")]);
		await db.goldItems.bulkPut([goldItem("gold-1"), goldItem("gold-2", { purity: "22k" })]);
		await db.zakatCalculations.bulkPut([zakatCalculation("zc-1")]);
		await db.zakatPayments.bulkPut([zakatPayment("zp-1")]);
		await db.reportAccountTags.bulkPut([reportAccountTag("rat-1")]);
		await db.reportProjects.bulkPut([reportProject("proj-1")]);
		await db.reportTransactionTags.bulkPut([reportTransactionTag("rtt-1")]);
		await db.reportManualEntries.bulkPut([reportManualEntry("rme-1")]);
		await db.reportMonthlySalaryRows.bulkPut([reportMonthlySalaryRow("rms-1")]);
		await db.zakatYears.bulkPut([zakatYear(1445), zakatYear(1446)]);
		await db.zakatGoldYears.bulkPut([zakatGoldYear(1445), zakatGoldYear(1446)]);
		// Derived caches and sync bookkeeping exist, and must never reach the file.
		await db.dashboardStats.put({
			id: USER_ID,
			updatedAt: BASE,
			dataVersion: "v-local",
			balances: { "acc-1": 1_000 },
			perCurrency: {},
			recent: [],
		});
		await db.syncMeta.bulkPut([
			{ id: "lastSync", timestamp: BASE },
			{ id: "lastSync:accounts", timestamp: BASE },
		]);
	});
}

async function wipeEverything(): Promise<void> {
	await withoutSyncDirtyTracking(async () => {
		await Promise.all(db.tables.map((table) => table.clear()));
	});
}

type StoredRecord = Record<string, unknown>;

function stripLocalOnly(record: StoredRecord): StoredRecord {
	const clean: StoredRecord = {};
	for (const [key, value] of Object.entries(record)) {
		if (key === "pendingSync" || key === "syncedAt") continue;
		if (value === undefined) continue;
		clean[key] = value;
	}
	return clean;
}

async function snapshotSyncTables(): Promise<Record<string, StoredRecord[]>> {
	const snapshot: Record<string, StoredRecord[]> = {};
	for (const table of CORE_SYNC_TABLES) {
		const records = await db[table].where("userId").equals(USER_ID).toArray();
		snapshot[table] = records
			.map((record) => stripLocalOnly(record as unknown as StoredRecord))
			.sort((left, right) => String(left.id).localeCompare(String(right.id)));
	}
	return snapshot;
}

async function backupText(userId = USER_ID): Promise<string> {
	return serializeMizanTrackFullBackup(await buildMizanTrackFullBackup(userId));
}

describe("MizanTrack full backup — coverage", () => {
	beforeEach(async () => {
		await wipeEverything();
	});

	it("backs up or explicitly excludes every Dexie table", () => {
		const backedUp = new Set<string>(MIZAN_TRACK_FULL_BACKUP_TABLES);
		const excluded = new Set<string>(MIZAN_TRACK_FULL_BACKUP_EXCLUDED_TABLES);
		const dexieTables = db.tables.map((table) => table.name).sort();

		for (const name of dexieTables) {
			expect(
				backedUp.has(name) || excluded.has(name),
				`Dexie table "${name}" is neither backed up nor explicitly excluded. Add it to MIZAN_TRACK_FULL_BACKUP_TABLES (via CORE_SYNC_TABLES) or to MIZAN_TRACK_FULL_BACKUP_EXCLUDED_TABLES.`
			).toBe(true);
		}

		for (const name of [...backedUp, ...excluded]) {
			expect(dexieTables, `"${name}" is listed but is not a Dexie table`).toContain(name);
		}
		expect([...backedUp].filter((name) => excluded.has(name))).toEqual([]);
	});

	it("records the Dexie version the database actually declares", async () => {
		await db.open();
		expect(db.verno).toBe(MIZAN_TRACK_DEXIE_VERSION);
	});

	it("classifies every DbConfig field as carried or deliberately excluded", () => {
		const carried = new Set<string>(MIZAN_TRACK_FULL_BACKUP_DB_CONFIG_FIELDS);
		const excluded = new Set<string>(MIZAN_TRACK_FULL_BACKUP_EXCLUDED_DB_CONFIG_FIELDS);

		for (const field of Object.keys(fullDbConfig())) {
			if (field === "id") continue;
			expect(
				carried.has(field) || excluded.has(field),
				`DbConfig.${field} is neither backed up nor explicitly excluded.`
			).toBe(true);
		}
		expect([...carried].filter((field) => excluded.has(field))).toEqual([]);
	});

	it("writes a versioned, self-describing document", async () => {
		await seedEverything();
		const document = await buildMizanTrackFullBackup(USER_ID);

		expect(document.format).toBe(MIZAN_TRACK_FULL_BACKUP_FORMAT);
		expect(document.formatVersion).toBe(MIZAN_TRACK_FULL_BACKUP_FORMAT_VERSION);
		expect(document.dexieVersion).toBe(MIZAN_TRACK_DEXIE_VERSION);
		expect(document.userId).toBe(USER_ID);
		expect(Object.keys(document.tables).sort()).toEqual([...MIZAN_TRACK_FULL_BACKUP_TABLES].sort());
		expect(document.counts.transactions).toBe(3);
		expect(buildMizanTrackFullBackupFilename(new Date(Date.UTC(2026, 0, 9)))).toMatch(
			/^mizantrack-full-backup-2026-01-0[89]\.mizantrack\.json$/
		);
	});

	it("keeps excluded tables, secrets and local-only flags out of the file", async () => {
		await seedEverything();
		const text = await backupText();
		const document = JSON.parse(text) as Record<string, unknown>;
		const tables = document.tables as Record<string, unknown>;

		for (const excludedTable of MIZAN_TRACK_FULL_BACKUP_EXCLUDED_TABLES) {
			expect(tables[excludedTable]).toBeUndefined();
		}
		for (const secret of [
			"super-secret-key",
			"gold-api-secret",
			"webauthn-credential-secret",
			"0f".repeat(32),
		]) {
			expect(text).not.toContain(secret);
		}
		for (const field of MIZAN_TRACK_FULL_BACKUP_EXCLUDED_DB_CONFIG_FIELDS) {
			expect(text).not.toContain(`"${field}"`);
		}
		expect(text).not.toContain('"pendingSync"');
		expect(text).not.toContain('"syncedAt"');
		expect(text).not.toContain("v-local");
	});
});

describe("MizanTrack full backup — restore", () => {
	beforeEach(async () => {
		await wipeEverything();
		await seedEverything();
	});

	it("round-trips every record field for field through export, wipe and import", async () => {
		const before = await snapshotSyncTables();
		const text = await backupText();

		await wipeEverything();
		const restored = await restoreMizanTrackFullBackup(text, USER_ID);

		expect(restored.totalApplied).toBe(restored.totalIncoming);
		expect(await snapshotSyncTables()).toEqual(before);
		expect(restored.orphans).toEqual([]);
	});

	it("restores settings without the secrets that were never written", async () => {
		const text = await backupText();
		await wipeEverything();

		const restored = await restoreMizanTrackFullBackup(text, USER_ID);
		const config = await db.dbConfig.get(USER_ID);

		expect(restored.settingsRestored.sort()).toEqual([
			"currency",
			"enabledCurrencies",
			"fiscalYearStartMonth",
			"hideAmounts",
		]);
		expect(config?.currency).toBe("PKR");
		expect(config?.fiscalYearStartMonth).toBe(7);
		expect(config?.enabledCurrencies).toEqual(["PKR", "AED"]);
		expect(config?.hideAmounts).toBe(true);
		expect(config?.firebaseConfig).toBe("");
		expect(config?.pinHash).toBeUndefined();
		expect(config?.goldApiKey).toBeUndefined();
		expect(config?.biometricCredentialId).toBeUndefined();
		expect(config?.appLockEnabled).toBeUndefined();
		expect(config?.enabled).toBe(false);
	});

	it("leaves the device's own credentials untouched when restoring over them", async () => {
		const text = await backupText();
		await wipeEverything();
		await withoutSyncDirtyTracking(async () => {
			await db.dbConfig.put({
				id: USER_ID,
				firebaseConfig: '{"apiKey":"this-device"}',
				enabled: true,
				currency: "AED",
				fiscalYearStartMonth: 1,
				pinHash: "ab".repeat(32),
				appLockEnabled: true,
			});
		});

		await restoreMizanTrackFullBackup(text, USER_ID);
		const config = await db.dbConfig.get(USER_ID);

		expect(config?.firebaseConfig).toBe('{"apiKey":"this-device"}');
		expect(config?.pinHash).toBe("ab".repeat(32));
		expect(config?.appLockEnabled).toBe(true);
		expect(config?.currency).toBe("PKR");
		expect(config?.fiscalYearStartMonth).toBe(7);
	});

	it("marks restored records dirty so they reach Firebase", async () => {
		const text = await backupText();
		await wipeEverything();
		await restoreMizanTrackFullBackup(text, USER_ID);

		const transactions = (await db.transactions
			.where("userId")
			.equals(USER_ID)
			.toArray()) as (Transaction & SyncDirtyFields)[];
		expect(transactions).toHaveLength(3);
		expect(transactions.every((record) => record.pendingSync === true)).toBe(true);
	});

	it("changes nothing the second time the same file is imported", async () => {
		const text = await backupText();
		await wipeEverything();

		const first = await restoreMizanTrackFullBackup(text, USER_ID);
		const afterFirst = await snapshotSyncTables();
		const second = await restoreMizanTrackFullBackup(text, USER_ID);

		expect(first.totalApplied).toBeGreaterThan(0);
		expect(second.totalApplied).toBe(0);
		expect(second.totalIncoming).toBe(first.totalIncoming);
		expect(await snapshotSyncTables()).toEqual(afterFirst);
	});

	it("keeps a newer local record and applies a newer incoming one", async () => {
		const text = await backupText();

		await withoutSyncDirtyTracking(async () => {
			// Edited here after the backup was taken: the local copy must survive.
			await db.accounts.put(account("acc-1", { title: "Edited locally", updatedAt: BASE + 5_000 }));
			// Stale here: the backup's copy is newer and must win.
			await db.accounts.put(account("acc-2", { title: "Stale local", updatedAt: BASE - 5_000 }));
		});

		const restored = await restoreMizanTrackFullBackup(text, USER_ID);
		const accountsTable = restored.tables.find((entry) => entry.table === "accounts")!;

		expect((await db.accounts.get("acc-1"))?.title).toBe("Edited locally");
		expect((await db.accounts.get("acc-2"))?.title).toBe("Account acc-2");
		expect(accountsTable.skippedOlder).toBe(1);
		expect(accountsTable.applied).toBe(1);
		expect(accountsTable.unchanged).toBe(2);
	});

	it("keeps a soft-deleted record deleted instead of resurrecting it", async () => {
		const text = await backupText();
		await wipeEverything();
		await restoreMizanTrackFullBackup(text, USER_ID);

		expect((await db.accounts.get("acc-deleted"))?.deletedAt).toBe(BASE + 10);
		expect((await db.transactions.get("txn-deleted"))?.deletedAt).toBe(BASE + 10);
	});

	it("propagates a delete made after the backup without resurrecting the row", async () => {
		const staleText = await backupText();

		await withoutSyncDirtyTracking(async () => {
			await db.accounts.put(account("acc-2", { deletedAt: BASE + 9_000, updatedAt: BASE + 9_000 }));
		});

		await restoreMizanTrackFullBackup(staleText, USER_ID);
		expect((await db.accounts.get("acc-2"))?.deletedAt).toBe(BASE + 9_000);
	});

	it("does not undo a merge of duplicate accounts", async () => {
		// A backup taken before the owner merged acc-2 into acc-1.
		const preMergeText = await backupText();
		const mergedAt = BASE + 60_000;

		await withoutSyncDirtyTracking(async () => {
			// What mergeDuplicateAccounts leaves behind: the loser soft-deleted and emptied,
			// its transactions re-pointed at the survivor, every touched row re-stamped.
			await db.accounts.put(
				account("acc-2", { openingBalance: 0, deletedAt: mergedAt, updatedAt: mergedAt })
			);
			await db.accounts.put(account("acc-1", { openingBalance: 2_000, updatedAt: mergedAt }));
			await db.transactions.put(
				transaction("txn-2", {
					type: "Transfer",
					accountId: "acc-1",
					toAccountId: "acc-1",
					updatedAt: mergedAt,
				})
			);
		});

		await restoreMizanTrackFullBackup(preMergeText, USER_ID);

		const absorbed = await db.accounts.get("acc-2");
		const survivor = await db.accounts.get("acc-1");
		const moved = await db.transactions.get("txn-2");

		expect(absorbed?.deletedAt).toBe(mergedAt);
		expect(absorbed?.openingBalance).toBe(0);
		expect(survivor?.openingBalance).toBe(2_000);
		expect(moved?.toAccountId).toBe("acc-1");
	});

	it("does not recreate a category absorbed by a merge", async () => {
		const preMergeText = await backupText();
		const mergedAt = BASE + 60_000;

		await withoutSyncDirtyTracking(async () => {
			await db.categories.put(
				category("cat-2", { type: "Income", deletedAt: mergedAt, updatedAt: mergedAt })
			);
			await db.transactions.put(transaction("txn-1", { categoryId: "cat-1", updatedAt: mergedAt }));
		});

		await restoreMizanTrackFullBackup(preMergeText, USER_ID);

		expect((await db.categories.get("cat-2"))?.deletedAt).toBe(mergedAt);
		expect((await db.transactions.get("txn-1"))?.categoryId).toBe("cat-1");
	});

	it("imports into a database that already holds unrelated data", async () => {
		const text = await backupText();
		await wipeEverything();

		await withoutSyncDirtyTracking(async () => {
			await db.accounts.put(account("other-acc", { userId: OTHER_USER_ID }));
			await db.transactions.put(
				transaction("other-txn", { userId: OTHER_USER_ID, accountId: "other-acc" })
			);
			await db.reportProjects.put(reportProject("other-proj", { userId: OTHER_USER_ID }));
		});

		const restored = await restoreMizanTrackFullBackup(text, USER_ID);

		expect(restored.totalApplied).toBeGreaterThan(0);
		expect((await db.accounts.get("other-acc"))?.userId).toBe(OTHER_USER_ID);
		expect((await db.transactions.get("other-txn"))?.userId).toBe(OTHER_USER_ID);
		expect((await db.reportProjects.get("other-proj"))?.userId).toBe(OTHER_USER_ID);
		expect(await db.accounts.where("userId").equals(USER_ID).count()).toBe(4);
	});

	it("re-homes a backup written by a different account, rebuilding derived ids", async () => {
		const text = await backupText();
		await wipeEverything();

		const restored = await restoreMizanTrackFullBackup(text, OTHER_USER_ID);

		expect(restored.userIdRemapped).toBe(true);
		expect(restored.sourceUserId).toBe(USER_ID);
		expect(await db.transactions.where("userId").equals(OTHER_USER_ID).count()).toBe(3);
		expect(await db.zakatYears.get(`${OTHER_USER_ID}:1446`)).toMatchObject({
			userId: OTHER_USER_ID,
			islamicYear: 1446,
			pastRemainingOverride: 12_345,
		});
		expect(await db.zakatGoldYears.get(`${OTHER_USER_ID}:PKR:1446`)).toMatchObject({
			userId: OTHER_USER_ID,
			pricesByPurity: { "21k": 16_778.12, "22k": 17_500 },
		});
	});

	it("reports rows whose references are missing rather than discarding them", async () => {
		const document = await buildMizanTrackFullBackup(USER_ID);
		document.tables.accounts = document.tables.accounts.filter(
			(record) => record.id !== "acc-1" && record.id !== "acc-2"
		);
		await wipeEverything();

		const restored = await restoreMizanTrackFullBackup(
			serializeMizanTrackFullBackup(document),
			USER_ID
		);

		expect(await db.transactions.where("userId").equals(USER_ID).count()).toBe(3);
		expect(restored.orphans).toContainEqual({
			table: "transactions",
			field: "accountId",
			references: "accounts",
			count: 1,
		});
		expect(restored.orphans).toContainEqual({
			table: "transactions",
			field: "toAccountId",
			references: "accounts",
			count: 1,
		});
		expect(restored.orphans).toContainEqual({
			table: "reportAccountTags",
			field: "accountId",
			references: "accounts",
			count: 1,
		});
	});
});

describe("MizanTrack full backup — zakat and report fidelity", () => {
	beforeEach(async () => {
		await wipeEverything();
		await seedEverything();
	});

	it("restores per-year gold prices, Ramaḍān anchors and account selections", async () => {
		const text = await backupText();
		await wipeEverything();
		await restoreMizanTrackFullBackup(text, USER_ID);

		const goldYear = await db.zakatGoldYears.get(`${USER_ID}:PKR:1445`);
		expect(goldYear?.pricesByPurity).toEqual({ "21k": 16_778.12, "22k": 17_500 });
		expect(goldYear?.gramsByPurity).toEqual({ "21k": 170.52 });
		expect(goldYear?.priceDate).toBe(BASE);

		const year = await db.zakatYears.get(`${USER_ID}:1446`);
		expect(year?.ramadanStart).toBe(BASE);
		expect(year?.source).toBe("manual");
		expect(year?.pastRemainingOverride).toBe(12_345);
		expect(year?.pastRemainingSource).toBe("manual");
		expect(year?.selectedAccountIds).toEqual(["acc-1", "acc-2"]);
		expect(year?.showArchivedAccounts).toBe(true);

		const calculation = await db.zakatCalculations.get("zc-1");
		expect(calculation?.goldPricesByPurity).toEqual({ "21k": 18_846.3, "22k": 19_600 });
		expect(calculation?.accountBalances).toHaveLength(1);
		expect(calculation?.monthlyBalances?.[0]?.month).toBe("Ramaḍān 1446");

		const payment = await db.zakatPayments.get("zp-1");
		expect(payment?.calculationId).toBe("zc-1");
		expect(payment?.recipient).toBe("Local Masjid");

		const gold = await db.goldItems.get("gold-1");
		expect(gold?.weight).toBe(170.52);
		expect(gold?.notes).toBe("inherited");
	});

	it("restores report tag decisions, projects, manual entries and the salary grid", async () => {
		const text = await backupText();
		await wipeEverything();
		await restoreMizanTrackFullBackup(text, USER_ID);

		expect(await db.reportAccountTags.get("rat-1")).toMatchObject({
			accountId: "acc-1",
			includeInReport: true,
			isRemittanceSource: true,
		});
		expect(await db.reportProjects.get("proj-1")).toMatchObject({
			title: "BWC 7 Marla Overseas Block",
			sortOrder: 1,
		});
		expect(await db.reportTransactionTags.get("rtt-1")).toMatchObject({
			transactionId: "txn-1",
			role: "plot-payment",
			projectId: "proj-1",
			confirmed: true,
		});
		expect(await db.reportManualEntries.get("rme-1")).toMatchObject({
			label: "Nayatel tax",
			amount: 4_285,
			section: "other",
			fiscalYearKey: "2024-2025",
		});
		expect(await db.reportMonthlySalaryRows.get("rms-1")).toMatchObject({
			fiscalYearKey: "2024-2025",
			monthKey: "2024-07",
			company: "Acme",
			salaryPkr: 500_000,
			providentFundRefund: 10_000,
		});
	});

	it("writes report projects before the tags that reference them", async () => {
		const order = [...MIZAN_TRACK_FULL_BACKUP_TABLES] as MizanTrackFullBackupTable[];
		const indexOf = (table: MizanTrackFullBackupTable) => order.indexOf(table);

		expect(indexOf("accounts")).toBeLessThan(indexOf("transactions"));
		expect(indexOf("categories")).toBeLessThan(indexOf("transactions"));
		expect(indexOf("categories")).toBeLessThan(indexOf("budgets"));
		expect(indexOf("transactions")).toBeLessThan(indexOf("reportTransactionTags"));
		expect(indexOf("reportProjects")).toBeLessThan(indexOf("reportTransactionTags"));
		expect(indexOf("accounts")).toBeLessThan(indexOf("reportAccountTags"));
		expect(indexOf("zakatCalculations")).toBeLessThan(indexOf("zakatPayments"));
	});
});

describe("MizanTrack full backup — refusing bad files", () => {
	beforeEach(async () => {
		await wipeEverything();
	});

	it("refuses an unknown format version without applying anything", async () => {
		await seedEverything();
		const document = await buildMizanTrackFullBackup(USER_ID);
		await wipeEverything();

		const future = serializeMizanTrackFullBackup({ ...document, formatVersion: 99 });

		await expect(restoreMizanTrackFullBackup(future, USER_ID)).rejects.toThrow(
			/format v99[\s\S]*only understands up to v1[\s\S]*Nothing has been changed/
		);
		expect(await db.accounts.count()).toBe(0);
		expect(await db.transactions.count()).toBe(0);
		expect(await db.dbConfig.count()).toBe(0);
	});

	it("refuses a file that is not a MizanTrack backup", () => {
		expect(() => parseMizanTrackFullBackup("not json at all")).toThrow(/not valid JSON/);
		expect(() => parseMizanTrackFullBackup('{"format":"something-else"}')).toThrow(
			/not a MizanTrack full backup/
		);
		expect(() => parseMizanTrackFullBackup("[]")).toThrow(/not a MizanTrack backup/);
	});

	it("refuses a backup with no usable format version", () => {
		expect(() =>
			parseMizanTrackFullBackup(
				JSON.stringify({ format: MIZAN_TRACK_FULL_BACKUP_FORMAT, tables: {} })
			)
		).toThrow(/does not say which format it uses/);
	});

	it("refuses a damaged table without applying anything", async () => {
		await seedEverything();
		const document = await buildMizanTrackFullBackup(USER_ID);
		await wipeEverything();

		const damaged = JSON.stringify({
			...document,
			tables: { ...document.tables, transactions: [{ id: "txn-1" }] },
		});

		await expect(restoreMizanTrackFullBackup(damaged, USER_ID)).rejects.toThrow(
			/no usable last-changed time/
		);
		expect(await db.accounts.count()).toBe(0);
	});

	it("tolerates a backup that simply has no rows for a table", async () => {
		await seedEverything();
		const document = await buildMizanTrackFullBackup(USER_ID);
		await wipeEverything();

		const partial = JSON.parse(serializeMizanTrackFullBackup(document)) as Record<string, unknown>;
		delete (partial.tables as Record<string, unknown>).reportProjects;

		const restored = await restoreMizanTrackFullBackup(JSON.stringify(partial), USER_ID);
		expect(restored.tables.find((entry) => entry.table === "reportProjects")?.incoming).toBe(0);
		expect(await db.accounts.where("userId").equals(USER_ID).count()).toBe(4);
	});
});
