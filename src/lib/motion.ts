import type React from "react";

/** Cubic-bezier easing tokens matching globals.css variables. */
export const EASE = {
	spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
	outExpo: "cubic-bezier(0.16, 1, 0.3, 1)",
	ios: "cubic-bezier(0.25, 0.1, 0.25, 1)",
} as const;

/** Duration tokens matching globals.css variables. */
export const DURATION = {
	fast: "150ms",
	base: "250ms",
	slow: "400ms",
} as const;

/** Press feedback utility class for native-feeling scale down. */
export const PRESS_SCALE = "press-scale" as const;

/** Tap optimization utility class for interactive controls. */
export const TAPPABLE = "tappable" as const;

/** Stagger-ready list row entrance animation class. */
export const LIST_ROW = "list-item-in" as const;

/** Bottom sheet surface classes using the shared sheet shadow. */
export const SHEET_SURFACE =
	"slide-up-sheet rounded-t-3xl border border-border/60 bg-popover shadow-[var(--shadow-sheet)]" as const;

/** Card surface classes using the shared card shadow. */
export const CARD_SURFACE =
	"rounded-2xl border border-border/60 bg-card shadow-[var(--shadow-card)]" as const;

/** Frosted sticky header classes using the blur material. */
export const FROSTED_HEADER = "material-blur border-b border-border/60" as const;

/** Floating action button classes using native press and elevation. */
export const FAB =
	"press-scale tappable rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-fab)]" as const;

/** Returns capped animation delay style for staggered lists. */
export function staggerDelay(index: number, step = 45): React.CSSProperties {
	const safeIndex = Math.max(0, Math.floor(index));
	const safeStep = Number.isFinite(step) ? Math.max(0, step) : 45;
	const delay = Math.min(safeIndex * safeStep, 600);

	return { animationDelay: `${delay}ms` };
}
