import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FirebaseSyncPanel } from "@/components/settings/FirebaseSyncPanel";

import type { SyncBackupCounts } from "@/lib/db/sync";

const mocks = vi.hoisted(() => ({
	clearFirestoreForUser: vi.fn(),
	getFirestoreUsage: vi.fn(),
	getSyncBackupCounts: vi.fn(),
	repairSyncFromFirestore: vi.fn(),
	resetFirestoreForUser: vi.fn(),
	triggerSync: vi.fn(),
	upsertDbConfig: vi.fn(),
}));

vi.mock("@/components/settings/SyncSetupWizard", () => ({
	SyncSetupWizard: () => null,
}));

vi.mock("@/components/settings/SyncValidationFeedback", () => ({
	SyncValidationFeedback: () => null,
}));

vi.mock("@/hooks/useDbConfig", () => ({
	useDbConfig: () => ({
		firebaseConfig: "{}",
		enabled: true,
	}),
}));

vi.mock("@/lib/db/dbConfig", () => ({
	upsertDbConfig: mocks.upsertDbConfig,
}));

vi.mock("@/lib/db/firebase", () => ({
	resetFirestoreForUser: mocks.resetFirestoreForUser,
}));

vi.mock("@/lib/db/sync", () => ({
	clearFirestoreForUser: mocks.clearFirestoreForUser,
	getFirestoreUsage: mocks.getFirestoreUsage,
	getSyncBackupCounts: mocks.getSyncBackupCounts,
	repairSyncFromFirestore: mocks.repairSyncFromFirestore,
}));

vi.mock("@/store/sync-store", () => ({
	useSyncStore: () => ({
		syncing: false,
		lastSync: null,
		error: null,
		triggerSync: mocks.triggerSync,
	}),
}));

vi.mock("sonner", () => ({
	toast: {
		error: vi.fn(),
		success: vi.fn(),
	},
}));

describe("FirebaseSyncPanel backup counts", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getFirestoreUsage.mockResolvedValue(null);
		mocks.repairSyncFromFirestore.mockResolvedValue({
			tables: [],
			totalRemoteScanned: 0,
			totalPulled: 0,
			totalStamped: 0,
			totalMarkedPending: 0,
		});
	});

	it("renders tombstones and pending rows as reconciled instead of missing data", async () => {
		const backupCounts: SyncBackupCounts = {
			tables: [
				{
					table: "categories",
					remote: 73,
					local: 73,
					localActive: 58,
					localDeleted: 15,
					pending: 0,
				},
				{
					table: "transactions",
					remote: 4990,
					local: 7673,
					localActive: 7673,
					localDeleted: 0,
					pending: 2683,
				},
				{
					table: "budgets",
					remote: 0,
					local: 180,
					localActive: 180,
					localDeleted: 0,
					pending: 180,
				},
			],
			currencyBreakdown: [],
			totalLocal: 7926,
			totalRemote: 5063,
			totalPending: 2863,
		};
		mocks.getSyncBackupCounts.mockResolvedValue(backupCounts);

		render(<FirebaseSyncPanel userId="owner-user" />);

		const categories = await screen.findByLabelText("Categories backup status");
		expect(categories).not.toHaveAttribute("open");
		expect(within(categories).getByText("Reconciled")).toBeInTheDocument();
		expect(
			within(categories).getByText(/Firebase & local 73 total · 58 active/)
		).toBeInTheDocument();
		const categoriesSummary = within(categories).getByText("Categories").closest("summary");
		expect(categoriesSummary).not.toBeNull();
		fireEvent.click(categoriesSummary!);
		expect(categories).toHaveAttribute("open");
		expect(
			within(categories).getByText(
				"58 active · 15 deleted · 73 total. Deleted markers keep merges and deletes synced across devices."
			)
		).toBeInTheDocument();

		const transactions = screen.getByLabelText("Transactions backup status");
		expect(transactions).toHaveAttribute("open");
		expect(within(transactions).getByText("2,683 pending")).toBeInTheDocument();
		expect(
			within(transactions).getByText(/4,990 backed up · 2,683 waiting · 7,673 local/)
		).toBeInTheDocument();
		expect(
			within(transactions).getByText(
				"2,683 local rows are waiting to upload; that explains the count difference. Local: 7,673 active · 0 deleted · 7,673 total."
			)
		).toBeInTheDocument();

		const budgets = screen.getByLabelText("Budgets backup status");
		expect(budgets).toHaveAttribute("open");
		expect(within(budgets).getByText(/0 backed up · 180 waiting · 180 local/)).toBeInTheDocument();
		expect(
			within(budgets).getByText(
				"All 180 local rows are waiting to upload. Local: 180 active · 0 deleted · 180 total."
			)
		).toBeInTheDocument();
	});

	it("offers an opt-in full-scan repair when Firebase has extra rows", async () => {
		const mismatchCounts: SyncBackupCounts = {
			tables: [
				{
					table: "transactions",
					remote: 11433,
					local: 11431,
					localActive: 11431,
					localDeleted: 0,
					pending: 0,
				},
			],
			currencyBreakdown: [],
			totalLocal: 11431,
			totalRemote: 11433,
			totalPending: 0,
		};
		const healedCounts: SyncBackupCounts = {
			...mismatchCounts,
			tables: [
				{
					table: "transactions",
					remote: 11433,
					local: 11433,
					localActive: 11433,
					localDeleted: 0,
					pending: 0,
				},
			],
			totalLocal: 11433,
		};
		mocks.getSyncBackupCounts
			.mockResolvedValueOnce(mismatchCounts)
			.mockResolvedValueOnce(healedCounts);
		mocks.repairSyncFromFirestore.mockResolvedValueOnce({
			tables: [
				{
					table: "transactions",
					remoteScanned: 11433,
					pulled: 2,
					stamped: 2,
					markedPending: 0,
				},
			],
			totalRemoteScanned: 11433,
			totalPulled: 2,
			totalStamped: 2,
			totalMarkedPending: 0,
		});

		render(<FirebaseSyncPanel userId="owner-user" />);

		const transactions = await screen.findByLabelText("Transactions backup status");
		expect(within(transactions).getByText("Review counts")).toBeInTheDocument();
		expect(within(transactions).getByText(/about 11,433 document reads/)).toBeInTheDocument();

		fireEvent.click(within(transactions).getByRole("button", { name: /repair from firebase/i }));

		await waitFor(() => {
			expect(mocks.repairSyncFromFirestore).toHaveBeenCalledWith("owner-user", ["transactions"]);
		});
		expect(await screen.findByText("Reconciled")).toBeInTheDocument();
	});
});
