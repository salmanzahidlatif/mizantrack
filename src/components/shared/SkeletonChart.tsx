interface SkeletonChartProps {
	height?: number;
}

export function SkeletonChart({ height = 160 }: SkeletonChartProps) {
	return (
		<div className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
			<div className="mb-4 h-4 w-32 animate-pulse rounded bg-muted" />
			<div
				className="w-full animate-pulse rounded bg-muted"
				style={{ height: `${height}px` }}
			/>
		</div>
	);
}
