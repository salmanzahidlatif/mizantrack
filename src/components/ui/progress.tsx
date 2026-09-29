"use client";

import { Progress as ProgressPrimitive } from "radix-ui";
import * as React from "react";

import { cn } from "@/lib/utils";

function Progress({
	className,
	value,
	...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
	return (
		<ProgressPrimitive.Root
			data-slot="progress"
			className={cn(
				"relative flex h-2 w-full items-center overflow-hidden rounded-full bg-muted shadow-inner",
				className
			)}
			{...props}>
			<ProgressPrimitive.Indicator
				data-slot="progress-indicator"
				className="size-full flex-1 rounded-full bg-primary transition-transform duration-[var(--dur-slow)] ease-[var(--ease-out-expo)]"
				style={{ transform: `translateX(-${100 - (value ?? 0)}%)` }}
			/>
		</ProgressPrimitive.Root>
	);
}

export { Progress };
