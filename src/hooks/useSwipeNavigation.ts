"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useHaptics } from "@/hooks/useHaptics";

import type { CSSProperties, RefObject } from "react";

export type SwipeNavigationRoute = Readonly<{
	href: string;
	label: string;
}>;

type Axis = "undecided" | "horizontal";

type VisualState = Readonly<{
	phase: "idle" | "dragging" | "settling";
	offset: number;
	opacity: number;
}>;

type GestureState = {
	pointerId: number;
	startX: number;
	startY: number;
	lastX: number;
	lastTime: number;
	velocityX: number;
	axis: Axis;
	captured: boolean;
	containerWidth: number;
	activeIndex: number;
	edgeBackCandidate: boolean;
};

export type UseSwipeNavigationOptions = Readonly<{
	containerRef: RefObject<HTMLElement | null>;
	pathname: string;
	routes: readonly SwipeNavigationRoute[];
}>;

export type UseSwipeNavigationResult = Readonly<{
	activeIndex: number;
	isDragging: boolean;
	style: CSSProperties;
}>;

const AXIS_LOCK_DISTANCE = 10;
const HORIZONTAL_DOMINANCE = 1.18;
const MIN_DISTANCE = 72;
const MIN_FLICK_DISTANCE = 28;
const MIN_VELOCITY = 0.55;
const EDGE_BACK_WIDTH = 28;
const SETTLE_DURATION = 420;
const MAX_OPACITY_DROP = 0.08;
const MD_BREAKPOINT = 768;

const IDLE_VISUAL_STATE: VisualState = {
	phase: "idle",
	offset: 0,
	opacity: 1,
};

function getRouteIndex(pathname: string, routes: readonly SwipeNavigationRoute[]) {
	return routes.findIndex(({ href }) => pathname === href || pathname.startsWith(`${href}/`));
}

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

