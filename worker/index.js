self.addEventListener("fetch", (event) => {
	if (event.request.method !== "GET") return;
	if (event.request.mode !== "navigate") return;

	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin) return;
	if (url.pathname.startsWith("/api/")) return;

	event.respondWith(
		fetch(event.request).catch(async () => {
			return (
				(await caches.match(url.pathname)) ??
				(await caches.match("/dashboard")) ??
				(await caches.match("/offline")) ??
				Response.error()
			);
		})
	);
});
