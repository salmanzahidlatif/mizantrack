import { SkeletonCard } from "@/components/shared/SkeletonCard";
import { SkeletonChart } from "@/components/shared/SkeletonChart";
import { SkeletonTransactionRow } from "@/components/shared/SkeletonTransactionRow";
import { CARD_SURFACE } from "@/lib/motion";
import { cn } from "@/lib/utils";

import type { ReactNode } from "react";

function RouteLoadingFrame({
	title,
	children,
	testId,
}: {
	title: string;
	children: ReactNode;
	testId: string;
}) {
	return (
		<div className="space-y-4" aria-busy="true" data-testid={testId}>
			<p className="sr-only" role="status">
				Loading {title}
			</p>
			<div>
				<h1 className="hidden text-2xl font-bold md:block">{title}</h1>
				<div
					aria-hidden="true"
					className="shimmer mt-2 h-4 w-36 rounded-full bg-muted/70"
					data-testid={`${testId}-subtitle`}
				/>
			</div>
			{children}
		</div>
	);
}

function PillStripSkeleton({ count = 5 }: { count?: number }) {
	return (
		<div aria-hidden="true" className={cn(CARD_SURFACE, "flex items-center gap-1 p-2")}>
			<div className="shimmer h-10 w-9 rounded-full bg-muted/70" />
			<div className="flex min-w-0 flex-1 gap-1">
				{Array.from({ length: count }).map((_, index) => (
					<div key={index} className="shimmer h-10 flex-1 rounded-2xl bg-muted/70" />
				))}
			</div>
			<div className="shimmer h-10 w-9 rounded-full bg-muted/70" />
			<div className="shimmer h-10 w-10 rounded-full bg-muted/70" />
		</div>
	);
}

function AccountTileGridSkeleton() {
	return (
		<div className={cn(CARD_SURFACE, "overflow-hidden p-4")} data-testid="account-tile-skeleton">
			<div className="mb-4 flex items-start justify-between gap-3">
				<div className="space-y-2">
					<div aria-hidden="true" className="shimmer h-4 w-28 rounded-full bg-muted/70" />
					<div aria-hidden="true" className="shimmer h-9 w-44 rounded-full bg-muted/70" />
				</div>
				<div aria-hidden="true" className="shimmer h-5 w-5 rounded-full bg-muted/70" />
			</div>
			<div className="grid grid-cols-2 gap-2">
				{Array.from({ length: 5 }).map((_, index) => (
					<div
						key={index}
						aria-hidden="true"
						className="min-h-[72px] rounded-2xl border border-border/60 bg-muted/35 p-3">
						<div className="shimmer h-3 w-20 rounded-full bg-muted/70" />
						<div className="shimmer mt-2 h-5 w-24 rounded-full bg-muted/70" />
					</div>
				))}
				<div
					aria-hidden="true"
					className="min-h-[72px] rounded-2xl border border-dashed border-border/80 bg-muted/20 p-3"
				/>
			</div>
		</div>
	);
}

export function DashboardLoadingSkeleton() {
	return (
		<RouteLoadingFrame title="Dashboard" testId="dashboard-route-loading">
			<PillStripSkeleton />
			<AccountTileGridSkeleton />
			<SkeletonCard className="h-28" />
			<SkeletonChart height={280} />
		</RouteLoadingFrame>
	);
}

export function TransactionsLoadingSkeleton() {
	return (
		<RouteLoadingFrame title="Transactions" testId="transactions-route-loading">
			<PillStripSkeleton count={4} />
			<SkeletonCard className="h-16" />
			<div className={cn(CARD_SURFACE, "overflow-hidden")} data-testid="transaction-list-skeleton">
				<SkeletonTransactionRow count={6} />
			</div>
		</RouteLoadingFrame>
	);
}

export function AccountsLoadingSkeleton() {
	return (
		<RouteLoadingFrame title="Accounts" testId="accounts-route-loading">
			<div className="flex justify-end gap-2">
				<div aria-hidden="true" className="shimmer h-8 w-36 rounded-lg bg-muted/70" />
				<div aria-hidden="true" className="shimmer h-8 w-20 rounded-lg bg-muted/70" />
			</div>
			<SkeletonCard className="min-h-[188px]" rows={3} />
			<div className="space-y-2" data-testid="account-list-skeleton">
				{Array.from({ length: 5 }).map((_, index) => (
					<SkeletonCard key={index} className="min-h-20" />
				))}
			</div>
		</RouteLoadingFrame>
	);
}

export function CategoriesLoadingSkeleton() {
	return (
		<RouteLoadingFrame title="Categories" testId="categories-route-loading">
			<div aria-hidden="true" className={cn(CARD_SURFACE, "grid grid-cols-2 gap-1 p-1")}>
				<div className="shimmer h-10 rounded-xl bg-muted/70" />
				<div className="shimmer h-10 rounded-xl bg-muted/70" />
			</div>
			<div className="space-y-2" data-testid="category-tree-skeleton">
				{Array.from({ length: 4 }).map((_, index) => (
					<SkeletonCard key={index} className="h-12" />
				))}
			</div>
		</RouteLoadingFrame>
	);
}

export function ReportsLoadingSkeleton() {
	return (
		<RouteLoadingFrame title="Reports" testId="reports-route-loading">
			<PillStripSkeleton count={1} />
			<SkeletonCard className="h-72" />
			<SkeletonChart height={280} />
			<SkeletonCard className="h-52" />
		</RouteLoadingFrame>
	);
}

export function ZakatLoadingSkeleton() {
	return (
		<RouteLoadingFrame title="Zakat" testId="zakat-route-loading">
			<SkeletonCard className="min-h-40" rows={3} />
			<SkeletonCard className="min-h-32" rows={2} />
			<SkeletonCard className="min-h-32" rows={2} />
		</RouteLoadingFrame>
	);
}

export function SettingsLoadingSkeleton() {
	return (
		<RouteLoadingFrame title="Settings" testId="settings-route-loading">
			<SkeletonCard className="min-h-28" rows={2} />
			<SkeletonCard className="min-h-32" rows={3} />
			<SkeletonCard className="min-h-28" rows={2} />
		</RouteLoadingFrame>
	);
}