function shouldIgnoreGesture(target: EventTarget | null, boundary: HTMLElement) {
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

function rubberBand(delta: number, width: number) {
	const magnitude = Math.abs(delta);
	const dimension = Math.max(width, 1);
	const resisted = (1 - 1 / ((magnitude * 0.55) / dimension + 1)) * dimension * 0.55;

	return Math.sign(delta) * Math.min(resisted, 72);
}

function shouldCommit(delta: number, velocity: number) {
	const distance = Math.abs(delta);
	const speed = Math.abs(velocity);

	return distance >= MIN_DISTANCE || (distance >= MIN_FLICK_DISTANCE && speed >= MIN_VELOCITY);
}

function canUseHistoryBack() {
	const navigation = (window as Window & { navigation?: { canGoBack?: boolean } }).navigation;
	if (typeof navigation?.canGoBack === "boolean") return navigation.canGoBack;

	return window.history.length > 1;
}

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

export function useSwipeNavigation({
	containerRef,
	pathname,
	routes,
}: UseSwipeNavigationOptions): UseSwipeNavigationResult {
	const router = useRouter();
	const haptics = useHaptics();
	const reducedMotion = usePrefersReducedMotion();
	const activeIndex = getRouteIndex(pathname, routes);
	const activeIndexRef = useRef(activeIndex);
	const gestureRef = useRef<GestureState | null>(null);
	const routesRef = useRef(routes);
	const visualFrameRef = useRef<number | null>(null);
	const pendingVisualRef = useRef<VisualState | null>(null);
	const settleTimerRef = useRef<number | null>(null);
	const [visual, setVisual] = useState<VisualState>(IDLE_VISUAL_STATE);

	useEffect(() => {
		activeIndexRef.current = activeIndex;
		routesRef.current = routes;
	}, [activeIndex, routes]);

	useEffect(() => {
		const currentRoutes = routesRef.current;
		const currentIndex = activeIndexRef.current;
		if (currentIndex < 0) return;

		const previousRoute = currentRoutes[currentIndex - 1];
		const nextRoute = currentRoutes[currentIndex + 1];
		if (previousRoute) router.prefetch(previousRoute.href);
		if (nextRoute) router.prefetch(nextRoute.href);
	}, [pathname, router]);

	const clearSettleTimer = useCallback(() => {
		if (settleTimerRef.current === null) return;

		window.clearTimeout(settleTimerRef.current);
		settleTimerRef.current = null;
	}, []);

	const queueVisual = useCallback(
		(nextVisual: VisualState) => {
			if (reducedMotion) return;

			pendingVisualRef.current = nextVisual;
			if (visualFrameRef.current !== null) return;

			visualFrameRef.current = window.requestAnimationFrame(() => {
				visualFrameRef.current = null;
				if (!pendingVisualRef.current) return;
				setVisual(pendingVisualRef.current);
				pendingVisualRef.current = null;
			});
		},
		[reducedMotion]
	);

	const settleVisual = useCallback(() => {
		if (visualFrameRef.current !== null) {
			window.cancelAnimationFrame(visualFrameRef.current);
			visualFrameRef.current = null;
		}
		pendingVisualRef.current = null;

		if (reducedMotion) {
			setVisual(IDLE_VISUAL_STATE);
			return;
		}

		setVisual({ phase: "settling", offset: 0, opacity: 1 });
		clearSettleTimer();
		settleTimerRef.current = window.setTimeout(() => {
			setVisual(IDLE_VISUAL_STATE);
			settleTimerRef.current = null;
		}, SETTLE_DURATION);
	}, [clearSettleTimer, reducedMotion]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container || typeof window.PointerEvent === "undefined") return;

		const releasePointer = (gesture: GestureState | null) => {
			if (!gesture?.captured || !container.hasPointerCapture?.(gesture.pointerId)) return;

			try {
				container.releasePointerCapture(gesture.pointerId);
			} catch {
				// Pointer capture may already be released by the browser.
			}
		};

		const cancelGesture = () => {
			releasePointer(gestureRef.current);
			gestureRef.current = null;
			settleVisual();
		};

		const handlePointerDown = (event: PointerEvent) => {
			if (
				!event.isPrimary ||
				event.pointerType !== "touch" ||
				event.button !== 0 ||
				window.innerWidth >= MD_BREAKPOINT ||
				shouldIgnoreGesture(event.target, container)
			) {
				return;
			}

			const currentIndex = activeIndexRef.current;
			const edgeBackCandidate = event.clientX <= EDGE_BACK_WIDTH && canUseHistoryBack();
			if (currentIndex < 0 && !edgeBackCandidate) return;

			clearSettleTimer();
			gestureRef.current = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				lastX: event.clientX,
				lastTime: event.timeStamp,
				velocityX: 0,
				axis: "undecided",
				captured: false,
				containerWidth: container.clientWidth || window.innerWidth,
				activeIndex: currentIndex,
				edgeBackCandidate,
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

				if (absX > AXIS_LOCK_DISTANCE && absX > absY * HORIZONTAL_DOMINANCE) {
					gesture.axis = "horizontal";
					if (!gesture.captured) {
						try {
							container.setPointerCapture(event.pointerId);
							gesture.captured = true;
						} catch {
							gesture.captured = false;
						}
					}
				} else if (absY >= AXIS_LOCK_DISTANCE) {
					gestureRef.current = null;
					return;
				}
			}

			const elapsed = Math.max(event.timeStamp - gesture.lastTime, 1);
			gesture.velocityX = (event.clientX - gesture.lastX) / elapsed;
			gesture.lastX = event.clientX;
			gesture.lastTime = event.timeStamp;

			const currentRoutes = routesRef.current;
			const movingRight = deltaX > 0;
			const movingLeft = deltaX < 0;
			const canMoveToTab =
				(movingRight && gesture.activeIndex > 0) ||
				(movingLeft && gesture.activeIndex >= 0 && gesture.activeIndex < currentRoutes.length - 1);
			const canMove = canMoveToTab || (gesture.edgeBackCandidate && movingRight);
			const offset = canMove ? deltaX : rubberBand(deltaX, gesture.containerWidth);
			const opacity = 1 - Math.min(Math.abs(offset) / gesture.containerWidth, MAX_OPACITY_DROP);

			queueVisual({ phase: "dragging", offset, opacity });
		};

		const handlePointerUp = (event: PointerEvent) => {
			const gesture = gestureRef.current;
			if (event.pointerId !== gesture?.pointerId) return;

			const deltaX = event.clientX - gesture.startX;
			const deltaY = event.clientY - gesture.startY;
			const horizontal =
				gesture.axis === "horizontal" && Math.abs(deltaX) > Math.abs(deltaY) * HORIZONTAL_DOMINANCE;
			const committed = horizontal && shouldCommit(deltaX, gesture.velocityX);

			releasePointer(gesture);
			gestureRef.current = null;
			settleVisual();

			if (!committed) return;

			if (gesture.edgeBackCandidate && deltaX > 0) {
				haptics.selection();
				router.back();
				return;
			}

			const direction = deltaX < 0 ? 1 : -1;
			const targetRoute = routesRef.current[gesture.activeIndex + direction];
			if (!targetRoute) return;

			haptics.selection();
			router.push(targetRoute.href, {
				transitionTypes: [direction > 0 ? "nav-forward" : "nav-back"],
			});
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
			releasePointer(gestureRef.current);
			gestureRef.current = null;
		};
	}, [clearSettleTimer, containerRef, haptics, queueVisual, router, settleVisual]);

	useEffect(() => {
		return () => {
			if (visualFrameRef.current !== null) {
				window.cancelAnimationFrame(visualFrameRef.current);
			}
			if (settleTimerRef.current !== null) {
				window.clearTimeout(settleTimerRef.current);
			}
		};
	}, []);

	const style = useMemo<CSSProperties>(() => {
		if (reducedMotion || visual.phase === "idle") return {};

		return {
			opacity: visual.opacity,
			transform: `translate3d(${visual.offset.toFixed(2)}px, 0, 0)`,
			transition:
				visual.phase === "dragging"
					? "none"
					: "transform var(--dur-slow) var(--ease-spring), opacity var(--dur-base) var(--ease-ios)",
			willChange: "transform, opacity",
		};
	}, [reducedMotion, visual]);

	return {
		activeIndex,
		isDragging: visual.phase === "dragging",
		style,
	};
}
