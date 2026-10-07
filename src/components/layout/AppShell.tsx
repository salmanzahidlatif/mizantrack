"use client";

import {
	LayoutDashboard,
	ArrowLeftRight,
	Wallet,
	Tag,
	BarChart3,
	Settings,
	LogOut,
	Lock,
	Moon,
	Plus,
	WalletCards,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useOfflineAuth } from "@/components/auth/OfflineAuthProvider";
import { AppLockGuard } from "@/components/layout/AppLockGuard";
import { BottomNav, BOTTOM_NAV_ROUTES } from "@/components/layout/BottomNav";
import { CurrencySelector } from "@/components/layout/CurrencySelector";
import { SyncStatusBadge } from "@/components/layout/SyncStatusBadge";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { TransactionDrawer } from "@/components/transactions/TransactionDrawer";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAutoSync } from "@/hooks/useAutoSync";
import { useDbConfig } from "@/hooks/useDbConfig";
import { useHaptics } from "@/hooks/useHaptics";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { useSwipeNavigation } from "@/hooks/useSwipeNavigation";
import {
	recomputeAnalyticsNow,
	scheduleAnalyticsRecompute,
} from "@/lib/analytics/scheduleRecompute";
import { db } from "@/lib/db/local";
import { FAB, FROSTED_HEADER } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useFilterStore } from "@/store/filter-store";
import { useLockStore } from "@/store/lock-store";
import { useSyncStore } from "@/store/sync-store";
import { useUIStore } from "@/store/ui-store";

import type { Session } from "next-auth";

