import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionDrawer } from "@/components/transactions/TransactionDrawer";
import { scrollFocusedFieldIntoView } from "@/hooks/useKeyboardInset";
import { db } from "@/lib/db/local";

import type { Account, Category, Transaction } from "@/types";
import type * as ReactType from "react";

const accountId = "11111111-1111-4111-8111-111111111111";
const categoryId = "22222222-2222-4222-8222-222222222222";
const editTransactionId = "33333333-3333-4333-8333-333333333333";

const mocks = vi.hoisted(() => ({
	accounts: [] as Account[],
	categories: [] as Category[],
	createTransaction: vi.fn(),
	closeTransactionDrawer: vi.fn(),
	reopenOnClose: false,
	ui: {
		editTransactionId: null as string | null,
		isTransactionDrawerOpen: true,
	},
}));

vi.mock("dexie-react-hooks", () => ({
	useLiveQuery: <T,>(_query: () => T | Promise<T>, _deps?: unknown[], defaultResult?: T) =>
		defaultResult,
}));

vi.mock("@/hooks/useAccounts", () => ({
	useActiveAccounts: () => mocks.accounts,
}));

vi.mock("@/hooks/useCategories", () => ({
	useCategories: () => mocks.categories,
}));

vi.mock("@/lib/actions/transactions", () => ({
	createTransaction: mocks.createTransaction,
	deleteTransaction: vi.fn(),
	updateTransaction: vi.fn(),
}));

vi.mock("@/lib/usageRanking", () => ({
	EMPTY_TRANSACTION_USAGE_RANKING: { accountUsage: {}, categoryUsage: {} },
	loadRecentTransactionUsageRanking: vi.fn(),
	sortRecordsByUsage: <T,>(records: T[]) => records,
}));

vi.mock("@/store/filter-store", () => ({
	useFilterStore: () => ({ activeCurrency: "PKR" }),
}));

vi.mock("@/store/ui-store", () => ({
	useUIStore: () => ({
		closeTransactionDrawer: () => {
			mocks.closeTransactionDrawer();
			mocks.ui.isTransactionDrawerOpen = mocks.reopenOnClose;
			mocks.ui.editTransactionId = null;
		},
		editTransactionId: mocks.ui.editTransactionId,
		isTransactionDrawerOpen: mocks.ui.isTransactionDrawerOpen,
	}),
}));

