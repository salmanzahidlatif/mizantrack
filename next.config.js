const withPWA = require("next-pwa");

const isDev = process.env.NODE_ENV === "development";

/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	turbopack: {
		root: __dirname,
	},
};

module.exports = isDev
	? nextConfig
	: withPWA({
			dest: "public",
			register: true,
			skipWaiting: true,
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
