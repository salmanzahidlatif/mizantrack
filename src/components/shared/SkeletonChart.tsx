import { CARD_SURFACE } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface SkeletonChartProps {
	height?: number;
}

export function SkeletonChart({ height = 160 }: SkeletonChartProps) {
	return (
		<div className={cn(CARD_SURFACE, "overflow-hidden p-4")}>
			<div className="shimmer mb-4 h-4 w-32 rounded-full bg-muted/70" />
			<div className="shimmer w-full rounded-2xl bg-muted/70" style={{ height: `${height}px` }} />
		</div>
	);
}
