import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { db, withoutSyncDirtyTracking } from "@/lib/db/local";
import { MIZAN_TRACK_BACKUP_SHEETS, SECURITY_EXCLUDED_DB_CONFIG_FIELDS } from "@/lib/export";
import { backupGoogleSheetsCurrency } from "@/lib/sheets/backup";
import { SHEETS_CHUNK_MAX_BYTES, SHEETS_META_TAB } from "@/lib/sheets/constants";
import { getGoogleSheetsErrorCodeMessage, GoogleSheetsBackupError } from "@/lib/sheets/errors";
import { googleApiFetch } from "@/lib/sheets/googleApi";
import { getSheetsCurrencyState, putSheetsCurrencyState } from "@/lib/sheets/metadata";

import type {
	Account,
	Budget,
	Category,
	DashboardStats,
	DbConfig,
	GoldItem,
	GoogleSheetsErrorCode,
	SyncMeta,
	Transaction,
	ZakatCalculation,
	ZakatPayment,
} from "@/types";

vi.mock("@/lib/sheets/token", () => ({
	fetchGoogleSheetsAccessToken: vi.fn(async () => ({
		accessToken: "test-access-token",
		expiresAt: Date.now() + 3_600_000,
		scope: "openid email profile https://www.googleapis.com/auth/drive.file",
	})),
}));

const USER_ID = "google-sheets-user";
const UNDEFINED_SENTINEL = "__MIZANTRACK_UNDEFINED_V1__";

interface ValueWrite {
	spreadsheetId: string;
	sheetName: string;
	startRow: number;
	values: string[][];
}

interface MockFile {
	id: string;
	name: string;
	currency: string;
	userId: string;
	trashed?: boolean;
	webViewLink: string;
	modifiedTime: string;
}

interface GoogleFetchMock {
	files: Map<string, MockFile>;
	valueWrites: ValueWrite[];
	createCalls: string[];
	fetch: ReturnType<typeof vi.fn>;
}

type BackupEntity = (typeof MIZAN_TRACK_BACKUP_SHEETS)[number]["entity"];

function jsonResponse(data: unknown, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function parseSheetRange(url: URL) {
	const encodedRange = url.pathname.split("/values/")[1];
	if (!encodedRange) throw new Error(`Missing sheet range in ${url.toString()}`);
	const decoded = decodeURIComponent(encodedRange);
	const match = decoded.match(/^'((?:''|[^'])+)'!A(\d+)/);
	if (!match) throw new Error(`Unexpected sheet range: ${decoded}`);
	const [, rawSheetName, rawStartRow] = match;
	if (!rawSheetName || !rawStartRow) throw new Error(`Incomplete sheet range: ${decoded}`);
	return {
		sheetName: rawSheetName.replaceAll("''", "'"),
		startRow: Number(rawStartRow),
	};
}

