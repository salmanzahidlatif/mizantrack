"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { CategoryBreakdownChart } from "@/components/charts/CategoryDonutChart";
import { TrendChart } from "@/components/charts/TrendBarChart";
import { BalanceCards } from "@/components/dashboard/BalanceCards";
import {
	clampDashboardMonth,
	getDashboardMonthRange,
	getMonthlyTotals,
	isCurrentDashboardMonth,
	shiftDashboardMonth,
	type DashboardStatsQuery,
} from "@/components/dashboard/monthData";
import { MonthSummary } from "@/components/dashboard/MonthSummary";
import { RecentTransactions } from "@/components/dashboard/RecentTransactions";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import { useDbConfig } from "@/hooks/useDbConfig";
import { useHaptics } from "@/hooks/useHaptics";
import { recomputeAnalyticsNow } from "@/lib/analytics/scheduleRecompute";
import { db } from "@/lib/db/local";
import { DURATION, EASE, PRESS_SCALE, TAPPABLE } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useFilterStore } from "@/store/filter-store";

import type { DashboardStats } from "@/types";
import type { CSSProperties, RefObject } from "react";

interface DashboardPageClientProps {
	userId: string;
}

type DashboardStatsHook = (
	userId: string,
	query?: DashboardStatsQuery
) => DashboardStats | undefined;

const SWIPE_AXIS_LOCK_DISTANCE = 10;
const SWIPE_HORIZONTAL_DOMINANCE = 1.15;
const SWIPE_MIN_DISTANCE = 64;
const SWIPE_MIN_FLICK_DISTANCE = 28;
const SWIPE_MIN_VELOCITY = 0.5;
const SWIPE_MAX_OPACITY_DROP = 0.1;

function usePrefersReducedMotion() {
	const [reducedMotion, setReducedMotion] = useState(false);

	useEffect(() => {
		const query = window.matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => setReducedMotion(query.matches);

		update();
		query.addEventListener("change", update);

		return () => query.removeEventListener("change", update);
	}, []);

	return reducedMotion;
}

function rubberBand(delta: number, width: number) {
	const magnitude = Math.abs(delta);
	const dimension = Math.max(width, 1);
	const resisted = (1 - 1 / ((magnitude * 0.55) / dimension + 1)) * dimension * 0.55;

	return Math.sign(delta) * Math.min(resisted, 72);
}

function shouldCommitSwipe(delta: number, velocity: number) {
	const distance = Math.abs(delta);
	const speed = Math.abs(velocity);

	return (
		distance >= SWIPE_MIN_DISTANCE ||
		(distance >= SWIPE_MIN_FLICK_DISTANCE && speed >= SWIPE_MIN_VELOCITY)
	);
}

function useMonthPanelAnimation(
	ref: RefObject<HTMLDivElement | null>,
	monthKey: string,
	entryDirection: number,
	reducedMotion: boolean
) {
	useLayoutEffect(() => {
		const node = ref.current;
		if (!node || reducedMotion || entryDirection === 0) return;

		let frame = 0;
		node.style.transition = "none";
		node.style.transform = `translate3d(${entryDirection * 24}px, 0, 0)`;
		node.style.opacity = "0.72";

		frame = window.requestAnimationFrame(() => {
			node.style.transition = `transform ${DURATION.base} ${EASE.outExpo}, opacity ${DURATION.base} ${EASE.ios}`;
			node.style.transform = "translate3d(0, 0, 0)";
			node.style.opacity = "1";
		});

		return () => {
			if (frame) window.cancelAnimationFrame(frame);
		};
	}, [entryDirection, monthKey, reducedMotion, ref]);
}

interface MonthSwipeOptions {
	containerRef: RefObject<HTMLDivElement | null>;
	visualRef: RefObject<HTMLDivElement | null>;
	canGoNext: boolean;
	onChangeMonth: (delta: number) => void;
	reducedMotion: boolean;
}

