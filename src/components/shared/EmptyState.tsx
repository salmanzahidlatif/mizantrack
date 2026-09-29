import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { CARD_SURFACE, PRESS_SCALE, TAPPABLE } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type React from "react";

interface EmptyStateProps {
	title: string;
	description?: string;
	action?: {
		label: string;
		onClick: () => void;
	};
	icon?: React.ReactNode;
	className?: string;
}

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
	return (
		<div
			className={cn(
				CARD_SURFACE,
				"fade-scale-in flex flex-col items-center justify-center gap-4 border-dashed p-8 text-center sm:p-10",
				className
			)}>
			<div className="relative">
				<div className="absolute inset-0 rounded-full bg-primary/15 blur-xl" />
				<div className="relative flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary shadow-[var(--shadow-card)]">
					{icon ?? <Sparkles className="h-6 w-6" />}
				</div>
			</div>
			<div className="max-w-[18rem]">
				<p className="text-base font-semibold tracking-tight text-foreground">{title}</p>
				{description && (
					<p className="mt-1.5 text-sm leading-5 text-muted-foreground">{description}</p>
				)}
			</div>
			{action && (
				<Button
					type="button"
					onClick={action.onClick}
					className={cn("mt-1 min-h-11 rounded-full px-5", PRESS_SCALE, TAPPABLE)}>
					{action.label}
				</Button>
			)}
		</div>
	);
}
