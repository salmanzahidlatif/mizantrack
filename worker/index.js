const SHELL_FALLBACK_PATHS = ["/dashboard", "/offline"];

/**
 * Workbox stores precached documents under a key carrying a `?__WB_REVISION__`
 * suffix, so matching a bare pathname never hits and every offline navigation
 * falls through to `Response.error()`, which surfaces as ERR_FAILED.
 * `ignoreSearch` lets the revisioned entry resolve.
 */
async function matchAppShell(pathname) {
	for (const candidate of [pathname, ...SHELL_FALLBACK_PATHS]) {
		const cached = await caches.match(candidate, { ignoreSearch: true });
		if (cached) return cached;
	}
	return undefined;
}

self.addEventListener("fetch", (event) => {
	if (event.request.method !== "GET") return;
	if (event.request.mode !== "navigate") return;

	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin) return;
	if (url.pathname.startsWith("/api/")) return;

	event.respondWith(
		fetch(event.request).catch(async () => (await matchAppShell(url.pathname)) ?? Response.error())
	);
});
