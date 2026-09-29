import { CARD_SURFACE } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface SkeletonCardProps {
	className?: string;
	/** Number of skeleton rows to render. Default: 1 */
	rows?: number;
}

function Skeleton({ className }: { className?: string }) {
	return <div className={cn("shimmer rounded-full bg-muted/70", className)} />;
}

export function SkeletonCard({ className, rows = 1 }: SkeletonCardProps) {
	return (
		<div aria-hidden="true" className={cn(CARD_SURFACE, "overflow-hidden p-4", className)}>
			<div className="flex items-start justify-between gap-4">
				<div className="min-w-0 flex-1 space-y-2.5">
					<Skeleton className="h-4 w-2/5" />
					<Skeleton className="h-3 w-1/3" />
				</div>
				<Skeleton className="h-7 w-24" />
			</div>
			{rows > 1 && (
				<div className="mt-4 space-y-2.5">
					{Array.from({ length: rows - 1 }).map((_, i) => (
						<Skeleton key={i} className={cn("h-3", i % 2 === 0 ? "w-full" : "w-5/6")} />
					))}
				</div>
			)}
		</div>
	);
}