function createGoogleFetchMock(options: { partialSheetName?: string } = {}): GoogleFetchMock {
	const files = new Map<string, MockFile>();
	const sheetTitles = new Map<string, Set<string>>();
	const valueWrites: ValueWrite[] = [];
	const createCalls: string[] = [];

	const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		const method = init?.method ?? "GET";
		const body = init?.body ? JSON.parse(String(init.body)) : undefined;

		if (url.hostname === "www.googleapis.com" && url.pathname === "/drive/v3/files") {
			const query = url.searchParams.get("q") ?? "";
			const currency = query.match(/key='mizantrackCurrency' and value='([^']+)'/)?.[1];
			const userId = query.match(/key='mizantrackUserId' and value='([^']+)'/)?.[1];
			return jsonResponse({
				files: [...files.values()].filter(
					(file) => !file.trashed && file.currency === currency && file.userId === userId
				),
			});
		}

		if (url.hostname === "www.googleapis.com" && url.pathname.startsWith("/drive/v3/files/")) {
			const spreadsheetId = decodeURIComponent(url.pathname.split("/").at(-1)!);
			const file = files.get(spreadsheetId);
			if (method === "PATCH") {
				const currency = body.appProperties.mizantrackCurrency as string;
				const userId = body.appProperties.mizantrackUserId as string;
				files.set(spreadsheetId, {
					id: spreadsheetId,
					name: `MizanTrack Backup - ${currency}`,
					currency,
					userId,
					webViewLink: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
					modifiedTime: new Date().toISOString(),
				});
				return jsonResponse({ id: spreadsheetId });
			}
			if (!file) {
				return jsonResponse(
					{ error: { code: 404, message: "File not found", status: "NOT_FOUND" } },
					404
				);
			}
			return jsonResponse(file);
		}

		if (
			url.hostname === "sheets.googleapis.com" &&
			url.pathname === "/v4/spreadsheets" &&
			method === "POST"
		) {
			const title = body.properties.title as string;
			const currency = title.split(" - ").at(-1)!;
			const spreadsheetId = `${currency.toLowerCase()}-sheet`;
			createCalls.push(spreadsheetId);
			sheetTitles.set(spreadsheetId, new Set([SHEETS_META_TAB]));
			return jsonResponse({
				spreadsheetId,
				spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
			});
		}

		if (
			url.hostname === "sheets.googleapis.com" &&
			url.pathname.endsWith(":batchUpdate") &&
			method === "POST"
		) {
			const spreadsheetPathPart = url.pathname.split("/").at(-1)?.split(":")[0];
			if (!spreadsheetPathPart) throw new Error(`Missing spreadsheet id in ${url.toString()}`);
			const spreadsheetId = decodeURIComponent(spreadsheetPathPart);
			const titles = sheetTitles.get(spreadsheetId) ?? new Set<string>();
			for (const request of body.requests as Array<{
				addSheet?: { properties: { title: string } };
			}>) {
				if (request.addSheet) titles.add(request.addSheet.properties.title);
			}
			sheetTitles.set(spreadsheetId, titles);
			return jsonResponse({});
		}

		if (
			url.hostname === "sheets.googleapis.com" &&
			url.pathname.startsWith("/v4/spreadsheets/") &&
			url.pathname.includes("/values/") &&
			method === "PUT"
		) {
			const spreadsheetPathPart = url.pathname.split("/")[3];
			if (!spreadsheetPathPart) throw new Error(`Missing spreadsheet id in ${url.toString()}`);
			const spreadsheetId = decodeURIComponent(spreadsheetPathPart);
			const { sheetName, startRow } = parseSheetRange(url);
			const values = body.values as string[][];
			valueWrites.push({ spreadsheetId, sheetName, startRow, values });
			return jsonResponse({
				updatedRows:
					options.partialSheetName === sheetName ? Math.max(values.length - 1, 0) : values.length,
			});
		}

		if (
			url.hostname === "sheets.googleapis.com" &&
			url.pathname.startsWith("/v4/spreadsheets/") &&
			url.pathname.includes("/values/") &&
			method === "POST"
		) {
			return jsonResponse({});
		}

		if (
			url.hostname === "sheets.googleapis.com" &&
			url.pathname.startsWith("/v4/spreadsheets/") &&
			method === "GET"
		) {
			const spreadsheetId = decodeURIComponent(url.pathname.split("/").at(-1)!);
			const titles = sheetTitles.get(spreadsheetId) ?? new Set([SHEETS_META_TAB]);
			return jsonResponse({
				spreadsheetId,
				spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
				sheets: [...titles].map((title, index) => ({
					properties: { sheetId: index + 1, title },
				})),
			});
		}

		throw new Error(`Unhandled Google API mock request: ${method} ${url.toString()}`);
	});

	vi.stubGlobal("fetch", fetchMock);
	return { files, valueWrites, createCalls, fetch: fetchMock };
}

function decodeCell(value: string): unknown {
	if (value === UNDEFINED_SENTINEL) return undefined;
	return JSON.parse(value);
}

