import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { AccountDrawer } from "@/components/accounts/AccountDrawer";
import { CategoryDrawer } from "@/components/categories/CategoryDrawer";
import { TransactionDrawer } from "@/components/transactions/TransactionDrawer";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";

import type * as ReactType from "react";

const closeDrawerMocks = vi.hoisted(() => ({
	account: vi.fn(),
	category: vi.fn(),
	transaction: vi.fn(),
}));

vi.mock("@/hooks/useAccounts", () => ({
	useActiveAccounts: () => [],
}));

vi.mock("@/hooks/useCategories", () => ({
	useCategories: () => [],
}));

vi.mock("@/hooks/useDbConfig", () => ({
	useDbConfig: () => ({
		currency: "PKR",
		enabledCurrencies: ["PKR"],
	}),
}));

vi.mock("@/store/filter-store", () => ({
	useFilterStore: () => ({ activeCurrency: "PKR" }),
}));

vi.mock("@/store/ui-store", () => ({
	useUIStore: () => ({
		closeAccountDrawer: closeDrawerMocks.account,
		closeCategoryDrawer: closeDrawerMocks.category,
		closeTransactionDrawer: closeDrawerMocks.transaction,
		editAccountId: null,
		editCategoryId: null,
		editTransactionId: null,
		isAccountDrawerOpen: true,
		isCategoryDrawerOpen: true,
		isTransactionDrawerOpen: true,
	}),
}));

vi.mock("vaul", async () => {
	const React = await vi.importActual<typeof ReactType>("react");

	type RootContextValue = {
		dismissible?: boolean;
		modal?: boolean;
		onOpenChange?: (open: boolean) => void;
	};
	type RootProps = ReactType.PropsWithChildren<
		{
			closeThreshold?: number;
			dismissible?: boolean;
			handleOnly?: boolean;
			modal?: boolean;
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
		closeThreshold,
		dismissible,
		handleOnly,
		modal,
		onOpenChange,
		open,
		repositionInputs: _repositionInputs,
		scrollLockTimeout: _scrollLockTimeout,
		shouldScaleBackground: _shouldScaleBackground,
		snapToSequentialPoint: _snapToSequentialPoint,
		...props
	}: RootProps) {
		React.useEffect(() => {
			function handleKeyDown(event: KeyboardEvent) {
				if (event.key === "Escape" && (dismissible ?? true) && (modal ?? true)) {
					onOpenChange?.(false);
				}
			}

			document.addEventListener("keydown", handleKeyDown);
			return () => document.removeEventListener("keydown", handleKeyDown);
		}, [dismissible, modal, onOpenChange]);

		return (
			<DrawerContext.Provider value={{ dismissible, modal, onOpenChange }}>
				<div
					data-testid="mock-vaul-root"
					data-close-threshold={closeThreshold}
					data-dismissible={dismissible === undefined ? "default" : String(dismissible)}
					data-handle-only={String(Boolean(handleOnly))}
					data-modal={modal === undefined ? "default" : String(modal)}
					data-open={String(Boolean(open))}
					{...props}>
					{open ? children : null}
				</div>
			</DrawerContext.Provider>
		);
	}

	const Portal = ({ children }: ReactType.PropsWithChildren) => <>{children}</>;
	const Trigger = React.forwardRef<HTMLButtonElement, ReactType.HTMLAttributes<HTMLButtonElement>>(
		function Trigger(props, ref) {
			return <button ref={ref} {...props} />;
		}
	);
	const Overlay = React.forwardRef<HTMLDivElement, ReactType.HTMLAttributes<HTMLDivElement>>(
		function Overlay({ onClick, ...props }, ref) {
			const { dismissible, modal, onOpenChange } = React.useContext(DrawerContext);

			return (
				<div
					ref={ref}
					{...props}
					onClick={(event: ReactType.MouseEvent<HTMLDivElement>) => {
						onClick?.(event);
						if ((dismissible ?? true) && (modal ?? true)) {
							onOpenChange?.(false);
						}
					}}
				/>
			);
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
			Trigger,
		},
	};
});

const FORM_CLOSE_THRESHOLD = "0.55";

