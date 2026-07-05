interface SkeletonTransactionRowProps {
	count?: number;
}

export function SkeletonTransactionRow({ count = 5 }: SkeletonTransactionRowProps) {
	return (
		<>
			{Array.from({ length: count }).map((_, i) => (
				<div key={i} className="flex items-center gap-3 px-4 py-3">
					<div className="h-9 w-9 flex-shrink-0 animate-pulse rounded-full bg-muted" />
					<div className="flex-1 space-y-1.5">
						<div className="h-4 w-32 animate-pulse rounded bg-muted" />
						<div className="h-3 w-20 animate-pulse rounded bg-muted" />
					</div>
					<div className="h-5 w-16 animate-pulse rounded bg-muted" />
				</div>
			))}
		</>
	);
}
