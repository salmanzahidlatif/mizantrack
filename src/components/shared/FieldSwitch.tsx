"use client";

import { cn } from "@/lib/utils";

interface FieldSwitchProps {
	id: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	/** Names the control for assistive tech when no visible <label> points at it. */
	label?: string;
	disabled?: boolean;
}

/**
 * A plain on/off switch. The Radix switch in `ui/switch` measures its thumb with a
 * ResizeObserver, which makes any component containing one unrenderable in the app's
 * jsdom test environment — so controls that need to stay testable use this instead.
 */
export function FieldSwitch({
	id,
	checked,
	onCheckedChange,
	label,
	disabled = false,
}: FieldSwitchProps) {
	return (
		<button
			type="button"
			id={id}
			role="switch"
			aria-checked={checked}
			aria-label={label}
			disabled={disabled}
			onClick={() => onCheckedChange(!checked)}
			className={cn(
				"inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
				checked ? "bg-primary" : "bg-input"
			)}>
			<span
				aria-hidden="true"
				className={cn(
					"pointer-events-none block h-5 w-5 rounded-full bg-background shadow-sm ring-0 transition-transform",
					checked ? "translate-x-5" : "translate-x-0"
				)}
			/>
		</button>
	);
}
