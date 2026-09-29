"use client";

import { LayoutDashboard, ArrowLeftRight, Wallet, Tag, BarChart3, Moon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { useHaptics } from "@/hooks/useHaptics";
import { cn } from "@/lib/utils";

import type { CSSProperties } from "react";

const BOTTOM_NAV_ITEMS = [
	{ href: "/dashboard", label: "Home" },
	{ href: "/transactions", label: "Txns" },
	{ href: "/accounts", label: "Accounts" },
	{ href: "/categories", label: "Categories" },
	{ href: "/reports", label: "Reports" },
	{ href: "/zakat", label: "Zakat" },
] as const;

const BOTTOM_NAV_ICONS = {
	"/dashboard": LayoutDashboard,
	"/transactions": ArrowLeftRight,
	"/accounts": Wallet,
	"/categories": Tag,
	"/reports": BarChart3,
	"/zakat": Moon,
} as const;

export const BOTTOM_NAV_ROUTES = BOTTOM_NAV_ITEMS.map(({ href, label }) => ({ href, label }));

interface BottomNavProps {
	userImage?: string | null;
	userName?: string | null;
}

export function BottomNav({ userImage: _userImage, userName: _userName }: BottomNavProps) {
	const pathname = usePathname();
	const haptics = useHaptics();

	const activeIndex = BOTTOM_NAV_ITEMS.findIndex(
		({ href }) => pathname === href || pathname.startsWith(`${href}/`)
	);
	const indicatorStyle = {
		transform:
			activeIndex >= 0 ? `translate3d(${activeIndex * 100}%, 0, 0)` : "translate3d(0, 0, 0)",
	} as CSSProperties;

	return (
		<nav className="liquid-glass-nav pb-safe px-safe fixed right-0 bottom-0 left-0 z-50 shadow-[var(--shadow-nav)] md:hidden">
			<div className="relative z-10 grid h-[var(--bottom-nav-height)] grid-cols-6 p-1.5">
				<div
					aria-hidden="true"
					style={indicatorStyle}
					className={cn(
						"liquid-glass-pill absolute top-1.5 bottom-1.5 left-1.5 w-[calc((100%_-_0.75rem)/6)] rounded-[1.25rem] transition-[transform,opacity] duration-[var(--dur-slow)] ease-[var(--ease-spring)] motion-reduce:transition-none",
						activeIndex >= 0 ? "opacity-100" : "opacity-0"
					)}
				/>
				{BOTTOM_NAV_ITEMS.map(({ href, label }, index) => {
					const Icon = BOTTOM_NAV_ICONS[href];
					const active = pathname === href || pathname.startsWith(`${href}/`);
					const transitionType =
						activeIndex >= 0 && index < activeIndex ? "nav-back" : "nav-forward";
					return (
						<Link
							key={href}
							href={href}
							transitionTypes={[transitionType]}
							aria-current={active ? "page" : undefined}
							onClick={() => {
								if (!active) haptics.selection();
							}}
							className={cn(
								"press-scale tappable relative z-10 flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-[1.25rem] px-1 text-[10px] font-semibold transition-[color,transform,text-shadow] duration-[var(--dur-base)] ease-[var(--ease-ios)] motion-reduce:transition-none",
								active ? "text-primary" : "text-muted-foreground hover:text-foreground"
							)}>
							<div
								className={cn(
									"mb-0.5 flex h-7 w-7 items-center justify-center rounded-full transition-[transform,filter] duration-[var(--dur-base)] ease-[var(--ease-spring)] motion-reduce:transition-none",
									active ? "liquid-glass-active-icon scale-110" : "scale-100"
								)}>
								<Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
							</div>
							<span
								className={cn(
									"max-w-full truncate transition-transform duration-[var(--dur-base)] ease-[var(--ease-spring)] motion-reduce:transition-none",
									active ? "scale-105" : "scale-100"
								)}>
								{label}
							</span>
						</Link>
					);
				})}
			</div>
		</nav>
	);
}
