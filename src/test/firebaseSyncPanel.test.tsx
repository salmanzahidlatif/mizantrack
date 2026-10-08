import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FirebaseSyncPanel } from "@/components/settings/FirebaseSyncPanel";

import type { SyncBackupCounts } from "@/lib/db/sync";

const mocks = vi.hoisted(() => ({
	clearFirestoreForUser: vi.fn(),
	getFirestoreUsage: vi.fn(),
	getSyncBackupCounts: vi.fn(),
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
		expect(within(categories).getByText("Nothing missing")).toBeInTheDocument();
		expect(within(categories).getByText("Firebase 73 total · Local 73 total")).toBeInTheDocument();
		expect(within(categories).getByText("58 active · 15 deleted · 73 total")).toBeInTheDocument();
		expect(
			within(categories).getByText(
				"Deleted markers keep merges/deletes synced; they are counted in the total."
			)
		).toBeInTheDocument();

		const transactions = screen.getByLabelText("Transactions backup status");
		expect(within(transactions).getByText("Nothing missing")).toBeInTheDocument();
		expect(
			within(transactions).getByText("Firebase 4,990 backed up · 2,683 waiting · Local 7,673 total")
		).toBeInTheDocument();
		expect(
			within(transactions).getByText(
				"2,683 local rows are waiting to upload; that explains the count difference."
			)
		).toBeInTheDocument();

		const budgets = screen.getByLabelText("Budgets backup status");
		expect(
			within(budgets).getByText("Firebase 0 backed up · 180 waiting · Local 180 total")
		).toBeInTheDocument();
		expect(
			within(budgets).getByText("All 180 local rows are waiting to upload.")
		).toBeInTheDocument();
	});
});
