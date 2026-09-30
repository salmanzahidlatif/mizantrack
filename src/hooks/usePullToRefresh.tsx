"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useHaptics } from "@/hooks/useHaptics";
import { cn } from "@/lib/utils";

import type { RefObject, ReactNode } from "react";

type PullPhase = "idle" | "pulling" | "armed" | "refreshing";
type Axis = "undecided" | "vertical";

interface PullGestureState {
	pointerId: number;
	startX: number;
	startY: number;
	axis: Axis;
	captured: boolean;
	armedNotified: boolean;
}

export interface UsePullToRefreshOptions {
	containerRef: RefObject<HTMLElement | null>;
	enabled?: boolean;
	onRefresh: () => Promise<void>;
}

export interface UsePullToRefreshResult {
	indicator: ReactNode;
	isRefreshing: boolean;
}

const START_TOLERANCE_PX = 2;
const AXIS_LOCK_DISTANCE = 10;
const VERTICAL_DOMINANCE = 1.15;
const ARM_DISTANCE = 72;
const MAX_VISUAL_OFFSET = 104;

function isElement(target: EventTarget | null): target is Element {
	return target instanceof Element;
}

function isEditableElement(element: Element) {
	return element.matches(
		'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="slider"]'
	);
}

function isHorizontallyScrollable(element: Element) {
	const styles = window.getComputedStyle(element);
	const overflowX = styles.overflowX;
	if (overflowX !== "auto" && overflowX !== "scroll" && overflowX !== "overlay") return false;

	return element.scrollWidth > element.clientWidth + 2;
}

export function shouldIgnorePullToRefreshTarget(target: EventTarget | null, boundary: HTMLElement) {
	if (!isElement(target)) return true;

	let element: Element | null = target;
	while (element && boundary.contains(element)) {
		if (
			isEditableElement(element) ||
			element.matches(
				'[data-vaul-drawer], [role="dialog"], .recharts-wrapper, [class*="recharts"], [data-swipe-navigation-ignore]'
			) ||
			isHorizontallyScrollable(element)
		) {
			return true;
		}

		element = element.parentElement;
	}

	return false;
}

function rubberBand(distance: number) {
	return Math.min(MAX_VISUAL_OFFSET, ARM_DISTANCE * (1 - 1 / (distance / ARM_DISTANCE + 1)));
}

export function usePullToRefresh({
	containerRef,
	enabled = true,
	onRefresh,
}: UsePullToRefreshOptions): UsePullToRefreshResult {
	const haptics = useHaptics();
	const onRefreshRef = useRef(onRefresh);
	const gestureRef = useRef<PullGestureState | null>(null);
	const phaseRef = useRef<PullPhase>("idle");
	const [phase, setPhase] = useState<PullPhase>("idle");
	const [offset, setOffset] = useState(0);

	useEffect(() => {
		onRefreshRef.current = onRefresh;
	}, [onRefresh]);

	const setPullPhase = useCallback((nextPhase: PullPhase) => {
		phaseRef.current = nextPhase;
		setPhase(nextPhase);
	}, []);

	const reset = useCallback(() => {
		gestureRef.current = null;
		setOffset(0);
		setPullPhase("idle");
	}, [setPullPhase]);

	useEffect(() => {
		phaseRef.current = phase;
	}, [phase]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container || !enabled || typeof window.PointerEvent === "undefined") return;

		const releasePointer = (gesture: PullGestureState | null) => {
			if (!gesture?.captured || !container.hasPointerCapture?.(gesture.pointerId)) return;

			try {
				container.releasePointerCapture(gesture.pointerId);
			} catch {
				// Pointer capture can already be released by browser cancellation.
			}
		};

		const cancelGesture = () => {
			releasePointer(gestureRef.current);
			reset();
		};

		const handlePointerDown = (event: PointerEvent) => {
			if (
				!event.isPrimary ||
				event.pointerType !== "touch" ||
				event.button !== 0 ||
				phaseRef.current === "refreshing" ||
				container.scrollTop > START_TOLERANCE_PX ||
				shouldIgnorePullToRefreshTarget(event.target, container)
			) {
				return;
			}

			gestureRef.current = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				axis: "undecided",
				captured: false,
				armedNotified: false,
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
				if (absX < AXIS_LOCK_DISTANCE && absY < AXIS_LOCK_DISTANCE) return;
				if (deltaY <= 0 || absY < absX * VERTICAL_DOMINANCE) {
					gestureRef.current = null;
					return;
				}

				gesture.axis = "vertical";
				try {
					container.setPointerCapture(event.pointerId);
					gesture.captured = true;
				} catch {
					gesture.captured = false;
				}
			}

			if (container.scrollTop > START_TOLERANCE_PX) {
				cancelGesture();
				return;
			}

			event.preventDefault();
			const visualOffset = rubberBand(deltaY);
			const armed = deltaY >= ARM_DISTANCE;
			setOffset(visualOffset);
			setPullPhase(armed ? "armed" : "pulling");

			if (armed && !gesture.armedNotified) {
				gesture.armedNotified = true;
				haptics.selection();
			}
		};

		const handlePointerUp = (event: PointerEvent) => {
			const gesture = gestureRef.current;
			if (event.pointerId !== gesture?.pointerId) return;

			const shouldRefresh = phaseRef.current === "armed";
			releasePointer(gesture);
			gestureRef.current = null;

			if (!shouldRefresh) {
				reset();
				return;
			}

			setPullPhase("refreshing");
			setOffset(ARM_DISTANCE);
			haptics.medium();
			void onRefreshRef
				.current()
				.then(() => {
					haptics.success();
				})
				.catch((error) => {
					haptics.error();
					console.error("Pull-to-refresh analytics rebuild failed:", error);
				})
				.finally(reset);
		};

		container.addEventListener("pointerdown", handlePointerDown, { passive: true });
		container.addEventListener("pointermove", handlePointerMove, { passive: false });
		container.addEventListener("pointerup", handlePointerUp, { passive: true });
		container.addEventListener("pointercancel", cancelGesture, { passive: true });

		return () => {
			container.removeEventListener("pointerdown", handlePointerDown);
			container.removeEventListener("pointermove", handlePointerMove);
			container.removeEventListener("pointerup", handlePointerUp);
			container.removeEventListener("pointercancel", cancelGesture);
			releasePointer(gestureRef.current);
			gestureRef.current = null;
		};
	}, [containerRef, enabled, haptics, reset, setPullPhase]);

	const indicator = useMemo(() => {
		if (phase === "idle") return null;

		const label =
			phase === "refreshing"
				? "Updating analytics…"
				: phase === "armed"
					? "Release to refresh"
					: "Pull to refresh";

		return (
			<div
				data-swipe-navigation-ignore
				className="pointer-events-none fixed top-[calc(env(safe-area-inset-top,0px)+0.75rem)] left-1/2 z-[60] -translate-x-1/2 transition-transform duration-200 ease-out"
				style={{ transform: `translate3d(-50%, ${offset.toFixed(1)}px, 0)` }}
				role="status"
				aria-live="polite">
				<div
					className={cn(
						"rounded-full border border-border/70 bg-popover/95 px-3 py-1.5 text-xs font-semibold text-muted-foreground shadow-[var(--shadow-card)] backdrop-blur",
						phase === "refreshing" && "text-foreground"
					)}>
					{label}
				</div>
			</div>
		);
	}, [offset, phase]);

	return {
		indicator,
		isRefreshing: phase === "refreshing",
	};
}
