"use client";

import { useEffect, useRef, useState } from "react";

export type KeyboardInsetState = Readonly<{
	keyboardInset: number;
	isKeyboardOpen: boolean;
}>;

const KEYBOARD_OPEN_THRESHOLD = 24;
const KEYBOARD_INSET_PROPERTY = "--keyboard-inset";
const STATE_SETTLE_DELAY = 80;

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
