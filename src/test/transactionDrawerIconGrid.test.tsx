import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TransactionDrawer } from "@/components/transactions/TransactionDrawer";

import type { Account, Category } from "@/types";
import type * as ReactType from "react";

const ids = {
	aedWallet: "33333333-3333-4333-8333-333333333333",
	category: "44444444-4444-4444-8444-444444444444",
	destination: "22222222-2222-4222-8222-222222222222",
	source: "11111111-1111-4111-8111-111111111111",
};

const mocks = vi.hoisted(() => ({
	accounts: [] as Account[],
	categories: [] as Category[],
	closeTransactionDrawer: vi.fn(),
	createTransaction: vi.fn(),
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

vi.mock("@/hooks/useDbConfig", () => ({
	useDbConfig: () => ({
		currency: "PKR",
		enabledCurrencies: ["PKR", "AED"],
	}),
}));

vi.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({
		error: vi.fn(),
		heavy: vi.fn(),
		light: vi.fn(),
		medium: vi.fn(),
		selection: vi.fn(),
		success: vi.fn(),
		warning: vi.fn(),
	}),
}));

vi.mock("@/lib/actions/transactions", () => ({
	createTransaction: mocks.createTransaction,
	deleteTransaction: vi.fn(),
	updateTransaction: vi.fn(),
}));

vi.mock("@/store/filter-store", () => ({
	useFilterStore: () => ({ activeCurrency: "PKR" }),
}));

vi.mock("@/store/ui-store", () => ({
	useUIStore: () => ({
		closeTransactionDrawer: mocks.closeTransactionDrawer,
		editTransactionId: null,
		isTransactionDrawerOpen: true,
	}),
}));

vi.mock("vaul", async () => {
	const React = await vi.importActual<typeof ReactType>("react");
	type RootContextValue = { onOpenChange?: (open: boolean) => void };
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
		{ asChild?: boolean } & ReactType.HTMLAttributes<HTMLButtonElement>
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
			<button
				type="button"
				onClick={(event) => {
					onClick?.(event);
					onOpenChange?.(false);
				}}
				{...props}>
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

function account(overrides: Partial<Account>): Account {
	return {
		currency: "PKR",
		id: overrides.id ?? ids.source,
		isArchived: false,
		openingBalance: 0,
		title: overrides.title ?? "Source PKR",
		updatedAt: 1,
		userId: "user-1",
		...overrides,
	};
}

function category(overrides: Partial<Category> = {}): Category {
	return {
		currency: "PKR",
		id: overrides.id ?? ids.category,
		title: overrides.title ?? "Groceries",
		type: overrides.type ?? "Expense",
		updatedAt: 1,
		userId: "user-1",
		...overrides,
	};
}

beforeEach(() => {
	mocks.accounts = [
		account({ id: ids.source, title: "Source PKR" }),
		account({ id: ids.destination, title: "Destination PKR" }),
		account({ currency: "AED", id: ids.aedWallet, title: "AED Wallet" }),
	];
	mocks.categories = [category()];
	mocks.createTransaction.mockResolvedValue("new-transaction-id");
	Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn(),
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("TransactionDrawer icon grid pickers", () => {
	it("updates the submitted form value when an account tile is selected", async () => {
		render(<TransactionDrawer userId="user-1" />);

		fireEvent.click(screen.getByRole("radio", { name: "Destination PKR (PKR)" }));
		fireEvent.change(screen.getByLabelText(/Amount/i), { target: { value: "25" } });
		fireEvent.click(screen.getByRole("button", { name: "Record" }));

		await waitFor(() => expect(mocks.createTransaction).toHaveBeenCalledTimes(1));
		expect(mocks.createTransaction).toHaveBeenCalledWith(
			"user-1",
			expect.objectContaining({ accountId: ids.destination })
		);
	});

	it("renders transfer destinations without the source account or other-currency accounts", async () => {
		render(<TransactionDrawer userId="user-1" />);

		await act(async () => {
			fireEvent.click(screen.getByRole("button", { name: "Transfer" }));
			fireEvent.click(screen.getByRole("radio", { name: "Source PKR (PKR)" }));
		});

		const destinationGroup = await screen.findByRole("radiogroup", { name: "To Account *" });
		expect(
			within(destinationGroup).getByRole("radio", { name: "Destination PKR (PKR)" })
		).toBeInTheDocument();
		expect(
			within(destinationGroup).queryByRole("radio", { name: "Source PKR (PKR)" })
		).not.toBeInTheDocument();
		expect(
			within(destinationGroup).queryByRole("radio", { name: "AED Wallet (AED)" })
		).not.toBeInTheDocument();
	});

	it("keeps the submit footer reachable when the account grid is long", () => {
		mocks.accounts = Array.from({ length: 60 }, (_, index) =>
			account({
				id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
				title: `Account ${index + 1}`,
			})
		);
		const { container } = render(<TransactionDrawer userId="user-1" />);

		const formBody = container.querySelector("#transaction-drawer-form > div");
		const footer = container.querySelector("[data-slot='drawer-footer']");
		const recordButton = within(footer as HTMLElement).getByRole("button", { name: "Record" });
		const pickerScrollers = Array.from(
			container.querySelectorAll("[data-slot='icon-grid-picker-scroll']")
		);

		expect(formBody).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
		expect(footer).toHaveClass("shrink-0");
		expect(recordButton).toHaveAttribute("form", "transaction-drawer-form");
		expect(pickerScrollers.length).toBeGreaterThan(0);
		expect(pickerScrollers[0]).toHaveClass("max-h-72", "sm:max-h-80");
	});
});
