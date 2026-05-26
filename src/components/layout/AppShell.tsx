"use client";

import {
	LayoutDashboard,
	ArrowLeftRight,
	Wallet,
	Tag,
	BarChart3,
	Settings,
	LogOut,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { ThemeToggle } from "@/components/layout/ThemeToggle";
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
import { signOutAction } from "@/lib/actions/auth";
import { seedDefaultCategories } from "@/lib/db/seed";
import { cn } from "@/lib/utils";

import type { Session } from "next-auth";

const NAV_ITEMS = [
	{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
	{ href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
	{ href: "/accounts", label: "Accounts", icon: Wallet },
	{ href: "/categories", label: "Categories", icon: Tag },
	{ href: "/reports", label: "Reports", icon: BarChart3 },
	{ href: "/settings", label: "Settings", icon: Settings },
];

interface AppShellProps {
	user: Session["user"];
	children: React.ReactNode;
}

export function AppShell({ user, children }: AppShellProps) {
	const pathname = usePathname();

	useEffect(() => {
		if (user?.id) {
			void seedDefaultCategories(user.id);
		}
	}, [user?.id]);

	return (
		<div className="flex min-h-screen flex-col bg-background">
			{/* Top header */}
			<header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
				<div className="flex h-14 items-center justify-between px-4">
					<div className="flex items-center gap-2">
						<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">
							م
						</div>
						<span className="text-sm font-semibold">MizanTrack</span>
					</div>
					<div className="flex items-center gap-2">
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

			<div className="flex flex-1">
				{/* Sidebar — desktop */}
				<aside className="hidden w-56 shrink-0 border-r border-border md:flex md:flex-col">
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

			{/* Bottom nav — mobile */}
			<nav className="fixed right-0 bottom-0 left-0 z-50 border-t border-border bg-background/95 backdrop-blur-sm md:hidden">
				<div className="flex items-center justify-around px-2 py-2">
					{NAV_ITEMS.slice(0, 5).map(({ href, label, icon: Icon }) => (
						<Link
							key={href}
							href={href}
							className={cn(
								"flex flex-col items-center gap-0.5 rounded-lg px-3 py-1.5 text-xs transition-colors",
								pathname === href ? "text-primary" : "text-muted-foreground"
							)}>
							<Icon className="h-5 w-5" />
							<span>{label}</span>
						</Link>
					))}
				</div>
			</nav>
		</div>
	);
}
