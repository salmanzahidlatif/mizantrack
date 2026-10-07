"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export default function RegisterSW() {
	useEffect(() => {
		if (!("serviceWorker" in navigator)) return;

		// next-pwa does not build a worker in development, so a leftover
		// public/sw.js from a previous production build would otherwise keep
		// controlling the dev server and serving stale assets.
		if (process.env.NODE_ENV === "development") {
			void navigator.serviceWorker.getRegistrations().then((registrations) => {
				for (const registration of registrations) void registration.unregister();
			});
			return;
		}

		let hadController = Boolean(navigator.serviceWorker.controller);
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
			if (!hadController) {
				hadController = true;
				return;
			}
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
			const reg = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });

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

			// The browser only re-fetches sw.js on its own for full top-level navigations.
			// Since this is an SPA (client-side routing within the app never triggers that),
			// a tab left open on one page would never learn about a new deploy unless we
			// actively ask. reg.update() forces a byte-for-byte re-check of /sw.js against
			// the network, which is what actually surfaces new deploys while the app is open.
			const checkForUpdate = () => {
				void reg.update();
			};

			// Poll periodically...
			const intervalId = setInterval(checkForUpdate, 60_000);
			// ...and also check immediately whenever the tab regains focus/visibility,
			// which is the moment users are most likely to expect a fresh version.
			const handleVisibility = () => {
				if (document.visibilityState === "visible") checkForUpdate();
			};
			document.addEventListener("visibilitychange", handleVisibility);
			window.addEventListener("focus", checkForUpdate);

			return () => {
				clearInterval(intervalId);
				document.removeEventListener("visibilitychange", handleVisibility);
				window.removeEventListener("focus", checkForUpdate);
			};
		};

		let cleanupRegister: (() => void) | undefined;
		void register()
			.then((cleanup) => {
				cleanupRegister = cleanup;
			})
			.catch((error) => {
				console.warn("MizanTrack service worker registration failed.", error);
			});

		return () => {
			navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
			cleanupRegister?.();
		};
	}, []);

	return null;
}