function decodeRecords(write: ValueWrite, columns: readonly string[]): Record<string, unknown>[] {
	const [, ...rows] = write.values;
	return rows.map((row) => {
		const record: Record<string, unknown> = {};
		columns.forEach((column, index) => {
			const value = decodeCell(row[index] ?? UNDEFINED_SENTINEL);
			if (value !== undefined) record[column] = value;
		});
		return record;
	});
}

function pickColumns(record: object, columns: readonly string[]) {
	const picked: Record<string, unknown> = {};
	for (const column of columns) {
		const value = (record as Record<string, unknown>)[column];
		if (value !== undefined) picked[column] = value;
	}
	return picked;
}

function definitionFor(entity: BackupEntity) {
	const definition = MIZAN_TRACK_BACKUP_SHEETS.find((sheet) => sheet.entity === entity);
	if (!definition) throw new Error(`Missing definition for ${entity}.`);
	return definition;
}

async function seedFullBackupFixture() {
	const account: Account = {
		id: "acc-pkr",
		userId: USER_ID,
		title: "Cash PKR",
		openingBalance: 1000,
		currency: "PKR",
		color: "#123456",
		icon: "wallet",
		isArchived: false,
		accountType: "asset",
		sourceId: "source-account",
		updatedAt: 10,
		deletedAt: 20,
	};
	const category: Category = {
		id: "cat-pkr",
		userId: USER_ID,
		title: "Food",
		type: "Expense",
		currency: "PKR",
		icon: "utensils",
		color: "#abcdef",
		parentId: "parent-cat",
		sourceId: "source-category",
		updatedAt: 11,
		deletedAt: 21,
	};
	const transaction: Transaction = {
		id: "txn-pkr",
		userId: USER_ID,
		type: "Expense",
		date: 1_000,
		amount: 25,
		description: "Dinner",
		categoryId: category.id,
		accountId: account.id,
		toAccountId: account.id,
		tags: ["family", "food"],
		place: "Karachi",
		travelCurrency: { symbol: "$", rate: 280, amount: 1, location: "Online" },
		sourceId: "source-transaction",
		updatedAt: 12,
		deletedAt: 22,
	};
	const budget: Budget = {
		id: "budget-pkr",
		userId: USER_ID,
		categoryId: category.id,
		period: "2026-10",
		amount: 500,
		currency: "PKR",
		active: true,
		sourceId: "source-budget",
		updatedAt: 13,
		deletedAt: 23,
	};
	const goldItem: GoldItem = {
		id: "gold-pkr",
		userId: USER_ID,
		currency: "PKR",
		title: "Ring",
		weight: 5,
		purity: "24k",
		purchaseDate: 2_000,
		purchasePrice: 300_000,
		notes: "Gift",
		updatedAt: 14,
		deletedAt: 24,
	};
	const zakatCalculation: ZakatCalculation = {
		id: "calc-pkr",
		userId: USER_ID,
		currency: "PKR",
		islamicYear: "1447",
		assessmentDate: 3_000,
		nisabStandard: "gold",
		goldPricePerGram: 18_000,
		silverPricePerGram: 220,
		referenceCurrency: "PKR",
		totalGoldWeightGrams: 5,
		totalGoldValue: 90_000,
		accountBalances: [
			{
				accountId: account.id,
				accountTitle: account.title,
				balance: 1000,
				currency: "PKR",
				exchangeRate: 1,
				zakatable: true,
				accountType: "asset",
			},
		],
		totalZakatable: 91_000,
		nisabThreshold: 1_530_000,
		zakatObligation: 0,
		isLiable: false,
		monthlyBalances: [
			{
				month: "Ramaḍān 1447",
				gregorianDate: "2026-02-18",
				totalWealth: 91_000,
			},
		],
		createdAt: 15,
		updatedAt: 16,
		deletedAt: 26,
	};
	const zakatPayment: ZakatPayment = {
		id: "payment-pkr",
		userId: USER_ID,
		calculationId: zakatCalculation.id,
		islamicYear: "1447",
		date: 4_000,
		amount: 100,
		currency: "PKR",
		recipient: "Charity",
		notes: "Cash",
		createdAt: 17,
		updatedAt: 18,
		deletedAt: 28,
	};
	const dbConfig: DbConfig = {
		id: USER_ID,
		firebaseConfig: "secret-firebase-config",
		enabled: true,
		currency: "PKR",
		fiscalYearStartMonth: 7,
		goldApiKey: "secret-gold-api-key",
		lastGoldPricePerGram: 18_000,
		lastGoldPriceFetchedAt: 19,
		pinHash: "secret-pin-hash",
		appLockEnabled: true,
		biometricEnabled: true,
		biometricCredentialId: "secret-biometric-id",
		enabledCurrencies: ["PKR", "AED"],
	};
	const syncMeta: SyncMeta = { id: "lastSync:transactions", timestamp: 20 };
	const dashboardStats: DashboardStats = {
		id: USER_ID,
		updatedAt: 21,
		logicVersion: 1,
		dataVersion: "v1",
		cacheStatus: "valid",
		cacheUpdatedAt: 22,
		analyticsCache: {
			accounts: {
				[account.id]: {
					logicVersion: 1,
					dataVersion: "v1",
					key: account.id,
					updatedAt: 23,
					value: { balance: 1000 },
				},
			},
		},
		balances: { PKR: 1000 },
		perCurrency: {
			PKR: {
				monthIncome: 0,
				monthExpense: 25,
				trend: [{ month: "2026-10", income: 0, expense: 25 }],
			},
		},
		recent: [
			{
				id: transaction.id,
				type: "Expense",
				date: transaction.date,
				amount: transaction.amount,
				description: transaction.description,
				place: transaction.place,
				accountId: account.id,
				accountTitle: account.title,
				accountCurrency: "PKR",
			},
		],
		warnings: [
			{
				code: "invalid_transfer_counterparty_skipped",
				transactionId: transaction.id,
				message: "Synthetic warning",
			},
		],
	};

	await withoutSyncDirtyTracking(async () => {
		await db.accounts.put(account);
		await db.categories.put(category);
		await db.transactions.put(transaction);
		await db.budgets.put(budget);
		await db.goldItems.put(goldItem);
		await db.zakatCalculations.put(zakatCalculation);
		await db.zakatPayments.put(zakatPayment);
		await db.dbConfig.put(dbConfig);
		await db.syncMeta.put(syncMeta);
		await db.dashboardStats.put(dashboardStats);
	});

	return {
		Account: [account],
		Category: [category],
		Transaction: [transaction],
		Budget: [budget],
		GoldItem: [goldItem],
		ZakatCalculation: [zakatCalculation],
		ZakatPayment: [zakatPayment],
		DbConfig: [dbConfig],
		SyncMeta: [syncMeta],
		DashboardStats: [dashboardStats],
	} satisfies Record<BackupEntity, object[]>;
}

