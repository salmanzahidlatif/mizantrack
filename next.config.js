// @ts-check
const withPWA = require("@ducanh2912/next-pwa").default;

// next-pwa already precaches "/" (via cacheStartUrl and its own build manifest).
// Re-adding it here with a different revision makes Workbox throw
// add-to-cache-list-conflicting-entries inside precacheAndRoute. That throw is
// swallowed by the generated AMD wrapper, so the service worker still activates
// but silently registers no precache and no runtime routes at all.
const appShellRoutes = [
	"/dashboard",
	"/accounts",
	"/transactions",
	"/categories",
	"/reports",
	"/settings",
	"/zakat",
	"/login",
	"/offline",
];

const appShellRevision =
	process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? "local-app-shell-v1";

const networkOnlyOrigins = [
	/^https:\/\/accounts\.google\.com\/.*/i,
	/^https:\/\/oauth2\.googleapis\.com\/.*/i,
	/^https:\/\/www\.googleapis\.com\/.*/i,
	/^https:\/\/identitytoolkit\.googleapis\.com\/.*/i,
	/^https:\/\/securetoken\.googleapis\.com\/.*/i,
	/^https:\/\/firestore\.googleapis\.com\/.*/i,
	/^https:\/\/.*\.firebaseio\.com\/.*/i,
	/^https:\/\/.*\.firebaseapp\.com\/.*/i,
];

const networkOnlyPlugins = [
	{
		handlerDidError: async () => Response.error(),
	},
];

/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	turbopack: {
		root: __dirname,
	},
};

module.exports = withPWA({
	dest: "public",
	// A production service worker on the dev server caches stale assets and
	// errors on Next's HMR POST requests, so it is only built outside dev.
	disable: process.env.NODE_ENV === "development",
	register: false,
	skipWaiting: true,
	clientsClaim: true,
	reloadOnOnline: false,
	cacheStartUrl: true,
	dynamicStartUrl: false,
	fallbacks: { document: "/dashboard" },
	workboxOptions: {
		additionalManifestEntries: appShellRoutes.map((url) => ({
			url,
			revision: appShellRevision,
		})),
		cleanupOutdatedCaches: true,
		navigateFallback: "/dashboard",
		navigateFallbackDenylist: [/^\/api\//],
		runtimeCaching: [
			{
				urlPattern: ({ sameOrigin, url }) => sameOrigin && url.pathname.startsWith("/api/"),
				handler: "NetworkOnly",
				options: { cacheName: "mizantrack-network-only-api", plugins: networkOnlyPlugins },
			},
			...networkOnlyOrigins.map((urlPattern) => ({
				urlPattern,
				handler: "NetworkOnly",
				options: {
					cacheName: "mizantrack-network-only-third-party",
					plugins: networkOnlyPlugins,
				},
			})),
			{
				urlPattern: ({ request, sameOrigin }) => sameOrigin && request.mode === "navigate",
				handler: "NetworkFirst",
				options: {
					cacheName: "mizantrack-static-shell",
					networkTimeoutSeconds: 3,
					expiration: { maxEntries: 32, maxAgeSeconds: 7 * 24 * 60 * 60 },
				},
			},
			{
				urlPattern: ({ sameOrigin, url }) =>
					sameOrigin && url.pathname.startsWith("/_next/static/"),
				handler: "CacheFirst",
				options: {
					cacheName: "mizantrack-next-static",
					expiration: { maxEntries: 160, maxAgeSeconds: 30 * 24 * 60 * 60 },
				},
			},
			{
				urlPattern: /\.(?:png|jpg|jpeg|svg|webp|ico)$/i,
				handler: "StaleWhileRevalidate",
				options: {
					cacheName: "mizantrack-images",
					expiration: { maxEntries: 64, maxAgeSeconds: 30 * 24 * 60 * 60 },
				},
			},
			{
				urlPattern: /\.(?:woff|woff2)$/i,
				handler: "CacheFirst",
				options: {
					cacheName: "mizantrack-fonts",
					expiration: { maxEntries: 32, maxAgeSeconds: 365 * 24 * 60 * 60 },
				},
			},
		],
	},
})(nextConfig);
