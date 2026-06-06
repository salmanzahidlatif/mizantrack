"use client";

import { useEffect } from "react";

export default function RegisterSW() {
	useEffect(() => {
		const registerServiceWorker = async () => {
			if ("serviceWorker" in navigator) {
				await navigator.serviceWorker.register("/sw.js");
			}
		};

		void registerServiceWorker();
	}, []);

	return null;
}