beforeAll(() => {
	Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: vi.fn(),
	});
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function classListIncludes(element: Element, className: string) {
	return element.className.toString().split(/\s+/).includes(className);
}

function expectSingleScrollableBody(container: HTMLElement, formId: string) {
	const content = container.querySelector("[data-slot='drawer-content']");
	const body = container.querySelector(`#${formId} > div`);
	const overflowYAutoElements = Array.from(container.querySelectorAll("*")).filter((element) =>
		classListIncludes(element, "overflow-y-auto")
	);

	expect(content).toBeInstanceOf(HTMLElement);
	expect(body).toBeInstanceOf(HTMLElement);
	expect(content).toHaveClass("overflow-hidden");
	expect(content).not.toHaveClass("overflow-y-auto");
	expect(body).toHaveClass("overflow-y-auto", "overscroll-contain");
	expect(overflowYAutoElements).toEqual([body]);
}

describe("form drawer dismissal UX", () => {
	it("configures transaction body gestures not to start Vaul dismissal", async () => {
		const { container } = render(<TransactionDrawer userId="user-1" />);
		const root = screen.getByTestId("mock-vaul-root");

		await waitFor(() => expect(root).toHaveAttribute("data-open", "true"));
		expect(root).toHaveAttribute("data-handle-only", "true");
		expect(root).toHaveAttribute("data-close-threshold", FORM_CLOSE_THRESHOLD);
		expect(root).toHaveAttribute("data-dismissible", "default");
		expect(root).toHaveAttribute("data-modal", "default");
		expectSingleScrollableBody(container, "transaction-drawer-form");
	});

	it("configures category body gestures not to start Vaul dismissal", async () => {
		const { container } = render(<CategoryDrawer userId="user-1" />);
		const root = screen.getByTestId("mock-vaul-root");

		await waitFor(() => expect(root).toHaveAttribute("data-open", "true"));
		expect(root).toHaveAttribute("data-handle-only", "true");
		expect(root).toHaveAttribute("data-close-threshold", FORM_CLOSE_THRESHOLD);
		expect(root).toHaveAttribute("data-dismissible", "default");
		expect(root).toHaveAttribute("data-modal", "default");
		expectSingleScrollableBody(container, "category-drawer-form");
	});

	it("configures account body gestures not to start Vaul dismissal", async () => {
		const { container } = render(<AccountDrawer userId="user-1" />);
		const root = screen.getByTestId("mock-vaul-root");

		await waitFor(() => expect(root).toHaveAttribute("data-open", "true"));
		expect(root).toHaveAttribute("data-handle-only", "true");
		expect(root).toHaveAttribute("data-close-threshold", FORM_CLOSE_THRESHOLD);
		expect(root).toHaveAttribute("data-dismissible", "default");
		expect(root).toHaveAttribute("data-modal", "default");
		expectSingleScrollableBody(container, "account-drawer-form");
	});

	it("keeps overlay and Escape dismissal enabled by default", () => {
		const handleOpenChange = vi.fn();

		render(
			<Drawer open onOpenChange={handleOpenChange}>
				<DrawerContent>
					<DrawerTitle>Drawer title</DrawerTitle>
					<DrawerDescription>Drawer description</DrawerDescription>
				</DrawerContent>
			</Drawer>
		);

		fireEvent.click(
			screen.getByTestId("mock-vaul-root").querySelector("[data-slot='drawer-overlay']")!
		);
		expect(handleOpenChange).toHaveBeenCalledWith(false);

		handleOpenChange.mockClear();
		fireEvent.keyDown(document, { key: "Escape" });
		expect(handleOpenChange).toHaveBeenCalledWith(false);
	});

	it("renders a 48px-tall Vaul handle target with a slim visual bar", () => {
		const { container } = render(
			<Drawer open>
				<DrawerContent>
					<DrawerTitle>Drawer title</DrawerTitle>
					<DrawerDescription>Drawer description</DrawerDescription>
				</DrawerContent>
			</Drawer>
		);
		const handle = container.querySelector("[data-vaul-handle]");
		const visualBar = handle?.querySelector("span");

		expect(handle).toHaveClass("!h-12", "!w-24", "!touch-none", "!bg-transparent");
		expect(visualBar).toHaveClass("h-1.5", "w-12", "rounded-full");
	});
});
