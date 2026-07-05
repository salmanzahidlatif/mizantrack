"use client";

import { useEffect } from "react";
import { toast } from "sonner";

export default function RegisterSW() {
	useEffect(() => {
		if (!("serviceWorker" in navigator)) return;

		let reloadPending = false;

		// When the new SW takes control, reload once to activate it
		const handleControllerChange = () => {
			if (reloadPending) {
				reloadPending = false;
				window.location.reload();
			}
		};
		navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

		const register = async () => {
			const reg = await navigator.serviceWorker.register("/sw.js");

			const notifyUpdate = (worker: ServiceWorker) => {
				toast("🚀 New version available", {
					description: "The app will update automatically in a moment.",
					duration: 4000,
					onAutoClose: () => {
						// Tell the waiting SW to skip waiting and take control
						reloadPending = true;
						worker.postMessage({ type: "SKIP_WAITING" });
					},
				});
			};

			// A new SW found while app is running (user hasn't refreshed)
			reg.addEventListener("updatefound", () => {
				const newWorker = reg.installing;
				if (!newWorker) return;
				newWorker.addEventListener("statechange", () => {
					// installed = downloaded & ready but waiting; controller check ensures
					// this is an actual update (not the very first install)
					if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
						notifyUpdate(newWorker);
					}
				});
			});

			// A SW was already waiting when the page loaded (e.g. tab was open during deploy)
			if (reg.waiting && navigator.serviceWorker.controller) {
				notifyUpdate(reg.waiting);
			}
		};

		void register();

		return () => {
			navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
		};
	}, []);

	return null;
}
