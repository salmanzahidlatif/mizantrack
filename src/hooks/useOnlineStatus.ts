"use client";

import { useEffect, useState } from "react";

/**
 * Tracks connectivity and re-renders when it changes, so controls that need the
 * network can disable themselves while a screen is already open rather than
 * failing when pressed.
 *
 * Starts optimistic: during SSR and the first client render there is no
 * navigator, and assuming offline would briefly disable working controls.
 */
export function useOnlineStatus(): boolean {
	const [online, setOnline] = useState(true);

	useEffect(() => {
		if (typeof navigator === "undefined") return;

		const update = () => setOnline(navigator.onLine);
		update();

		window.addEventListener("online", update);
		window.addEventListener("offline", update);
		return () => {
			window.removeEventListener("online", update);
			window.removeEventListener("offline", update);
		};
	}, []);

	return online;
}
