"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { cn } from "@/lib/utils";

interface MeasuredChartContainerProps {
	children: ReactNode | ((size: ChartSize) => ReactNode);
	className?: string;
	labelledBy?: string;
	describedBy?: string;
}

interface ChartSize {
	width: number;
	height: number;
}

function canMeasureCharts() {
	return typeof window !== "undefined" && typeof window.ResizeObserver === "function";
}

export function MeasuredChartContainer({
	children,
	className,
	labelledBy,
	describedBy,
}: MeasuredChartContainerProps) {
	const ref = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState<ChartSize | null>(() =>
		canMeasureCharts() ? null : { width: 1, height: 1 }
	);

	useEffect(() => {
		const node = ref.current;
		if (!node || !canMeasureCharts()) {
			setSize({ width: 1, height: 1 });
			return;
		}

		let frame = 0;
		const updateSize = (width: number, height: number) => {
			const nextSize =
				width > 0 && height > 0 ? { width: Math.round(width), height: Math.round(height) } : null;
			setSize((current) =>
				current?.width === nextSize?.width && current?.height === nextSize?.height
					? current
					: nextSize
			);
		};
		const measure = () => {
			const rect = node.getBoundingClientRect();
			updateSize(rect.width, rect.height);
		};
		const observer = new ResizeObserver((entries) => {
			const entry = entries[0];
			if (!entry) return;

			if (frame) cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => {
				updateSize(entry.contentRect.width, entry.contentRect.height);
			});
		});

		measure();
		observer.observe(node);

		return () => {
			observer.disconnect();
			if (frame) cancelAnimationFrame(frame);
		};
	}, []);

	return (
		<div
			ref={ref}
			className={cn("min-h-0 min-w-0", className)}
			role={labelledBy ? "img" : undefined}
			aria-labelledby={labelledBy}
			aria-describedby={describedBy}>
			{size ? (
				typeof children === "function" ? (
					children(size)
				) : (
					children
				)
			) : (
				<div aria-hidden="true" className="shimmer h-full w-full rounded-2xl bg-muted/70" />
			)}
		</div>
	);
}
