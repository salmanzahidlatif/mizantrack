interface SkeletonBalanceProps {
	count?: number;
}

export function SkeletonBalance({ count = 1 }: SkeletonBalanceProps) {
	return (
		<>
			{Array.from({ length: count }).map((_, i) => (
				<div
					key={i}
					className="flex min-w-[160px] flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]"
				>
					<div className="h-4 w-24 animate-pulse rounded bg-muted" />
					<div className="h-3 w-12 animate-pulse rounded bg-muted" />
					<div className="h-6 w-28 animate-pulse rounded bg-muted" />
				</div>
			))}
		</>
	);
}
