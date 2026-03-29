declare module "next-pwa" {
	import type { NextConfig } from "next";

	interface RuntimeCachingEntry {
		urlPattern: RegExp | string;
		handler: "NetworkFirst" | "CacheFirst" | "NetworkOnly" | "CacheOnly" | "StaleWhileRevalidate";
		options?: {
			cacheName?: string;
			networkTimeoutSeconds?: number;
			expiration?: {
				maxEntries?: number;
				maxAgeSeconds?: number;
			};
			[key: string]: unknown;
		};
	}

	interface PWAConfig {
		dest: string;
		register?: boolean;
		skipWaiting?: boolean;
		disable?: boolean;
		runtimeCaching?: RuntimeCachingEntry[];
		[key: string]: unknown;
	}

	function withPWA(pwaConfig: PWAConfig): (nextConfig: NextConfig) => NextConfig;
	export default withPWA;
}
