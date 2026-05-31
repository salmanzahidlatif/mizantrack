// @ts-check
const withPWA = require("@ducanh2912/next-pwa").default;

/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	turbopack: {
		root: __dirname,
	},
};

module.exports = withPWA({
	dest: "public",
	register: true,
	skipWaiting: true,
	fallbackRoutes: { document: "/offline" },
	runtimeCaching: [
		{
			urlPattern: /^https?.*/,
			handler: "NetworkFirst",
			options: {
				cacheName: "mizantrack-cache",
				networkTimeoutSeconds: 10,
				expiration: { maxEntries: 200, maxAgeSeconds: 86400 },
			},
		},
	],
})(nextConfig);
