import { cn } from "@/lib/utils";

interface SkeletonTransactionRowProps {
	count?: number;
}

export function SkeletonTransactionRow({ count = 5 }: SkeletonTransactionRowProps) {
	return (
		<>
			{Array.from({ length: count }).map((_, i) => (
				<div
					key={i}
					aria-hidden="true"
					className="flex min-h-[76px] items-center gap-3 px-4 py-3.5">
					<div className="shimmer h-11 w-11 flex-shrink-0 rounded-2xl bg-muted/70" />
					<div className="min-w-0 flex-1 space-y-2">
						<div
							className={cn("shimmer h-4 rounded-full bg-muted/70", i % 2 === 0 ? "w-36" : "w-28")}
						/>
						<div className="shimmer h-3 w-24 rounded-full bg-muted/70" />
					</div>
					<div className="shimmer h-6 w-20 rounded-full bg-muted/70" />
				</div>
			))}
		</>
	);
}
