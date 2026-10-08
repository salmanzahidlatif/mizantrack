"use client";

import { BarChart3, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { clearAnalyticsCache } from "@/lib/analytics/cache";
import { recomputeAnalyticsNow } from "@/lib/analytics/scheduleRecompute";

interface RebuildAnalyticsPanelProps {
	userId: string;
}

export function RebuildAnalyticsPanel({ userId }: RebuildAnalyticsPanelProps) {
	const [rebuilding, setRebuilding] = useState(false);

	async function handleRebuild() {
		setRebuilding(true);
		try {
			await clearAnalyticsCache(userId);
			await recomputeAnalyticsNow(userId);
			toast.success("Analytics rebuilt. Balances were recalculated from your saved records.");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed to rebuild analytics.");
		} finally {
			setRebuilding(false);
		}
	}

	return (
		<div className="space-y-3 rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]">
			<div>
				<h2 className="font-semibold">Rebuild Analytics</h2>
				<p className="mt-0.5 text-sm text-muted-foreground">
					Safely recalculates balances and dashboard summaries from your existing accounts and
					transactions. This only rebuilds derived data; it does not edit financial records.
				</p>
			</div>

			<Button
				variant="outline"
				onClick={() => {
					void handleRebuild();
				}}
				disabled={rebuilding}>
				{rebuilding ? (
					<Loader2 className="mr-2 h-4 w-4 animate-spin" />
				) : (
					<BarChart3 className="mr-2 h-4 w-4" />
				)}
				{rebuilding ? "Rebuilding analytics…" : "Recalculate balances"}
			</Button>
		</div>
	);
}