beforeEach(async () => {
	vi.restoreAllMocks();
	Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
	await db.delete();
	await db.open();
});

describe("Google Sheets backup", () => {
	it("creates one spreadsheet per currency once and reuses it on the next backup", async () => {
		const google = createGoogleFetchMock();
		await seedFullBackupFixture();

		await backupGoogleSheetsCurrency(USER_ID, "PKR");
		await backupGoogleSheetsCurrency(USER_ID, "PKR");

		expect(google.createCalls).toEqual(["pkr-sheet"]);
		const state = await getSheetsCurrencyState("PKR");
		expect(state?.spreadsheetId).toBe("pkr-sheet");
		expect(state?.lastStatus).toBe("success");
	});

	it("writes every entity and field from the export schema to the sheet", async () => {
		const google = createGoogleFetchMock();
		const recordsByEntity = await seedFullBackupFixture();

		await backupGoogleSheetsCurrency(USER_ID, "PKR");

		for (const definition of MIZAN_TRACK_BACKUP_SHEETS) {
			const write = google.valueWrites.find(
				(candidate) =>
					candidate.spreadsheetId === "pkr-sheet" &&
					candidate.sheetName === definition.sheetName &&
					candidate.startRow === 1
			);
			expect(write, `Missing write for ${definition.sheetName}`).toBeDefined();
			expect(write!.values[0]).toEqual([...definition.columns]);
			expect(decodeRecords(write!, definition.columns)).toEqual(
				recordsByEntity[definition.entity].map((record) => pickColumns(record, definition.columns))
			);
		}
	});

	it("never writes local secrets to any Google payload", async () => {
		const google = createGoogleFetchMock();
		await seedFullBackupFixture();

		await backupGoogleSheetsCurrency(USER_ID, "PKR");

		const payloadText = google.fetch.mock.calls
			.map(([, init]) => String(init?.body ?? ""))
			.join("\n");
		for (const field of SECURITY_EXCLUDED_DB_CONFIG_FIELDS) {
			expect(payloadText).not.toContain(field);
		}
		expect(payloadText).not.toContain("secret-firebase-config");
		expect(payloadText).not.toContain("secret-gold-api-key");
		expect(payloadText).not.toContain("secret-pin-hash");
		expect(payloadText).not.toContain("secret-biometric-id");
	});

	it("reports a partial Google write as a failed backup, not success", async () => {
		createGoogleFetchMock({ partialSheetName: definitionFor("Transaction").sheetName });
		await seedFullBackupFixture();

		await expect(backupGoogleSheetsCurrency(USER_ID, "PKR")).rejects.toMatchObject({
			code: "PartialWrite",
		});
		const state = await getSheetsCurrencyState("PKR");
		expect(state?.lastStatus).toBe("failed");
		expect(state?.lastError).toContain("Google wrote");
		expect(state?.lastBackupCompletedAt).toBeUndefined();
	});

	it("chunks a 7,673-transaction PKR backup instead of sending one huge request", async () => {
		const google = createGoogleFetchMock();
		await withoutSyncDirtyTracking(async () => {
			await db.accounts.put({
				id: "acc-pkr",
				userId: USER_ID,
				title: "Cash PKR",
				openingBalance: 0,
				currency: "PKR",
				isArchived: false,
				updatedAt: 1,
			});
			await db.transactions.bulkPut(
				Array.from({ length: 7_673 }, (_, index) => ({
					id: `txn-${index}`,
					userId: USER_ID,
					type: "Expense" as const,
					date: index,
					amount: index + 1,
					description: `Large PKR transaction ${index} ${"x".repeat(240)}`,
					accountId: "acc-pkr",
					tags: ["bulk", "pkr", `row-${index}`],
					updatedAt: index,
				}))
			);
		});

		await backupGoogleSheetsCurrency(USER_ID, "PKR");

		const transactionWrites = google.valueWrites.filter(
			(write) => write.sheetName === definitionFor("Transaction").sheetName
		);
		expect(transactionWrites.length).toBeGreaterThan(1);
		expect(transactionWrites.reduce((sum, write) => sum + write.values.length, 0)).toBe(7_674);
		for (const write of transactionWrites) {
			expect(JSON.stringify({ values: write.values }).length).toBeLessThanOrEqual(
				SHEETS_CHUNK_MAX_BYTES
			);
		}
	}, 20_000);

	it("keeps currencies isolated so a PKR backup never writes into the AED spreadsheet", async () => {
		const google = createGoogleFetchMock();
		google.files.set("pkr-existing-sheet", {
			id: "pkr-existing-sheet",
			name: "MizanTrack Backup - PKR",
			currency: "PKR",
			userId: USER_ID,
			webViewLink: "https://docs.google.com/spreadsheets/d/pkr-existing-sheet",
			modifiedTime: new Date().toISOString(),
		});
		google.files.set("aed-existing-sheet", {
			id: "aed-existing-sheet",
			name: "MizanTrack Backup - AED",
			currency: "AED",
			userId: USER_ID,
			webViewLink: "https://docs.google.com/spreadsheets/d/aed-existing-sheet",
			modifiedTime: new Date().toISOString(),
		});
		await putSheetsCurrencyState("PKR", { spreadsheetId: "pkr-existing-sheet" });
		await putSheetsCurrencyState("AED", { spreadsheetId: "aed-existing-sheet" });
		await withoutSyncDirtyTracking(async () => {
			await db.accounts.bulkPut([
				{
					id: "acc-pkr",
					userId: USER_ID,
					title: "Cash PKR",
					openingBalance: 0,
					currency: "PKR",
					isArchived: false,
					updatedAt: 1,
				},
				{
					id: "acc-aed",
					userId: USER_ID,
					title: "Cash AED",
					openingBalance: 0,
					currency: "AED",
					isArchived: false,
					updatedAt: 1,
				},
			]);
			await db.transactions.bulkPut([
				{
					id: "txn-pkr",
					userId: USER_ID,
					type: "Expense",
					date: 1,
					amount: 10,
					accountId: "acc-pkr",
					updatedAt: 1,
				},
				{
					id: "txn-aed",
					userId: USER_ID,
					type: "Expense",
					date: 2,
					amount: 20,
					accountId: "acc-aed",
					updatedAt: 2,
				},
			]);
		});

		await backupGoogleSheetsCurrency(USER_ID, "PKR");

		expect(google.valueWrites.every((write) => write.spreadsheetId !== "aed-existing-sheet")).toBe(
			true
		);
		const transactionWrite = google.valueWrites.find(
			(write) => write.sheetName === definitionFor("Transaction").sheetName
		);
		expect(decodeRecords(transactionWrite!, definitionFor("Transaction").columns)).toEqual([
			expect.objectContaining({ id: "txn-pkr", accountId: "acc-pkr" }),
		]);
	});
});