vi.mock("@/components/ui/select", async () => {
	const React = await vi.importActual<typeof ReactType>("react");

	type SelectContextValue = {
		onValueChange?: (value: string) => void;
		value?: string;
	};
	const SelectContext = React.createContext<SelectContextValue>({});

	function Select({
		children,
		onValueChange,
		value,
	}: ReactType.PropsWithChildren<SelectContextValue>) {
		return (
			<SelectContext.Provider value={{ onValueChange, value }}>
				<div data-slot="select">{children}</div>
			</SelectContext.Provider>
		);
	}

	function SelectTrigger({
		children,
		...props
	}: ReactType.PropsWithChildren<ReactType.ButtonHTMLAttributes<HTMLButtonElement>>) {
		return (
			<button type="button" role="combobox" {...props}>
				{children}
			</button>
		);
	}

	function SelectValue({ placeholder }: { placeholder?: string }) {
		const { value } = React.useContext(SelectContext);
		return <span>{value ?? placeholder}</span>;
	}

	function SelectContent({ children }: ReactType.PropsWithChildren) {
		return <div>{children}</div>;
	}

	function SelectItem({ children, value }: ReactType.PropsWithChildren<{ value: string }>) {
		const { onValueChange } = React.useContext(SelectContext);

		return (
			<button type="button" role="option" onClick={() => onValueChange?.(value)}>
				{children}
			</button>
		);
	}

	return { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
});

vi.mock("vaul", async () => {
	const React = await vi.importActual<typeof ReactType>("react");

	type RootContextValue = {
		onOpenChange?: (open: boolean) => void;
	};
	type RootProps = ReactType.PropsWithChildren<
		{
			closeThreshold?: number;
			handleOnly?: boolean;
			onOpenChange?: (open: boolean) => void;
			open?: boolean;
			repositionInputs?: boolean;
			scrollLockTimeout?: number;
			shouldScaleBackground?: boolean;
			snapToSequentialPoint?: boolean;
		} & ReactType.HTMLAttributes<HTMLDivElement>
	>;
	type CloseProps = ReactType.PropsWithChildren<
		{
			asChild?: boolean;
		} & ReactType.HTMLAttributes<HTMLButtonElement>
	>;

	const DrawerContext = React.createContext<RootContextValue>({});

	function Root({
		children,
		closeThreshold: _closeThreshold,
		handleOnly: _handleOnly,
		onOpenChange,
		open,
		repositionInputs: _repositionInputs,
		scrollLockTimeout: _scrollLockTimeout,
		shouldScaleBackground: _shouldScaleBackground,
		snapToSequentialPoint: _snapToSequentialPoint,
		...props
	}: RootProps) {
		return (
			<DrawerContext.Provider value={{ onOpenChange }}>
				<div data-testid="mock-vaul-root" data-open={String(Boolean(open))} {...props}>
					{open ? children : null}
				</div>
			</DrawerContext.Provider>
		);
	}

	const Portal = ({ children }: ReactType.PropsWithChildren) => <>{children}</>;
	const Overlay = React.forwardRef<HTMLDivElement, ReactType.HTMLAttributes<HTMLDivElement>>(
		function Overlay(props, ref) {
			return <div ref={ref} {...props} />;
		}
	);
	const Content = React.forwardRef<HTMLDivElement, ReactType.HTMLAttributes<HTMLDivElement>>(
		function Content(props, ref) {
			return <div ref={ref} data-vaul-drawer-direction="bottom" {...props} />;
		}
	);
	const Handle = React.forwardRef<HTMLDivElement, ReactType.HTMLAttributes<HTMLDivElement>>(
		function Handle(props, ref) {
			return <div ref={ref} data-vaul-handle="" {...props} />;
		}
	);
	const Title = React.forwardRef<HTMLHeadingElement, ReactType.HTMLAttributes<HTMLHeadingElement>>(
		function Title(props, ref) {
			return <h2 ref={ref} {...props} />;
		}
	);
	const Description = React.forwardRef<
		HTMLParagraphElement,
		ReactType.HTMLAttributes<HTMLParagraphElement>
	>(function Description(props, ref) {
		return <p ref={ref} {...props} />;
	});
	const Close = ({ asChild, children, onClick, ...props }: CloseProps) => {
		const { onOpenChange } = React.useContext(DrawerContext);
		const handleClick = (event: ReactType.MouseEvent<HTMLButtonElement>) => {
			onClick?.(event);
			onOpenChange?.(false);
		};

		if (asChild && React.isValidElement(children)) {
			const child = children as ReactType.ReactElement<{
				onClick?: (event: ReactType.MouseEvent) => void;
			}>;
			return React.cloneElement(child, {
				onClick: (event: ReactType.MouseEvent) => {
					child.props.onClick?.(event);
					onOpenChange?.(false);
				},
			});
		}

		return (
			<button type="button" onClick={handleClick} {...props}>
				{children as ReactType.ReactNode}
			</button>
		);
	};

	return {
		Drawer: {
			Close,
			Content,
			Description,
			Handle,
			Overlay,
			Portal,
			Root,
			Title,
			Trigger: React.forwardRef<
				HTMLButtonElement,
				ReactType.ButtonHTMLAttributes<HTMLButtonElement>
			>(function Trigger(props, ref) {
				return <button ref={ref} {...props} />;
			}),
		},
	};
});

function account(): Account {
	return {
		currency: "PKR",
		id: accountId,
		isArchived: false,
		openingBalance: 0,
		title: "Cash",
		updatedAt: 1,
		userId: "user-1",
	};
}

function category(): Category {
	return {
		currency: "PKR",
		id: categoryId,
		title: "Food",
		type: "Expense",
		updatedAt: 1,
		userId: "user-1",
	};
}

function transaction(overrides: Partial<Transaction> = {}): Transaction {
	return {
		accountId,
		amount: 42.5,
		categoryId,
		date: new Date("2026-10-01T08:00:00.000Z").getTime(),
		description: "Edited dinner",
		id: editTransactionId,
		type: "Expense",
		updatedAt: 1,
		userId: "user-1",
		...overrides,
	};
}

function setDrawerState(isOpen: boolean, editId: string | null = null) {
	mocks.ui.isTransactionDrawerOpen = isOpen;
	mocks.ui.editTransactionId = editId;
}

function amountInput() {
	return screen.getByLabelText(/Amount/i) as HTMLInputElement;
}

function descriptionInput() {
	return screen.getByLabelText("Description") as HTMLInputElement;
}

async function chooseAccount() {
	fireEvent.click(await screen.findByRole("radio", { name: /Cash \(PKR\)/i }));
}

beforeEach(async () => {
	mocks.accounts = [account()];
	mocks.categories = [category()];
	mocks.createTransaction.mockResolvedValue("new-transaction-id");
	mocks.closeTransactionDrawer.mockClear();
	mocks.reopenOnClose = false;
	setDrawerState(true, null);
	Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn(),
	});
	await db.delete();
	await db.open();
});

