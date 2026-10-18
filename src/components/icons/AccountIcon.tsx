"use client";

import { ACCOUNT_ICON_REGISTRY } from "@/components/icons/accountIconRegistry";
import { DEFAULT_ACCOUNT_ICON, getAccountIcon, isAccountIconKey } from "@/lib/accountIcons";
import { cn } from "@/lib/utils";

import type { AccountIconDefinition } from "@/components/icons/accountIconRegistry";
import type { Account } from "@/types";

export interface AccountIconProps {
	/** Resolve the icon from an account record. */
	account?: Pick<Account, "title" | "icon" | "currency">;
	/** Or render a known key directly. Wins over `account` when both are given. */
	icon?: string;
	className?: string;
}

/** Registry entry for a resolved icon value, or undefined for legacy emoji. */
export function getAccountIconDefinition(icon: string): AccountIconDefinition | undefined {
	const trimmed = icon.trim();
	return isAccountIconKey(trimmed) ? ACCOUNT_ICON_REGISTRY[trimmed] : undefined;
}

export function AccountIcon({ account, icon, className }: AccountIconProps) {
	const resolved = (icon ?? (account ? getAccountIcon(account) : DEFAULT_ACCOUNT_ICON)).trim();
	const definition = getAccountIconDefinition(resolved);

	// Accounts saved before the SVG icons shipped still hold an emoji. We never
	// rewrite stored values, so render whatever is there at the inherited size.
	if (!definition) {
		return (
			<span
				aria-hidden="true"
				className={cn("inline-flex items-center justify-center leading-none", className)}>
				{resolved}
			</span>
		);
	}

	const { Icon } = definition;
	return <Icon className={cn("h-5 w-5", className)} />;
}
