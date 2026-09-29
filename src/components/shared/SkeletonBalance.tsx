import { CARD_SURFACE } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface SkeletonBalanceProps {
	count?: number;
}

export function SkeletonBalance({ count = 1 }: SkeletonBalanceProps) {
	return (
		<>
			{Array.from({ length: count }).map((_, i) => (
				<div key={i} className={cn(CARD_SURFACE, "flex min-w-44 flex-col gap-3 p-4")}>
					<div className="flex items-center gap-2">
						<div className="shimmer h-8 w-8 rounded-2xl bg-muted/70" />
						<div className="min-w-0 flex-1 space-y-2">
							<div className="shimmer h-4 w-24 rounded-full bg-muted/70" />
							<div className="shimmer h-3 w-14 rounded-full bg-muted/70" />
						</div>
					</div>
					<div className="shimmer h-7 w-32 rounded-full bg-muted/70" />
				</div>
			))}
		</>
	);
}