afterEach(async () => {
	vi.useRealTimers();
	cleanup();
	vi.clearAllMocks();
	document.documentElement.style.removeProperty("--keyboard-inset");
	await db.delete();
});

describe("TransactionDrawer form reset regressions", () => {
	it("clears amount and description after a successful save before the next new transaction", async () => {
		mocks.reopenOnClose = true;
		const { rerender } = render(<TransactionDrawer userId="user-1" />);

		await chooseAccount();
		fireEvent.change(amountInput(), { target: { value: "123.45" } });
		fireEvent.change(descriptionInput(), { target: { value: "Lunch old value" } });
		fireEvent.click(screen.getByRole("button", { name: "Record" }));

		await waitFor(() => expect(mocks.createTransaction).toHaveBeenCalledTimes(1));
		expect(mocks.closeTransactionDrawer).toHaveBeenCalledTimes(1);

		setDrawerState(true, null);
		rerender(<TransactionDrawer userId="user-1" />);

		await waitFor(() => expect(amountInput()).toHaveValue(null));
		expect(descriptionInput()).toHaveValue("");
	});

	it("does not show edited transaction values when reopening for a new transaction", async () => {
		await db.accounts.put(account());
		await db.categories.put(category());
		await db.transactions.put(transaction());

		setDrawerState(true, editTransactionId);
		const { rerender } = render(<TransactionDrawer userId="user-1" />);

		await waitFor(() => expect(amountInput()).toHaveValue(42.5));
		expect(descriptionInput()).toHaveValue("Edited dinner");

		setDrawerState(true, null);
		rerender(<TransactionDrawer userId="user-1" />);

		await waitFor(() => expect(amountInput()).toHaveValue(null));
		expect(descriptionInput()).toHaveValue("");
	});

	it("loads an existing transaction when opening for edit", async () => {
		await db.accounts.put(account());
		await db.categories.put(category());
		await db.transactions.put(transaction({ amount: 88, description: "Existing value" }));

		setDrawerState(true, editTransactionId);
		render(<TransactionDrawer userId="user-1" />);

		await waitFor(() => expect(amountInput()).toHaveValue(88));
		expect(descriptionInput()).toHaveValue("Existing value");
	});
});

describe("TransactionDrawer keyboard focus scrolling", () => {
	it("scrolls the transaction form body, not the page, when the keyboard inset makes the focused amount field hidden", async () => {
		vi.useFakeTimers();
		const scrollIntoView = vi.fn();
		Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
			configurable: true,
			value: scrollIntoView,
		});

		const { container } = render(<TransactionDrawer userId="user-1" />);
		document.documentElement.style.setProperty("--keyboard-inset", "320px");
		const formBody = container.querySelector("#transaction-drawer-form > div");
		const footer = container.querySelector("[data-slot='drawer-footer']");
		const amount = amountInput();

		expect(formBody).toBeInstanceOf(HTMLElement);
		expect(footer).toBeInstanceOf(HTMLElement);

		Object.defineProperty(formBody, "clientHeight", { configurable: true, value: 520 });
		Object.defineProperty(formBody, "scrollHeight", { configurable: true, value: 1200 });
		vi.spyOn(formBody as HTMLElement, "getBoundingClientRect").mockReturnValue({
			bottom: 700,
			height: 520,
			left: 0,
			right: 390,
			toJSON: () => "",
			top: 180,
			width: 390,
			x: 0,
			y: 180,
		});
		vi.spyOn(footer as HTMLElement, "getBoundingClientRect").mockReturnValue({
			bottom: 700,
			height: 100,
			left: 0,
			right: 390,
			toJSON: () => "",
			top: 600,
			width: 390,
			x: 0,
			y: 600,
		});
		vi.spyOn(amount, "getBoundingClientRect").mockReturnValue({
			bottom: 570,
			height: 44,
			left: 16,
			right: 374,
			toJSON: () => "",
			top: 526,
			width: 358,
			x: 16,
			y: 526,
		});

		scrollFocusedFieldIntoView(amount);
		await vi.runAllTimersAsync();

		expect((formBody as HTMLElement).scrollTop).toBeGreaterThan(0);
		expect(scrollIntoView).not.toHaveBeenCalled();
	});
});