function useMonthSwipe({
	containerRef,
	visualRef,
	canGoNext,
	onChangeMonth,
	reducedMotion,
}: MonthSwipeOptions) {
	const gestureRef = useRef<{
		pointerId: number;
		startX: number;
		startY: number;
		lastX: number;
		lastTime: number;
		velocityX: number;
		axis: "undecided" | "horizontal";
		captured: boolean;
		width: number;
	} | null>(null);
	const visualFrameRef = useRef<number | null>(null);

	const applyVisual = useCallback(
		(offset: number, opacity: number, transition: CSSProperties["transition"] = "none") => {
			if (reducedMotion) return;

			if (visualFrameRef.current !== null) {
				window.cancelAnimationFrame(visualFrameRef.current);
			}

			visualFrameRef.current = window.requestAnimationFrame(() => {
				visualFrameRef.current = null;
				const node = visualRef.current;
				if (!node) return;

				node.style.transition = transition ? String(transition) : "none";
				node.style.transform = `translate3d(${offset.toFixed(2)}px, 0, 0)`;
				node.style.opacity = String(opacity);
			});
		},
		[reducedMotion, visualRef]
	);

	const settleVisual = useCallback(() => {
		applyVisual(
			0,
			1,
			`transform ${DURATION.base} ${EASE.outExpo}, opacity ${DURATION.base} ${EASE.ios}`
		);
	}, [applyVisual]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container || typeof window.PointerEvent === "undefined") return;

		const releasePointer = () => {
			const gesture = gestureRef.current;
			if (!gesture?.captured || !container.hasPointerCapture?.(gesture.pointerId)) return;

			try {
				container.releasePointerCapture(gesture.pointerId);
			} catch {
				// The browser may already have released capture.
			}
		};

		const cancelGesture = () => {
			releasePointer();
			gestureRef.current = null;
			settleVisual();
		};

		const handlePointerDown = (event: PointerEvent) => {
			if (!event.isPrimary || event.pointerType !== "touch" || event.button !== 0) return;

			gestureRef.current = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				lastX: event.clientX,
				lastTime: event.timeStamp,
				velocityX: 0,
				axis: "undecided",
				captured: false,
				width: container.clientWidth || window.innerWidth,
			};
		};

		const handlePointerMove = (event: PointerEvent) => {
			const gesture = gestureRef.current;
			if (event.pointerId !== gesture?.pointerId) return;

			const deltaX = event.clientX - gesture.startX;
			const deltaY = event.clientY - gesture.startY;
			const absX = Math.abs(deltaX);
			const absY = Math.abs(deltaY);

			if (gesture.axis === "undecided") {
				if (absX < SWIPE_AXIS_LOCK_DISTANCE && absY < SWIPE_AXIS_LOCK_DISTANCE) return;

				if (absX > SWIPE_AXIS_LOCK_DISTANCE && absX > absY * SWIPE_HORIZONTAL_DOMINANCE) {
					gesture.axis = "horizontal";
					if (!gesture.captured) {
						try {
							container.setPointerCapture(event.pointerId);
							gesture.captured = true;
						} catch {
							gesture.captured = false;
						}
					}
				} else if (absY >= SWIPE_AXIS_LOCK_DISTANCE) {
					gestureRef.current = null;
					return;
				}
			}

			const elapsed = Math.max(event.timeStamp - gesture.lastTime, 1);
			gesture.velocityX = (event.clientX - gesture.lastX) / elapsed;
			gesture.lastX = event.clientX;
			gesture.lastTime = event.timeStamp;

			const canMove = deltaX > 0 || (deltaX < 0 && canGoNext);
			const offset = canMove ? deltaX : rubberBand(deltaX, gesture.width);
			const opacity = 1 - Math.min(Math.abs(offset) / gesture.width, SWIPE_MAX_OPACITY_DROP);

			applyVisual(offset, opacity);
		};

		const handlePointerUp = (event: PointerEvent) => {
			const gesture = gestureRef.current;
			if (event.pointerId !== gesture?.pointerId) return;

			const deltaX = event.clientX - gesture.startX;
			const deltaY = event.clientY - gesture.startY;
			const horizontal =
				gesture.axis === "horizontal" &&
				Math.abs(deltaX) > Math.abs(deltaY) * SWIPE_HORIZONTAL_DOMINANCE;
			const canMove = deltaX > 0 || (deltaX < 0 && canGoNext);
			const committed = horizontal && canMove && shouldCommitSwipe(deltaX, gesture.velocityX);

			releasePointer();
			gestureRef.current = null;

			if (committed) {
				onChangeMonth(deltaX > 0 ? -1 : 1);
				return;
			}

			settleVisual();
		};

		container.addEventListener("pointerdown", handlePointerDown, { passive: true });
		container.addEventListener("pointermove", handlePointerMove, { passive: true });
		container.addEventListener("pointerup", handlePointerUp, { passive: true });
		container.addEventListener("pointercancel", cancelGesture, { passive: true });

		return () => {
			container.removeEventListener("pointerdown", handlePointerDown);
			container.removeEventListener("pointermove", handlePointerMove);
			container.removeEventListener("pointerup", handlePointerUp);
			container.removeEventListener("pointercancel", cancelGesture);
			releasePointer();
			gestureRef.current = null;
			if (visualFrameRef.current !== null) {
				window.cancelAnimationFrame(visualFrameRef.current);
			}
		};
	}, [applyVisual, canGoNext, containerRef, onChangeMonth, settleVisual, visualRef]);
}

