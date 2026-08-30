"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export default function RegisterSW() {
	useEffect(() => {
		if (!("serviceWorker" in navigator)) return;

		let notified = false;
		let reloading = false;

		const reloadOnce = () => {
			if (reloading) return;
			reloading = true;
			window.location.reload();
		};

		// The active SW already unconditionally self-activates (self.skipWaiting() in
		// install), so by the time we could detect an "installed/waiting" worker it may
		// have already taken control. Reacting directly to controllerchange (rather than
		// gating the reload behind a toast timer) guarantees we never miss the swap.
		const handleControllerChange = () => {
			if (!notified) {
				// Controller changed before we had a chance to show the toast (fast swap) —
				// just reload immediately, there's nothing to wait for.
				reloadOnce();
				return;
			}
			// Toast already shown; let its own timer drive the reload instead of double-firing.
		};
		navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

		const notifyUpdate = () => {
			if (notified) return;
			notified = true;
			toast("🚀 New version available", {
				description: "The app will update automatically in a moment.",
				duration: 4000,
				onAutoClose: reloadOnce,
			});
		};

		const register = async () => {
			const reg = await navigator.serviceWorker.register("/sw.js");

			// A new SW found while app is running (user hasn't refreshed)
			reg.addEventListener("updatefound", () => {
				const newWorker = reg.installing;
				if (!newWorker) return;
				newWorker.addEventListener("statechange", () => {
					// installed = downloaded & ready; controller check ensures this is an
					// actual update (not the very first install on a fresh device)
					if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
						notifyUpdate();
					}
				});
			});

			// A SW was already waiting when the page loaded (e.g. tab was open during deploy)
			if (reg.waiting && navigator.serviceWorker.controller) {
				notifyUpdate();
			}
		};

		void register();

		return () => {
			navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
		};
	}, []);

	return null;
}
