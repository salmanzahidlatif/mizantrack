import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppShell, getPageTitle } from "@/components/layout/AppShell";
import { BottomNav } from "@/components/layout/BottomNav";

import type { ComponentProps, PropsWithChildren } from "react";

const mockPathname = vi.hoisted(() => ({
	value: "/dashboard",
}));

vi.mock("next/navigation", () => ({
	usePathname: () => mockPathname.value,
	useRouter: () => ({
		back: vi.fn(),
		prefetch: vi.fn(),
		push: vi.fn(),
	}),
}));

vi.mock("next/link", () => ({
	default: ({
		href,
		transitionTypes: _transitionTypes,
		children,
		...props
	}: PropsWithChildren<
		Omit<ComponentProps<"a">, "href"> & {
			href: string | { pathname?: string };
			transitionTypes?: string[];
		}
	>) => (
		<a href={typeof href === "string" ? href : (href.pathname ?? "")} {...props}>
			{children}
		</a>
	),
}));

vi.mock("next/image", () => ({
	default: ({ alt }: { alt: string; src: string; unoptimized?: boolean }) => (
		<span aria-label={alt} role="img" />
	),
}));

vi.mock("@/components/layout/AppLockGuard", () => ({
	AppLockGuard: ({ children }: PropsWithChildren<{ userId: string }>) => <>{children}</>,
}));

vi.mock("@/components/layout/CurrencySelector", () => ({
	CurrencySelector: () => <button type="button">Currency</button>,
}));

vi.mock("@/components/layout/SyncStatusBadge", () => ({
	SyncStatusBadge: () => <div data-testid="sync-status-badge" />,
}));

vi.mock("@/components/layout/ThemeToggle", () => ({
	ThemeToggle: () => <button type="button">Theme</button>,
}));

vi.mock("@/components/transactions/TransactionDrawer", () => ({
	TransactionDrawer: () => null,
}));

vi.mock("@/components/ui/dropdown-menu", () => {
	function DropdownMenu({ children }: PropsWithChildren) {
		return <div>{children}</div>;
	}

	function DropdownMenuTrigger({
		children,
		asChild: _asChild,
	}: PropsWithChildren<{ asChild?: boolean }>) {
		return <>{children}</>;
	}

	function DropdownMenuContent({ children, ...props }: PropsWithChildren<ComponentProps<"div">>) {
		return (
			<div data-testid="dropdown-content" {...props}>
				{children}
			</div>
		);
	}

	function DropdownMenuItem({
		children,
		asChild: _asChild,
		variant: _variant,
		onSelect: _onSelect,
		...props
	}: PropsWithChildren<
		ComponentProps<"div"> & {
			asChild?: boolean;
			onSelect?: () => void;
			variant?: "default" | "destructive";
		}
	>) {
		return (
			<div role="menuitem" {...props}>
				{children}
			</div>
		);
	}

	function DropdownMenuLabel({ children }: PropsWithChildren) {
		return <div>{children}</div>;
	}

	function DropdownMenuSeparator() {
		return <hr />;
	}

	return {
		DropdownMenu,
		DropdownMenuContent,
		DropdownMenuItem,
		DropdownMenuLabel,
		DropdownMenuSeparator,
		DropdownMenuTrigger,
	};
});

vi.mock("@/hooks/useAutoSync", () => ({
	useAutoSync: vi.fn(),
}));

vi.mock("@/hooks/useDbConfig", () => ({
	useDbConfig: () => ({
		appLockEnabled: true,
		currency: "PKR",
		enabled: false,
		enabledCurrencies: ["PKR"],
		pinHash: "pin-hash",
	}),
}));

vi.mock("@/hooks/useSwipeNavigation", () => ({
	useSwipeNavigation: () => ({
		activeIndex: 0,
		isDragging: false,
		style: {},
	}),
}));

vi.mock("@/lib/actions/auth", () => ({
	signOutAction: vi.fn(),
}));

vi.mock("@/lib/db/local", () => ({
	db: {
		accounts: {
			where: () => ({
				equals: () => ({
					filter: () => ({
						count: () => Promise.resolve(0),
					}),
				}),
			}),
		},
	},
}));

vi.mock("@/store/filter-store", () => ({
	useFilterStore: () => ({
		activeCurrency: "PKR",
		setActiveCurrency: vi.fn(),
	}),
}));

vi.mock("@/store/ui-store", () => ({
	useUIStore: () => ({
		openAddTransaction: vi.fn(),
	}),
}));

describe("mobile navigation", () => {
	it("renders Categories in the bottom nav without a Settings tab", () => {
		mockPathname.value = "/dashboard";

		render(<BottomNav userImage={null} userName="Test User" />);

		expect(screen.getByRole("link", { name: /categories/i })).toHaveAttribute(
			"href",
			"/categories"
		);
		expect(screen.queryByRole("link", { name: /settings/i })).not.toBeInTheDocument();
		expect(screen.queryByRole("link", { name: /^me$/i })).not.toBeInTheDocument();
	});

	it("keeps Settings reachable from the avatar menu", () => {
		mockPathname.value = "/dashboard";

		render(
			<AppShell
				user={{
					email: "test@example.com",
					id: "user-1",
					image: "",
					name: "Test User",
				}}>
				<div>Dashboard content</div>
			</AppShell>
		);

		const menuContents = screen.getAllByTestId("dropdown-content");
		expect(
			menuContents.some(
				(menu) =>
					within(menu)
						.queryByRole("link", { name: /settings/i })
						?.getAttribute("href") === "/settings"
			)
		).toBe(true);
	});

	it("resolves mobile page titles for Settings and Categories", () => {
		expect(getPageTitle("/settings")).toBe("Settings");
		expect(getPageTitle("/categories")).toBe("Categories");
	});
});
