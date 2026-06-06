"use client";

import {
	LayoutDashboard,
	ArrowLeftRight,
	Wallet,
	BarChart3,
	Moon,
	Settings,
	Plus,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui-store";

const BOTTOM_NAV_ITEMS = [
	{ href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
	{ href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
	{ href: "/accounts", label: "Accounts", icon: Wallet },
	{ href: "/reports", label: "Reports", icon: BarChart3 },
	{ href: "/zakat", label: "Zakat", icon: Moon },
	{ href: "/settings", label: "Settings", icon: Settings },
];

export function BottomNav() {
	const pathname = usePathname();
	const openAddTransaction = useUIStore((s) => s.openAddTransaction);

	return (
		<>
			{/* Bottom nav bar */}
			<nav className="fixed right-0 bottom-0 left-0 z-50 border-t border-border bg-background/95 backdrop-blur-sm md:hidden">
				<div className="flex items-center justify-around px-2 py-2">
					{BOTTOM_NAV_ITEMS.map(({ href, label, icon: Icon }) => (
						<Link
							key={href}
							href={href}
							className={cn(
								"flex flex-col items-center gap-0.5 rounded-lg px-2 py-1.5 text-xs transition-colors",
								pathname === href ? "text-primary" : "text-muted-foreground"
							)}>
							<Icon className="h-5 w-5" />
							<span>{label}</span>
						</Link>
					))}
				</div>
			</nav>

			{/* FAB — floating add transaction */}
			<button
				type="button"
				onClick={openAddTransaction}
				className="fixed right-4 bottom-20 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary shadow-lg transition-transform hover:scale-105 active:scale-95 md:bottom-6">
				<Plus className="h-6 w-6 text-primary-foreground" />
				<span className="sr-only">Add transaction</span>
			</button>
		</>
	);
}
