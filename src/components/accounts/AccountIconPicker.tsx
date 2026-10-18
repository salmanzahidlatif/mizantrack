"use client";

import { Check, Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { AccountIcon, getAccountIconDefinition } from "@/components/icons/AccountIcon";
import { ACCOUNT_ICON_GROUPS, ACCOUNT_ICON_OPTIONS } from "@/components/icons/accountIconRegistry";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useHaptics } from "@/hooks/useHaptics";
import { PRESS_SCALE, TAPPABLE } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type { AccountIconOption } from "@/components/icons/accountIconRegistry";

interface AccountIconPickerProps {
	/** Explicit icon stored on the account; undefined means automatic. */
	value: string | undefined;
	onChange: (value: string | undefined) => void;
	/** What inference would choose, previewed on the Automatic tile. */
	automaticIcon: string;
	id?: string;
}

const AUTOMATIC_KEYWORDS = ["automatic", "auto", "default", "suggested"];

function matchesQuery(option: AccountIconOption, query: string): boolean {
	if (!query) return true;
	return [option.label, option.key, ...(option.keywords ?? [])].some((term) =>
		term.toLowerCase().includes(query)
	);
}

export function AccountIconPicker({ value, onChange, automaticIcon, id }: AccountIconPickerProps) {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const haptics = useHaptics();

	const selected = value?.trim() ? value.trim() : undefined;
	const selectedDefinition = selected ? getAccountIconDefinition(selected) : undefined;
	const triggerLabel = selected
		? (selectedDefinition?.label ?? "Custom icon")
		: `Automatic (${getAccountIconDefinition(automaticIcon)?.label ?? "suggested"})`;

	// The dialog is fully controlled, so reset the search every time it opens.
	useEffect(() => {
		if (open) setQuery("");
	}, [open]);

	const normalizedQuery = query.trim().toLowerCase();
	const visibleOptions = useMemo(
		() => ACCOUNT_ICON_OPTIONS.filter((option) => matchesQuery(option, normalizedQuery)),
		[normalizedQuery]
	);
	const showAutomatic =
		!normalizedQuery || AUTOMATIC_KEYWORDS.some((term) => term.includes(normalizedQuery));

	function choose(next: string | undefined) {
		haptics.selection();
		onChange(next);
		setOpen(false);
	}

	return (
		<>
			<button
				id={id}
				type="button"
				aria-label={`Account icon: ${triggerLabel}`}
				aria-haspopup="dialog"
				onClick={() => setOpen(true)}
				className={cn(
					"flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-background/60 px-3 py-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/35",
					PRESS_SCALE,
					TAPPABLE
				)}>
				<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-muted text-lg leading-none shadow-sm">
					<AccountIcon icon={selected ?? automaticIcon} className="h-6 w-6" />
				</span>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-sm font-medium">{triggerLabel}</span>
					<span className="block truncate text-xs text-muted-foreground">
						{selected ? "Tap to change this icon" : "Chosen from the account name"}
					</span>
				</span>
				<span className="shrink-0 text-xs font-semibold text-primary">Change</span>
			</button>

			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="flex max-h-[85vh] max-w-md flex-col gap-0 p-0">
					<DialogHeader className="px-4 pt-4 text-left">
						<DialogTitle>Account Icon</DialogTitle>
						<DialogDescription>
							Pick a brand or a generic icon, or let MizanTrack choose from the account name.
						</DialogDescription>
					</DialogHeader>

					{/* Search */}
					<div className="relative px-4 py-2">
						<Search className="absolute top-1/2 left-7 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							type="search"
							aria-label="Search icons"
							placeholder="Search banks, wallets or icons…"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							className="pl-9"
						/>
					</div>

					<div className="flex-1 space-y-4 overflow-y-auto px-4 pb-4">
						{showAutomatic && (
							<button
								type="button"
								onClick={() => choose(undefined)}
								aria-pressed={!selected}
								className={cn(
									"flex w-full touch-manipulation items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-colors",
									selected
										? "border-border/70 hover:bg-muted/50"
										: "border-primary bg-primary/10 ring-2 ring-primary/35"
								)}>
								<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted">
									<Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
								</span>
								<span className="min-w-0 flex-1">
									<span className="block text-sm font-medium">Automatic</span>
									<span className="block truncate text-xs text-muted-foreground">
										Match the icon to the account name
									</span>
								</span>
								<AccountIcon icon={automaticIcon} className="h-5 w-5 shrink-0" />
								{!selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
							</button>
						)}

						{ACCOUNT_ICON_GROUPS.map((group) => {
							const groupOptions = visibleOptions.filter((option) => option.group === group.id);
							if (groupOptions.length === 0) return null;

							return (
								<section key={group.id} className="space-y-2">
									<h3 className="text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
										{group.title}
									</h3>
									<div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
										{groupOptions.map((option) => {
											const isSelected = option.key === selected;

											return (
												<button
													key={option.key}
													type="button"
													onClick={() => choose(option.key)}
													aria-pressed={isSelected}
													aria-label={option.label}
													title={option.label}
													className={cn(
														"flex min-h-20 touch-manipulation flex-col items-center gap-1 rounded-2xl border px-1 py-2 text-center transition-colors",
														isSelected
															? "border-primary bg-primary/10 ring-2 ring-primary/35"
															: "border-transparent hover:border-border hover:bg-muted/50",
														PRESS_SCALE,
														TAPPABLE
													)}>
													<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted/70">
														<AccountIcon icon={option.key} className="h-6 w-6" />
													</span>
													<span className="line-clamp-2 text-[10px] leading-[0.875rem] font-medium">
														{option.label}
													</span>
												</button>
											);
										})}
									</div>
								</section>
							);
						})}

						{!showAutomatic && visibleOptions.length === 0 && (
							<p className="py-6 text-center text-sm text-muted-foreground">No icons found.</p>
						)}
					</div>

					<div className="flex justify-end border-t border-border px-4 py-3">
						<Button variant="outline" size="sm" type="button" onClick={() => setOpen(false)}>
							Close
						</Button>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
}