export function DashboardPageClient({ userId }: DashboardPageClientProps) {
	const config = useDbConfig(userId);
	const haptics = useHaptics();
	// activeCurrency from selector; fall back to saved config currency
	const { activeCurrency } = useFilterStore();
	const [selectedMonth, setSelectedMonth] = useState(() => clampDashboardMonth(new Date()));
	const [entryDirection, setEntryDirection] = useState(0);
	const selectedMonthRange = useMemo(() => getDashboardMonthRange(selectedMonth), [selectedMonth]);
	const stats = (useDashboardStats as DashboardStatsHook)(userId, {
		month: selectedMonthRange.key,
		from: selectedMonthRange.from,
		to: selectedMonthRange.to,
		currency: activeCurrency || undefined,
	});
	const dashboardStats = stats?.id === userId ? stats : undefined;
	const currency = activeCurrency !== "" ? activeCurrency : (config?.currency ?? "PKR");
	const reducedMotion = usePrefersReducedMotion();
	const monthSwipeRef = useRef<HTMLDivElement>(null);
	const monthPanelRef = useRef<HTMLDivElement>(null);
	const canGoNext = !isCurrentDashboardMonth(selectedMonth);
	const monthlyTotals = getMonthlyTotals(
		dashboardStats,
		activeCurrency || undefined,
		selectedMonth
	);

	const changeMonth = useCallback(
		(delta: number) => {
			const nextMonth = shiftDashboardMonth(selectedMonth, delta);
			if (nextMonth.getTime() === selectedMonth.getTime()) return;

			setEntryDirection(delta > 0 ? 1 : -1);
			setSelectedMonth(nextMonth);
			haptics.selection();
		},
		[haptics, selectedMonth]
	);

	useMonthPanelAnimation(monthPanelRef, selectedMonthRange.key, entryDirection, reducedMotion);
	useMonthSwipe({
		containerRef: monthSwipeRef,
		visualRef: monthPanelRef,
		canGoNext,
		onChangeMonth: changeMonth,
		reducedMotion,
	});

	useEffect(() => {
		let cancelled = false;

		void db.dashboardStats.get(userId).then((cachedStats) => {
			if (cancelled || cachedStats) return;

			void recomputeAnalyticsNow(userId).catch((error) => {
				console.error("Initial dashboard analytics build failed:", error);
			});
		});

		return () => {
			cancelled = true;
		};
	}, [userId]);

	return (
		<div className="space-y-6">
			<div>
				<h1 className="hidden text-2xl font-bold tracking-tight md:block">Dashboard</h1>
				<p className="text-sm text-muted-foreground">Your financial overview</p>
			</div>

			<section className="space-y-2" aria-labelledby="dashboard-month-heading">
				<div className="flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card/80 p-2 shadow-[var(--shadow-card)]">
					<button
						type="button"
						aria-label="Previous month"
						onClick={() => changeMonth(-1)}
						className={cn(
							"flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40",
							PRESS_SCALE,
							TAPPABLE
						)}>
						<ChevronLeft className="h-5 w-5" />
					</button>
					<div className="min-w-0 text-center">
						<h2 id="dashboard-month-heading" className="text-base font-semibold tracking-tight">
							{selectedMonthRange.label}
						</h2>
						<p className="text-xs text-muted-foreground">Swipe the summary to change months</p>
					</div>
					<button
						type="button"
						aria-label="Next month"
						onClick={() => changeMonth(1)}
						disabled={!canGoNext}
						className={cn(
							"flex h-11 w-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
							PRESS_SCALE,
							TAPPABLE
						)}>
						<ChevronRight className="h-5 w-5" />
					</button>
				</div>
				<p className="sr-only" aria-live="polite">
					Showing dashboard for {selectedMonthRange.label}
				</p>
			</section>

			{/* Account balance cards — horizontal scroll */}
			<section className="space-y-2">
				<h2 className="text-xs font-semibold tracking-widest text-muted-foreground/70 uppercase">
					Accounts
				</h2>
				<BalanceCards userId={userId} stats={dashboardStats} />
			</section>

			<div
				ref={monthSwipeRef}
				data-swipe-navigation-ignore
				aria-label="Swipe dashboard month summary"
				className="touch-pan-y space-y-6"
				style={{ touchAction: "pan-y" }}>
				<div ref={monthPanelRef} className="space-y-6">
					{/* Month summary */}
					<section className="space-y-2">
						<h2 className="text-xs font-semibold tracking-widest text-muted-foreground/70 uppercase">
							Month Summary
						</h2>
						<MonthSummary
							currency={currency}
							stats={dashboardStats}
							selectedMonth={selectedMonth}
						/>
						{monthlyTotals && !monthlyTotals.hasData && (
							<p className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-3 py-2 text-center text-xs text-muted-foreground">
								No income or expenses recorded for {selectedMonthRange.label}.
							</p>
						)}
					</section>

					{/* 6-month trend */}
					<section className="space-y-2">
						<h2 className="text-xs font-semibold tracking-widest text-muted-foreground/70 uppercase">
							Trend
						</h2>
						<TrendChart
							userId={userId}
							months={6}
							stats={dashboardStats}
							selectedMonth={selectedMonth}
							currency={currency}
						/>
					</section>

					<section className="space-y-2">
						<h2 className="text-xs font-semibold tracking-widest text-muted-foreground/70 uppercase">
							Categories
						</h2>
						<CategoryBreakdownChart
							userId={userId}
							stats={dashboardStats}
							selectedMonth={selectedMonth}
							currency={currency}
							isLoading={dashboardStats === undefined}
						/>
					</section>
				</div>
			</div>

			{/* Recent transactions */}
			<section className="space-y-2">
				<h2 className="text-xs font-semibold tracking-widest text-muted-foreground/70 uppercase">
					Activity
				</h2>
				<RecentTransactions stats={dashboardStats} selectedMonth={selectedMonth} />
			</section>
		</div>
	);
}
