import { v4 as uuidv4 } from "uuid";

import { db } from "@/lib/db/local";

import type {
	ReportManualEntry,
	ReportMonthlySalaryRow,
	ReportProject,
	ReportTransactionRole,
} from "@/types";

/**
 * CRUD helpers for the five report input tables. Only user INPUTS live here —
 * computed report figures are never written back to Dexie.
 */

export interface SetTransactionTagValues {
	transactionId: string;
	role: ReportTransactionRole;
	projectId?: string;
	confirmed?: boolean;
}

export type ReportProjectValues = Pick<ReportProject, "title"> &
	Partial<Pick<ReportProject, "note" | "sortOrder">>;

export type ReportManualEntryValues = Pick<
	ReportManualEntry,
	"label" | "amount" | "currency" | "section"
> &
	Partial<Pick<ReportManualEntry, "date" | "note" | "fiscalYearKey">>;

export type ReportMonthlySalaryValues = Partial<
	Pick<
		ReportMonthlySalaryRow,
		"company" | "salaryPkr" | "salaryUsd" | "taxablePkr" | "providentFundRefund"
	>
>;

function normalizeOptionalText(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	return trimmed;
}

async function findAccountTag(userId: string, accountId: string) {
	const tags = await db.reportAccountTags
		.where("[userId+accountId]")
		.equals([userId, accountId])
		.toArray();
	return tags.find((tag) => !tag.deletedAt) ?? tags[0];
}

async function findTransactionTag(userId: string, transactionId: string) {
	const tags = await db.reportTransactionTags
		.where("[userId+transactionId]")
		.equals([userId, transactionId])
		.toArray();
	return tags.find((tag) => !tag.deletedAt) ?? tags[0];
}

/** Opts one account in or out of the report. */
export async function setAccountIncluded(
	userId: string,
	accountId: string,
	includeInReport: boolean
): Promise<string> {
	const existing = await findAccountTag(userId, accountId);
	const updatedAt = Date.now();

	if (existing) {
		await db.reportAccountTags.update(existing.id, {
			includeInReport,
			deletedAt: undefined,
			updatedAt,
		});
		return existing.id;
	}

	const id = uuidv4();
	await db.reportAccountTags.put({ id, userId, accountId, includeInReport, updatedAt });
	return id;
}

/** Records the user's decision for one transaction. Confirmed by default. */
export async function setTransactionTag(
	userId: string,
	values: SetTransactionTagValues
): Promise<string> {
	const existing = await findTransactionTag(userId, values.transactionId);
	const updatedAt = Date.now();
	const projectId = values.role === "plot-payment" ? values.projectId : undefined;
	const confirmed = values.confirmed ?? true;

	if (existing) {
		await db.reportTransactionTags.update(existing.id, {
			role: values.role,
			projectId,
			confirmed,
			deletedAt: undefined,
			updatedAt,
		});
		return existing.id;
	}

	const id = uuidv4();
	await db.reportTransactionTags.put({
		id,
		userId,
		transactionId: values.transactionId,
		role: values.role,
		projectId,
		confirmed,
		updatedAt,
	});
	return id;
}

/** Removes the user's decision so the transaction falls back to auto-detection. */
export async function clearTransactionTag(userId: string, transactionId: string): Promise<void> {
	const existing = await findTransactionTag(userId, transactionId);
	if (!existing || existing.deletedAt) return;

	await db.reportTransactionTags.update(existing.id, {
		deletedAt: Date.now(),
		updatedAt: Date.now(),
	});
}

export async function createProject(
	userId: string,
	values: ReportProjectValues
): Promise<ReportProject> {
	const project: ReportProject = {
		id: uuidv4(),
		userId,
		title: values.title.trim(),
		note: normalizeOptionalText(values.note),
		sortOrder: values.sortOrder,
		updatedAt: Date.now(),
	};
	await db.reportProjects.put(project);
	return project;
}

