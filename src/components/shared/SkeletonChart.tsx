import { CARD_SURFACE } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface SkeletonChartProps {
	height?: number;
	className?: string;
	chartClassName?: string;
}

export function SkeletonChart({ height = 160, className, chartClassName }: SkeletonChartProps) {
	return (
		<div aria-hidden="true" className={cn(CARD_SURFACE, "w-full overflow-hidden p-4", className)}>
			<div className="shimmer mb-4 h-4 w-32 rounded-full bg-muted/70" />
			<div
				className={cn("shimmer w-full rounded-2xl bg-muted/70", chartClassName)}
				style={chartClassName ? undefined : { height: `${height}px` }}
			/>
		</div>
	);
}
