import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountList } from "@/components/accounts/AccountList";
import { db } from "@/lib/db/local";
import { useUIStore } from "@/store/ui-store";

import type { Account } from "@/types";

vi.mock("@/lib/analytics/scheduleRecompute", () => ({
	recomputeAnalyticsNow: vi.fn(),
	scheduleAnalyticsRecompute: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: {
		success: vi.fn(),
	},
}));

const userId = "account-list-menu-user";
const accountId = "account-list-menu-account";

function buildAccount(): Account {
	return {
		id: accountId,
		userId,
		title: "Everyday Cash",
		openingBalance: 100,
		currency: "PKR",
		isArchived: false,
		updatedAt: 1,
	};
}

async function openAccountMenu() {
	const trigger = screen.getByRole("button", { name: /account options/i });

	fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

	return screen.findByRole("menu");
}

beforeEach(async () => {
	await db.transactions.clear();
	await db.accounts.clear();
	useUIStore.setState({
		isAccountDrawerOpen: false,
		editAccountId: null,
		isTransactionDrawerOpen: false,
		editTransactionId: null,
		isCategoryDrawerOpen: false,
		editCategoryId: null,
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("AccountList overflow menu", () => {
	it("keeps edit, archive, and delete actions from invoking row navigation", async () => {
		const account = buildAccount();
		const onSelectAccount = vi.fn();

		await db.accounts.put(account);

		render(
			<AccountList
				accounts={[account]}
				showArchived
				sortBy="title-asc"
				userId={userId}
				onSelectAccount={onSelectAccount}
			/>
		);

		await openAccountMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /^Edit$/ }));

		expect(onSelectAccount).not.toHaveBeenCalled();
		expect(useUIStore.getState().isAccountDrawerOpen).toBe(true);
		expect(useUIStore.getState().editAccountId).toBe(accountId);

		await waitFor(() => expect(screen.queryByRole("menuitem", { name: /^Edit$/ })).toBeNull());

		await openAccountMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /^Archive$/ }));

		expect(onSelectAccount).not.toHaveBeenCalled();
		await waitFor(async () => {
			await expect(db.accounts.get(accountId)).resolves.toMatchObject({ isArchived: true });
		});

		await waitFor(() => expect(screen.queryByRole("menuitem", { name: /^Archive$/ })).toBeNull());

		await openAccountMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /^Delete$/ }));

		expect(onSelectAccount).not.toHaveBeenCalled();

		await waitFor(() => expect(screen.queryByRole("menuitem", { name: /^Delete$/ })).toBeNull());

		await openAccountMenu();
		fireEvent.click(await screen.findByRole("menuitem", { name: /^Tap again to confirm$/ }));

		expect(onSelectAccount).not.toHaveBeenCalled();
		await waitFor(async () => {
			const deletedAccount = await db.accounts.get(accountId);

			expect(deletedAccount?.deletedAt).toEqual(expect.any(Number));
		});
	});
});
