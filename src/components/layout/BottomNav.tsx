"use client";

import {
	LayoutDashboard,
	ArrowLeftRight,
	Wallet,
	BarChart3,
	Moon,
	Plus,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useUIStore } from "@/store/ui-store";

const BOTTOM_NAV_ITEMS = [
	{ href: "/dashboard", label: "Home", icon: LayoutDashboard },
	{ href: "/transactions", label: "Txns", icon: ArrowLeftRight },
	{ href: "/accounts", label: "Accounts", icon: Wallet },
	{ href: "/reports", label: "Reports", icon: BarChart3 },
	{ href: "/zakat", label: "Zakat", icon: Moon },
];

interface BottomNavProps {
	userImage?: string | null;
	userName?: string | null;
}

export function BottomNav({ userImage, userName }: BottomNavProps) {
	const pathname = usePathname();
	const openAddTransaction = useUIStore((s) => s.openAddTransaction);

	const settingsActive = pathname === "/settings" || pathname.startsWith("/settings");

	return (
		<>
			{/* Bottom nav bar */}
			<nav className="fixed right-0 bottom-0 left-0 z-50 border-t border-border/60 bg-background/85 backdrop-blur-md pb-[env(safe-area-inset-bottom,0px)] md:hidden">
				<div className="flex items-center justify-around px-1 py-1.5">
					{BOTTOM_NAV_ITEMS.map(({ href, label, icon: Icon }) => {
						const active = pathname === href;
						return (
							<Link
								key={href}
								href={href}
								className={cn(
									"flex flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] font-medium transition-all touch-manipulation active:scale-95",
									active ? "text-primary" : "text-muted-foreground hover:text-foreground"
								)}>
								<div className={cn(
									"mb-0.5 flex h-6 w-6 items-center justify-center rounded-full transition-colors",
									active ? "bg-primary/10" : ""
								)}>
									<Icon className="h-5 w-5" />
								</div>
								<span>{label}</span>
							</Link>
						);
					})}

					{/* Settings / Profile avatar */}
					<Link
						href="/settings"
						className={cn(
							"flex flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] font-medium transition-all touch-manipulation active:scale-95",
							settingsActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
						)}>
						<div className={cn(
							"mb-0.5 flex h-6 w-6 items-center justify-center rounded-full transition-colors ring-2",
							settingsActive ? "ring-primary" : "ring-border"
						)}>
							<Avatar className="h-6 w-6">
								<AvatarImage src={userImage ?? ""} referrerPolicy="no-referrer" />
								<AvatarFallback className="text-[9px]">
									{userName?.charAt(0).toUpperCase() ?? "U"}
								</AvatarFallback>
							</Avatar>
						</div>
						<span>Me</span>
					</Link>
				</div>
			</nav>

			{/* FAB — floating add transaction */}
			<button
				type="button"
				onClick={openAddTransaction}
				className="fixed right-4 bottom-20 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary shadow-[var(--shadow-overlay)] transition-all hover:scale-105 active:scale-95 md:bottom-6 touch-manipulation">
				<Plus className="h-6 w-6 text-primary-foreground" />
				<span className="sr-only">Add transaction</span>
			</button>
		</>
	);
}
