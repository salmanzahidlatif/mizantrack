import fs from "fs";
import path from "path";

import "fake-indexeddb/auto";
import initSqlJs from "sql.js";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "@/lib/db/local";
import {
	HYSAB_KYTAB_RECLASSIFY_RESOLUTION,
	commitHysabKytabSqliteImport,
	prepareHysabKytabSqliteImport,
} from "@/lib/import/hysabKytabSqlite";

const USER_ID = "aed-repro-user";
const CURRENCY = "AED";
const BACKUP_PATH = path.join(process.cwd(), "docs", "HK Backup - AED.db");

function readBackupFile(): File {
	const buffer = fs.readFileSync(BACKUP_PATH);
	return new File([new Uint8Array(buffer)], "HK Backup - AED.db");
}

function round(value: number): number {
	return Math.round(value * 100) / 100;
}

describe("AED import balance repro", () => {
	beforeEach(async () => {
		await db.delete();
		await db.open();
	});

	it("matches per-account balances against the source db", async () => {
		const SQL = await initSqlJs({
			locateFile: () => path.join(process.cwd(), "node_modules/sql.js/dist/sql-wasm.wasm"),
		});
		const raw = new SQL.Database(new Uint8Array(fs.readFileSync(BACKUP_PATH)));
		const expectedBySourceAccount = new Map<string, { title: string; balance: number }>();
		const res = raw.exec(
			`SELECT a.ID id, a.TITLE title, COALESCE(a.OPENINGBALANCE,0) ob,
			        COALESCE((SELECT SUM(v.VCHAMOUNT) FROM HKBVOUCHER v WHERE v.ACTIVE=1 AND v.ACCOUNTID=a.ID),0) txn
			 FROM HKBACCOUNT a`
		);
		for (const row of res[0].values) {
			const [id, title, ob, txn] = row as [number, string, number, number];
			expectedBySourceAccount.set(String(id), {
				title: String(title ?? ""),
				balance: round(Number(ob) + Number(txn)),
			});
		}
		raw.close();

		const plan = await prepareHysabKytabSqliteImport(readBackupFile(), USER_ID, CURRENCY);
		const accountsByTitle = new Map(
			plan.accountChoices.map((a) => [a.title.trim().toLowerCase(), a])
		);
		const eib = accountsByTitle.get("eib");
		const misc = accountsByTitle.get("misc");
		expect(eib, "EIB account draft").toBeTruthy();
		expect(misc, "misc account draft").toBeTruthy();

		console.log(
			"UNRESOLVED:",
			plan.unresolvedTransfers.map((u) => ({
				voucherId: u.voucherId,
				account: u.accountTitle,
				amount: u.amount,
				desc: u.description,
			}))
		);

		const byVoucherId: Record<string, string> = {
			"1705154034": eib!.id,
			"1782530911": HYSAB_KYTAB_RECLASSIFY_RESOLUTION,
			"1783428203": misc!.id,
		};

		const result = await commitHysabKytabSqliteImport(plan, { byVoucherId });
		console.log("RESULT:", {
			accounts: result.accounts,
			categories: result.categories,
			transactions: result.transactions,
			transfersPaired: result.transfersPaired,
			autoCreated: result.autoCreated,
			autoCreatedAccounts: result.autoCreatedAccounts,
			passed: result.verification.passed,
		});
		console.log("VERIFICATION:", JSON.stringify(result.verification, null, 2).slice(0, 3000));

		const accounts = await db.accounts.where("userId").equals(USER_ID).toArray();
		const transactions = await db.transactions.where("userId").equals(USER_ID).toArray();

		const actual = new Map<string, number>();
		for (const a of accounts) actual.set(a.id, a.openingBalance ?? 0);
		for (const t of transactions) {
			if (t.type === "Expense") {
				actual.set(t.accountId, (actual.get(t.accountId) ?? 0) - t.amount);
			} else if (t.type === "Income") {
				actual.set(t.accountId, (actual.get(t.accountId) ?? 0) + t.amount);
			} else if (t.type === "Transfer") {
				actual.set(t.accountId, (actual.get(t.accountId) ?? 0) - t.amount);
				if (t.toAccountId)
					actual.set(t.toAccountId, (actual.get(t.toAccountId) ?? 0) + t.amount);
			}
		}

		const rows: string[] = [];
		let mismatches = 0;
		for (const a of accounts) {
			const srcId = a.sourceId?.split(":").pop() ?? "";
			const exp = expectedBySourceAccount.get(srcId);
			const got = round(actual.get(a.id) ?? 0);
			const want = exp ? exp.balance : 0;
			const diff = round(got - want);
			if (Math.abs(diff) > 0.005) {
				mismatches += 1;
				rows.push(
					`${a.title.padEnd(24)} expected ${want.toFixed(2).padStart(14)}  got ${got
						.toFixed(2)
						.padStart(14)}  diff ${diff.toFixed(2).padStart(14)}`
				);
			}
		}
		console.log("MISMATCHES:", mismatches);
		for (const r of rows) console.log("  " + r);
		expect(mismatches).toBe(0);
	}, 120000);
});
