"use client";

import { useEffect, useRef, useState } from "react";

export type KeyboardInsetState = Readonly<{
	keyboardInset: number;
	isKeyboardOpen: boolean;
}>;

const KEYBOARD_OPEN_THRESHOLD = 24;
const KEYBOARD_INSET_PROPERTY = "--keyboard-inset";
const STATE_SETTLE_DELAY = 80;
const KEYBOARD_SCROLL_CONTAINER_SELECTOR = "[data-keyboard-scroll-container='true']";
const FOCUSABLE_FIELD_SELECTOR =
	"input, textarea, select, button, [role='combobox'], [contenteditable='true']";
const FOCUS_SCROLL_DELAYS = [0, 120, 280, 420];
const FOCUS_SCROLL_MARGIN = 12;

function getKeyboardInset() {
	if (typeof window === "undefined" || !window.visualViewport) {
		return 0;
	}

	const { height, offsetTop } = window.visualViewport;
	const inset = window.innerHeight - (height + offsetTop);

	return Math.max(0, Math.round(inset));
}

function setKeyboardInsetProperty(inset: number) {
	if (typeof document === "undefined") {
		return;
	}

	document.documentElement.style.setProperty(KEYBOARD_INSET_PROPERTY, `${inset}px`);
}

function getKeyboardInsetProperty() {
	if (typeof document === "undefined") {
		return 0;
	}

	const rawInset = window
		.getComputedStyle(document.documentElement)
		.getPropertyValue(KEYBOARD_INSET_PROPERTY);
	const inset = Number.parseFloat(rawInset);

	return Number.isFinite(inset) ? Math.max(0, inset) : 0;
}

function scrollByDelta(scrollContainer: HTMLElement, delta: number) {
	if (Math.abs(delta) < 1) {
		return;
	}

	scrollContainer.scrollTop += delta;
}

function scrollFieldIntoKeyboardViewport(field: HTMLElement) {
	const scrollContainer = field.closest(KEYBOARD_SCROLL_CONTAINER_SELECTOR);
	if (!(scrollContainer instanceof HTMLElement)) {
		if (typeof field.scrollIntoView === "function") {
			field.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
		}
		return;
	}

	const containerRect = scrollContainer.getBoundingClientRect();
	const fieldRect = field.getBoundingClientRect();
	const footer = scrollContainer.parentElement?.querySelector("[data-slot='drawer-footer']");
	const footerTop =
		footer instanceof HTMLElement ? footer.getBoundingClientRect().top : Number.POSITIVE_INFINITY;
	const visualViewport = window.visualViewport;
	const viewportTop = visualViewport?.offsetTop ?? 0;
	const viewportBottom = viewportTop + (visualViewport?.height ?? window.innerHeight);
	const keyboardInset = getKeyboardInsetProperty();
	const keyboardTop =
		keyboardInset > 0 ? window.innerHeight - keyboardInset : Number.POSITIVE_INFINITY;
	const visibleTop = Math.max(containerRect.top, viewportTop) + FOCUS_SCROLL_MARGIN;
	const visibleBottom =
		Math.min(containerRect.bottom, viewportBottom, keyboardTop, footerTop) - FOCUS_SCROLL_MARGIN;

	if (fieldRect.bottom > visibleBottom) {
		scrollByDelta(scrollContainer, fieldRect.bottom - visibleBottom);
		return;
	}

	if (fieldRect.top < visibleTop) {
		scrollByDelta(scrollContainer, fieldRect.top - visibleTop);
	}
}

export function scrollFocusedFieldIntoView(target: EventTarget | null) {
	if (!(target instanceof HTMLElement)) return;

	const field = target.closest(FOCUSABLE_FIELD_SELECTOR);
	if (!(field instanceof HTMLElement)) return;

	for (const delay of FOCUS_SCROLL_DELAYS) {
		if (delay === 0) {
			window.requestAnimationFrame(() => scrollFieldIntoKeyboardViewport(field));
			continue;
		}

		window.setTimeout(() => scrollFieldIntoKeyboardViewport(field), delay);
	}
}

export function useKeyboardInset(): KeyboardInsetState {
	const [state, setState] = useState<KeyboardInsetState>({
		keyboardInset: 0,
		isKeyboardOpen: false,
	});
	const frameRef = useRef<number | null>(null);
	const settleTimeoutRef = useRef<number | null>(null);
	const lastInsetRef = useRef(0);
	const lastOpenRef = useRef(false);

	useEffect(() => {
		if (typeof window === "undefined" || !window.visualViewport) {
			setKeyboardInsetProperty(0);
			return;
		}

		const visualViewport = window.visualViewport;

		function commitState(keyboardInset: number, isKeyboardOpen: boolean) {
			lastOpenRef.current = isKeyboardOpen;
			setState((previous) => {
				if (
					previous.keyboardInset === keyboardInset &&
					previous.isKeyboardOpen === isKeyboardOpen
				) {
					return previous;
				}

				return { keyboardInset, isKeyboardOpen };
			});
		}

		function update() {
			frameRef.current = null;

			const keyboardInset = getKeyboardInset();
			const isKeyboardOpen = keyboardInset > KEYBOARD_OPEN_THRESHOLD;

			lastInsetRef.current = keyboardInset;
			setKeyboardInsetProperty(keyboardInset);

			if (lastOpenRef.current !== isKeyboardOpen) {
				commitState(keyboardInset, isKeyboardOpen);
			}

			if (settleTimeoutRef.current !== null) {
				window.clearTimeout(settleTimeoutRef.current);
			}

			settleTimeoutRef.current = window.setTimeout(() => {
				settleTimeoutRef.current = null;
				const settledInset = lastInsetRef.current;
				commitState(settledInset, settledInset > KEYBOARD_OPEN_THRESHOLD);
			}, STATE_SETTLE_DELAY);
		}

		function scheduleUpdate() {
			if (frameRef.current !== null) {
				return;
			}

			frameRef.current = window.requestAnimationFrame(update);
		}

		scheduleUpdate();
		visualViewport.addEventListener("resize", scheduleUpdate, { passive: true });
		visualViewport.addEventListener("scroll", scheduleUpdate, { passive: true });

		return () => {
			if (frameRef.current !== null) {
				window.cancelAnimationFrame(frameRef.current);
			}

			if (settleTimeoutRef.current !== null) {
				window.clearTimeout(settleTimeoutRef.current);
			}

			visualViewport.removeEventListener("resize", scheduleUpdate);
			visualViewport.removeEventListener("scroll", scheduleUpdate);

			if (lastInsetRef.current > 0) {
				setKeyboardInsetProperty(0);
			}
		};
	}, []);

	return state;
}
