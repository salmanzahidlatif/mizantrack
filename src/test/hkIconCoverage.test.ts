import fs from "fs";
import path from "path";

import initSqlJs from "sql.js";
import { describe, expect, it } from "vitest";

import { DEFAULT_ACCOUNT_ICON, getAccountIcon } from "@/lib/accountIcons";
import { DEFAULT_CATEGORY_ICON, getCategoryIcon } from "@/lib/categoryIcons";

import type { Database, SqlValue } from "sql.js";

const BACKUPS = [
	{ currency: "AED", path: path.join(process.cwd(), "docs", "HK Backup - AED.db") },
	{ currency: "PKR", path: path.join(process.cwd(), "docs", "HK Backup - PKR.db") },
];

type Row = Record<string, SqlValue>;

function normalizeImportedTitle(name: string): string {
	return name
		.replace(/\s*\(closed\)\s*$/i, "")
		.replace(/~\d+~\d+$/g, "")
		.replace(/~/g, "-")
		.trim();
}

function text(value: SqlValue | undefined): string {
	return String(value ?? "").trim();
}

function queryRows(database: Database, sql: string): Row[] {
	const result = database.exec(sql)[0];
	if (!result) return [];
	return result.values.map((values) =>
		Object.fromEntries(result.columns.map((column, index) => [column, values[index] ?? null]))
	);
}

const describeWithBackups = BACKUPS.every((backup) => fs.existsSync(backup.path))
	? describe
	: describe.skip;

describeWithBackups("HK real-backup icon coverage", () => {
	it("resolves every imported account and category title to a non-default icon", async () => {
		const SQL = await initSqlJs({
			locateFile: (file) => `${process.cwd()}/node_modules/sql.js/dist/${file}`,
		});
		const failures: string[] = [];

		for (const backup of BACKUPS) {
			const database = new SQL.Database(new Uint8Array(fs.readFileSync(backup.path)));
			try {
				for (const row of queryRows(database, "SELECT TITLE FROM HKBACCOUNT ORDER BY ID")) {
					const title = normalizeImportedTitle(text(row.TITLE));
					const icon = getAccountIcon({ title, currency: backup.currency });
					if (icon === DEFAULT_ACCOUNT_ICON) {
						failures.push(`${backup.currency} account "${title}" fell back to ${icon}`);
					}
				}

				for (const row of queryRows(database, "SELECT TITILE FROM HKBCATEGORY ORDER BY ID")) {
					const title = normalizeImportedTitle(text(row.TITILE));
					const icon = getCategoryIcon({ title });
					if (icon === DEFAULT_CATEGORY_ICON) {
						failures.push(`${backup.currency} category "${title}" fell back to ${icon}`);
					}
				}
			} finally {
				database.close();
			}
		}

		if (failures.length > 0) {
			console.error(failures.join("\n"));
		}
		expect(failures).toEqual([]);
	}, 30000);
});
