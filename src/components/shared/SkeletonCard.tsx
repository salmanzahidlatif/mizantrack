import { cn } from "@/lib/utils";

interface SkeletonCardProps {
	className?: string;
	/** Number of skeleton rows to render. Default: 1 */
	rows?: number;
}

function Skeleton({ className }: { className?: string }) {
	return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

export function SkeletonCard({ className, rows = 1 }: SkeletonCardProps) {
	return (
		<div className={cn("rounded-xl border border-border bg-card p-4", className)}>
			<div className="flex items-start justify-between">
				<div className="flex-1 space-y-2">
					<Skeleton className="h-4 w-1/3" />
					<Skeleton className="h-3 w-1/4" />
				</div>
				<Skeleton className="h-6 w-20" />
			</div>
			{rows > 1 && (
				<div className="mt-4 space-y-2">
					{Array.from({ length: rows - 1 }).map((_, i) => (
						<Skeleton key={i} className="h-3 w-full" />
					))}
				</div>
			)}
		</div>
	);
}
