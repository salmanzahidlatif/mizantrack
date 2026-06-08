"use client";

import {
	LayoutDashboard,
	ArrowLeftRight,
	Wallet,
	Tag,
	BarChart3,
	Settings,
	LogOut,
	Moon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { BottomNav } from "@/components/layout/BottomNav";
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
import { signOutAction } from "@/lib/actions/auth";
import { seedDefaultCategories } from "@/lib/db/seed";
import { cn } from "@/lib/utils";
import { useSyncStore } from "@/store/sync-store";
import { toast } from "sonner";

import type { Session } from "next-auth";

const NAV_ITEMS = [
	{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
	{ href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
	{ href: "/accounts", label: "Accounts", icon: Wallet },
	{ href: "/categories", label: "Categories", icon: Tag },
	{ href: "/reports", label: "Reports", icon: BarChart3 },
	{ href: "/zakat", label: "Zakat", icon: Moon },
	{ href: "/settings", label: "Settings", icon: Settings },
];

interface AppShellProps {
	user: Session["user"];
	children: React.ReactNode;
}

export function AppShell({ user, children }: AppShellProps) {
	const pathname = usePathname();
	const syncError = useSyncStore((s) => s.error);

	useAutoSync(user?.id ?? "");

	// Show a toast whenever a sync error is set so the user is notified
	// regardless of which page they are on.
	useEffect(() => {
		if (syncError) {
			toast.error(syncError, { duration: 8000 });
		}
	}, [syncError]);

	useEffect(() => {
		if (user?.id) {
			void seedDefaultCategories(user.id);
		}
	}, [user?.id]);

	return (
		<div className="flex h-screen flex-col overflow-hidden bg-background">
			{/* Top header */}
			<header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
				<div className="flex h-14 items-center justify-between px-4">
					<div className="flex items-center gap-2">
						<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
							<Image src="/icon-192.png" alt="Mizan Track" width={28} height={28} unoptimized />
						</div>
						<span className="text-sm font-semibold">Mizan Track</span>
					</div>
					<div className="flex items-center gap-2">
						<SyncStatusBadge />
						<ThemeToggle />
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									variant="ghost"
									className="relative h-8 w-8 cursor-pointer rounded-full p-0">
									<Avatar className="h-8 w-8">
										<AvatarImage src={user?.image ?? ""} alt={user?.name ?? ""} />
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
								<DropdownMenuItem asChild>
									<form action={signOutAction}>
										<button
											type="submit"
											className="flex w-full items-center gap-2 text-destructive">
											<LogOut className="h-4 w-4" />
											Sign out
										</button>
									</form>
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
										<AvatarImage src={user?.image ?? ""} />
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
								<DropdownMenuItem asChild>
									<form action={signOutAction}>
										<button
											type="submit"
											className="flex w-full items-center gap-2 text-destructive">
											<LogOut className="h-4 w-4" />
											Sign out
										</button>
									</form>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</aside>

				{/* Main content */}
				<main className="flex-1 overflow-auto pb-20 md:pb-0">
					<div className="mx-auto max-w-4xl p-4">{children}</div>
				</main>
			</div>

			{/* Bottom nav + FAB — mobile */}
			<BottomNav />

			{/* Global transaction drawer — FAB and all pages share this instance */}
			<TransactionDrawer userId={user?.id ?? ""} />
		</div>
	);
}
