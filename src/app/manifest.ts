import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "MizanTrack",
		short_name: "MizanTrack",
		description: "Personal Finance Tracker + Budgeting App + Zakat Calculator",
		id: "/dashboard",
		start_url: "/dashboard",
		scope: "/",
		display: "standalone",
		orientation: "portrait-primary",
		lang: "en",
		background_color: "#09090b",
		theme_color: "#09090b",
		categories: ["finance", "productivity"],
		icons: [
			{ src: "/icon-192.png", sizes: "192x192", type: "image/png" },
			{ src: "/icon-512.png", sizes: "512x512", type: "image/png" },
		],
	};
}