export async function updateProject(
	projectId: string,
	values: Partial<ReportProjectValues>
): Promise<void> {
	const updates: Partial<ReportProject> = { updatedAt: Date.now() };
	if (values.title !== undefined) updates.title = values.title.trim();
	if (values.note !== undefined) updates.note = normalizeOptionalText(values.note);
	if (values.sortOrder !== undefined) updates.sortOrder = values.sortOrder;

	const updated = await db.reportProjects.update(projectId, updates);
	if (updated === 0) {
		throw new Error("Project was not found. Please reload and try again.");
	}
}

/** Soft-deletes a project and releases its payments back to "Unassigned payments". */
export async function deleteProject(userId: string, projectId: string): Promise<void> {
	const now = Date.now();
	const updated = await db.reportProjects.update(projectId, { deletedAt: now, updatedAt: now });
	if (updated === 0) {
		throw new Error("Project was not found. Please reload and try again.");
	}

	const assigned = await db.reportTransactionTags
		.where("projectId")
		.equals(projectId)
		.filter((tag) => tag.userId === userId && !tag.deletedAt)
		.toArray();

	await Promise.all(
		assigned.map((tag) =>
			db.reportTransactionTags.update(tag.id, { projectId: undefined, updatedAt: now })
		)
	);
}

export async function createManualEntry(
	userId: string,
	values: ReportManualEntryValues
): Promise<ReportManualEntry> {
	const entry: ReportManualEntry = {
		id: uuidv4(),
		userId,
		label: values.label.trim(),
		amount: values.amount,
		currency: values.currency,
		section: values.section,
		date: values.date,
		note: normalizeOptionalText(values.note),
		fiscalYearKey: values.fiscalYearKey,
		updatedAt: Date.now(),
	};
	await db.reportManualEntries.put(entry);
	return entry;
}

export async function updateManualEntry(
	entryId: string,
	values: Partial<ReportManualEntryValues>
): Promise<void> {
	const updates: Partial<ReportManualEntry> = { updatedAt: Date.now() };
	if (values.label !== undefined) updates.label = values.label.trim();
	if (values.amount !== undefined) updates.amount = values.amount;
	if (values.currency !== undefined) updates.currency = values.currency;
	if (values.section !== undefined) updates.section = values.section;
	if (values.date !== undefined) updates.date = values.date;
	if (values.note !== undefined) updates.note = normalizeOptionalText(values.note);
	if (values.fiscalYearKey !== undefined) updates.fiscalYearKey = values.fiscalYearKey;

	const updated = await db.reportManualEntries.update(entryId, updates);
	if (updated === 0) {
		throw new Error("Manual entry was not found. Please reload and try again.");
	}
}

export async function deleteManualEntry(entryId: string): Promise<void> {
	const now = Date.now();
	const updated = await db.reportManualEntries.update(entryId, {
		deletedAt: now,
		updatedAt: now,
	});
	if (updated === 0) {
		throw new Error("Manual entry was not found. Please reload and try again.");
	}
}

/** Writes one cell set of the Jul→Jun salary grid. Values are stored verbatim. */
export async function upsertMonthlySalaryRow(
	userId: string,
	fiscalYearKey: string,
	monthKey: string,
	values: ReportMonthlySalaryValues
): Promise<string> {
	const rows = await db.reportMonthlySalaryRows
		.where("[userId+fiscalYearKey]")
		.equals([userId, fiscalYearKey])
		.toArray();
	const existing = rows.find((row) => row.monthKey === monthKey && !row.deletedAt);
	const updatedAt = Date.now();

	if (existing) {
		await db.reportMonthlySalaryRows.update(existing.id, { ...values, updatedAt });
		return existing.id;
	}

	const id = uuidv4();
	await db.reportMonthlySalaryRows.put({
		id,
		userId,
		fiscalYearKey,
		monthKey,
		...values,
		updatedAt,
	});
	return id;
}

export async function deleteMonthlySalaryRow(rowId: string): Promise<void> {
	const now = Date.now();
	const updated = await db.reportMonthlySalaryRows.update(rowId, {
		deletedAt: now,
		updatedAt: now,
	});
	if (updated === 0) {
		throw new Error("Salary row was not found. Please reload and try again.");
	}
}