describe("Google Sheets user-facing errors", () => {
	const ERROR_EXPECTATIONS = {
		Offline: "Connect to the internet",
		Unauthorized: "Sign in",
		NotConnected: "Connect Google Sheets",
		RequiresReconnect: "In production",
		SheetMissing: "moved or deleted",
		SheetForeign: "did not create",
		ConcurrentBackup: "already running",
		QuotaExceeded: "Wait a few minutes",
		PayloadTooLarge: "One row is too large",
		PartialWrite: "No success was recorded",
		GoogleServerError: "temporarily unavailable",
		GoogleApiError: "enable",
		SheetTooLarge: "size limit",
	} as const satisfies Record<GoogleSheetsErrorCode, string>;

	it("maps every GoogleSheetsErrorCode to an actionable message", () => {
		for (const [code, expectedText] of Object.entries(ERROR_EXPECTATIONS) as Array<
			[GoogleSheetsErrorCode, string]
		>) {
			expect(getGoogleSheetsErrorCodeMessage(code)).toContain(expectedText);
			expect(new GoogleSheetsBackupError(code).message).toContain(expectedText);
		}
	});

	it("distinguishes missing scope from disabled Google APIs", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(
					jsonResponse(
						{
							error: {
								code: 403,
								status: "PERMISSION_DENIED",
								message: "Request had insufficient authentication scopes.",
							},
						},
						403
					)
				)
				.mockResolvedValueOnce(
					jsonResponse(
						{
							error: {
								code: 403,
								status: "PERMISSION_DENIED",
								message:
									"Google Sheets API has not been used in project 123 before or is disabled.",
								details: [{ reason: "SERVICE_DISABLED" }],
							},
						},
						403
					)
				)
		);

		await expect(
			googleApiFetch("token", "https://sheets.googleapis.com/v4/spreadsheets")
		).rejects.toMatchObject({
			code: "NotConnected",
			message: expect.stringContaining("permission was not granted"),
		});
		await expect(
			googleApiFetch("token", "https://sheets.googleapis.com/v4/spreadsheets")
		).rejects.toMatchObject({
			code: "GoogleApiError",
			message: expect.stringContaining("API is not enabled"),
		});
	});
});