const NAV_ITEMS = [
	{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
	{ href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
	{ href: "/accounts", label: "Accounts", icon: Wallet },
	{ href: "/categories", label: "Categories", icon: Tag },
	{ href: "/budgets", label: "Budgets", icon: WalletCards },
	{ href: "/reports", label: "Reports", icon: BarChart3 },
	{ href: "/zakat", label: "Zakat", icon: Moon },
	{ href: "/settings", label: "Settings", icon: Settings },
];

const PAGE_TITLE_ITEMS = [...NAV_ITEMS, { href: "/budgets", label: "Budgets" }];

export function getPageTitle(pathname: string) {
	return (
		PAGE_TITLE_ITEMS.find(({ href }) => pathname === href || pathname.startsWith(`${href}/`))
			?.label ?? "Mizan Track"
	);
}

interface AppShellProps {
	user: Session["user"];
	children: React.ReactNode;
}

export function AppShell({ user, children }: AppShellProps) {
	const pathname = usePathname();
	const pageTitle = getPageTitle(pathname);
	const mainRef = useRef<HTMLElement>(null);
	const [contentScrolled, setContentScrolled] = useState(false);
	const swipeNavigation = useSwipeNavigation({
		containerRef: mainRef,
		pathname,
		routes: BOTTOM_NAV_ROUTES,
	});
	const syncError = useSyncStore((s) => s.error);
	const lastSyncResult = useSyncStore((s) => s.lastSyncResult);
	const config = useDbConfig(user?.id ?? "");
	const { activeCurrency, setActiveCurrency } = useFilterStore();
	const triggerSync = useSyncStore((s) => s.triggerSync);
	const openAddTransaction = useUIStore((s) => s.openAddTransaction);
	const haptics = useHaptics();
	const { isOffline, signOut } = useOfflineAuth();
	const pullToRefresh = usePullToRefresh({
		containerRef: mainRef,
		enabled: Boolean(user?.id),
		onRefresh: async () => {
			if (!user?.id) return;
			await recomputeAnalyticsNow(user.id);
		},
	});

	/**
	 * Handle currency switch from the header selector.
	 * If the selected currency has no local accounts yet and Firebase sync is
	 * enabled, trigger a sync immediately.
	 */
	async function handleCurrencyChange(code: string) {
		setActiveCurrency(code);
		if (!config?.enabled || !user?.id) return;
		const accountCount = await db.accounts
			.where("userId")
			.equals(user.id)
			.filter((a) => !a.deletedAt && a.currency === code)
			.count();
		if (accountCount === 0) {
			void triggerSync(user.id);
		}
	}

	// After a sync that pulled accounts, if the active currency has no local
	// accounts, auto-switch to the first currency that does so data is visible.
	useEffect(() => {
		if (!lastSyncResult?.synced || !lastSyncResult.tables?.accounts?.pulled || !user?.id) return;
		if (lastSyncResult.tables.accounts.pulled === 0) return;

		void (async () => {
			const activeCount = await db.accounts
				.where("userId")
				.equals(user.id)
				.filter((a) => !a.deletedAt && a.currency === activeCurrency)
				.count();
			if (activeCount > 0) return; // already showing data

			// Find the first enabled currency that has accounts
			const candidates = config?.enabledCurrencies ?? (config?.currency ? [config.currency] : []);
			for (const code of candidates) {
				const count = await db.accounts
					.where("userId")
					.equals(user.id)
					.filter((a) => !a.deletedAt && a.currency === code)
					.count();
				if (count > 0) {
					setActiveCurrency(code);
					break;
				}
			}
		})();
	}, [lastSyncResult]);

	useAutoSync(user?.id ?? "");

	const canLock = Boolean(config?.appLockEnabled && config?.pinHash);
	const handleLockNow = () => useLockStore.getState().lock();
	const renderSettingsMenuItem = () => (
		<DropdownMenuItem asChild className="gap-2">
			<Link href="/settings">
				<Settings className="h-4 w-4" />
				Settings
			</Link>
		</DropdownMenuItem>
	);
	const renderBudgetsMenuItem = () => (
		<DropdownMenuItem asChild className="gap-2">
			<Link href="/budgets">
				<WalletCards className="h-4 w-4" />
				Budgets
			</Link>
		</DropdownMenuItem>
	);
	const handleAddTransaction = () => {
		haptics.medium();
		openAddTransaction();
	};
	const handleSignOut = () => {
		void signOut();
	};

	useEffect(() => {
		const node = mainRef.current;
		if (!node) return;

		let frame = 0;
		const updateScrolled = () => {
			frame = 0;
			setContentScrolled(node.scrollTop > 8);
		};
		const handleScroll = () => {
			if (frame) return;
			frame = window.requestAnimationFrame(updateScrolled);
		};

		updateScrolled();
		node.addEventListener("scroll", handleScroll, { passive: true });
		return () => {
			node.removeEventListener("scroll", handleScroll);
			if (frame) window.cancelAnimationFrame(frame);
		};
	}, [pathname]);

	// Validate / seed activeCurrency against enabledCurrencies from config.
	// Runs whenever config changes (e.g. after sync pulls new settings from Firebase).
	// - If activeCurrency is already valid → keep it (localStorage value wins)
	// - If activeCurrency is empty or not in the enabled list → seed from config
	useEffect(() => {
		const currencies = config?.enabledCurrencies;
		const fallback = config?.currency;
		if (!currencies?.length && !fallback) return; // still loading

		const primary = currencies?.[0] ?? fallback ?? "PKR";
		const isCurrentValid = currencies
			? currencies.includes(activeCurrency)
			: activeCurrency === fallback;

		if (!activeCurrency || !isCurrentValid) {
			setActiveCurrency(primary);
		}
	}, [config?.enabledCurrencies, config?.currency]);

	// Show a toast whenever a sync error is set so the user is notified
	// regardless of which page they are on.
	useEffect(() => {
		if (syncError) {
			toast.error(syncError, { duration: 8000 });
		}
	}, [syncError]);

	useEffect(() => {
		if (user?.id) {
			scheduleAnalyticsRecompute(user.id);
		}
	}, [user?.id]);

	return (
		<AppLockGuard userId={user?.id ?? ""}>
			<div className="flex h-screen flex-col overflow-hidden bg-background">
				{/* Top header */}
				<header
					className={cn(
						FROSTED_HEADER,
						"pt-safe sticky top-0 z-50 transition-[border-color,box-shadow,background-color] duration-[var(--dur-base)] ease-[var(--ease-ios)] motion-reduce:transition-none",
						contentScrolled ? "shadow-[var(--shadow-nav)]" : "border-transparent shadow-none"
					)}>
					<div className="flex h-14 items-center justify-between px-4">
						<div className="flex min-w-0 items-center gap-2">
							<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground shadow-sm">
								<Image src="/icon-192.png" alt="Mizan Track" width={32} height={32} unoptimized />
							</div>
							<div className="grid min-w-0">
								<span
									aria-hidden={!contentScrolled}
									className={cn(
										"col-start-1 row-start-1 truncate text-sm font-semibold transition-all duration-[var(--dur-base)] ease-[var(--ease-out-expo)] motion-reduce:translate-y-0 motion-reduce:transition-none",
										contentScrolled ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
									)}>
									{pageTitle}
								</span>
								<span
									aria-hidden={contentScrolled}
									className={cn(
										"col-start-1 row-start-1 truncate text-sm font-semibold transition-all duration-[var(--dur-base)] ease-[var(--ease-out-expo)] motion-reduce:translate-y-0 motion-reduce:transition-none",
										contentScrolled ? "-translate-y-1 opacity-0" : "translate-y-0 opacity-100"
									)}>
									Mizan Track
								</span>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<CurrencySelector
								enabledCurrencies={
									config?.enabledCurrencies ?? (config?.currency ? [config.currency] : [])
								}
								activeCurrency={activeCurrency}
								onChange={(code) => {
									void handleCurrencyChange(code);
								}}
							/>
							<SyncStatusBadge />
							<ThemeToggle />
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<Button
										variant="ghost"
										className="relative h-8 w-8 cursor-pointer rounded-full p-0">
										<Avatar className="h-8 w-8">
											<AvatarImage
												src={user?.image ?? ""}
												alt={user?.name ?? ""}
												referrerPolicy="no-referrer"
											/>
											<AvatarFallback>{user?.name?.charAt(0).toUpperCase() ?? "U"}</AvatarFallback>
										</Avatar>
									</Button>
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end" className="w-56">
									<DropdownMenuLabel>
										<div className="flex flex-col space-y-1">
											<p className="text-sm font-medium">{user?.name}</p>
											<p className="text-xs text-muted-foreground">{user?.email}</p>
										</div>
									</DropdownMenuLabel>
									<DropdownMenuSeparator />
									{canLock && (
										<>
											<DropdownMenuItem onSelect={handleLockNow} className="gap-2">
												<Lock className="h-4 w-4" />
												Lock now
											</DropdownMenuItem>
											<DropdownMenuSeparator />
										</>
									)}
									{renderBudgetsMenuItem()}
									{renderSettingsMenuItem()}
									<DropdownMenuSeparator />
									<DropdownMenuItem
										variant="destructive"
										onSelect={handleSignOut}
										className="gap-2">
										<LogOut className="h-4 w-4" />
										Sign out
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</div>
				</header>

				<div className="flex min-h-0 flex-1">
					{/* Sidebar — desktop */}
					<aside className="hidden w-56 shrink-0 overflow-y-auto border-r border-border md:flex md:flex-col">
						<nav className="flex flex-col gap-1 p-3 pt-4">
							{NAV_ITEMS.map(({ href, label, icon: Icon }) => (
								<Link
									key={href}
									href={href}
									className={cn(
										"flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
										pathname === href
											? "bg-primary text-primary-foreground"
											: "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
									)}>
									<Icon className="h-4 w-4 shrink-0" />
									{label}
								</Link>
							))}
						</nav>
						<div className="mt-auto border-t border-border p-3">
							<DropdownMenu>
								<DropdownMenuTrigger asChild>
									<button className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-accent">
										<Avatar className="h-7 w-7">
											<AvatarImage src={user?.image ?? ""} referrerPolicy="no-referrer" />
											<AvatarFallback>{user?.name?.charAt(0).toUpperCase() ?? "U"}</AvatarFallback>
										</Avatar>
										<div className="min-w-0 flex-1 text-left">
											<p className="truncate text-xs font-medium">{user?.name}</p>
											<p className="truncate text-xs text-muted-foreground">{user?.email}</p>
										</div>
										<LogOut className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
									</button>
								</DropdownMenuTrigger>
								<DropdownMenuContent side="top" align="start" className="w-56">
									{canLock && (
										<>
											<DropdownMenuItem onSelect={handleLockNow} className="gap-2">
												<Lock className="h-4 w-4" />
												Lock now
											</DropdownMenuItem>
											<DropdownMenuSeparator />
										</>
									)}
									{renderBudgetsMenuItem()}
									{renderSettingsMenuItem()}
									<DropdownMenuSeparator />
									<DropdownMenuItem
										variant="destructive"
										onSelect={handleSignOut}
										className="gap-2">
										<LogOut className="h-4 w-4" />
										Sign out
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						</div>
					</aside>

					{/* Main content */}
					<main ref={mainRef} className="pb-safe-nav flex-1 overflow-auto md:pb-0">
						{pullToRefresh.indicator}
						<div className="mx-auto max-w-4xl p-4" style={swipeNavigation.style}>
							{isOffline && (
								<div className="mb-3 rounded-2xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-900 dark:text-amber-100">
									You&apos;re offline. Local changes are saved on this device and will sync when
									you&apos;re back online.
								</div>
							)}
							<div key={pathname} className="page-enter">
								<div className="mb-3 md:hidden">
									<h1
										className={cn(
											"mt-1 origin-left text-3xl font-bold tracking-tight transition-all duration-[var(--dur-base)] ease-[var(--ease-out-expo)] motion-reduce:translate-y-0 motion-reduce:scale-100 motion-reduce:transition-none",
											contentScrolled
												? "-translate-y-2 scale-95 opacity-0"
												: "translate-y-0 scale-100 opacity-100"
										)}>
										{pageTitle}
									</h1>
								</div>
								{children}
							</div>
						</div>
					</main>
				</div>

				{/* FAB — floating add transaction */}
				<button
					type="button"
					onClick={handleAddTransaction}
					className={cn(
						FAB,
						"fixed right-4 bottom-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom,0px)+1rem)] z-50 flex h-14 w-14 items-center justify-center transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] hover:scale-105 motion-reduce:transition-none motion-reduce:hover:scale-100 md:right-6 md:bottom-6"
					)}>
					<Plus className="h-6 w-6" />
					<span className="sr-only">Add transaction</span>
				</button>

				{/* Bottom nav — mobile */}
				<BottomNav userImage={user?.image} userName={user?.name} />

				{/* Global transaction drawer — FAB and all pages share this instance */}
				<TransactionDrawer userId={user?.id ?? ""} />
			</div>
		</AppLockGuard>
	);
}
