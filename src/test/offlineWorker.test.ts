import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression coverage for the offline navigation fallback.
 *
 * Workbox precaches documents under a key carrying a `?__WB_REVISION__` suffix.
 * The worker previously matched bare pathnames, so every offline navigation
 * missed the cache and resolved to `Response.error()` — surfacing to the user
 * as a browser ERR_FAILED page instead of the app shell.
 */

interface FetchEventLike {
	request: { method: string; mode: string; url: string };
	respondWith: (response: Promise<Response> | Response) => void;
}

type FetchListener = (event: FetchEventLike) => void;

const ORIGIN = "https://mizantrack.test";

function loadWorker(): FetchListener {
	let listener: FetchListener | undefined;

	vi.stubGlobal("self", {
		location: { origin: ORIGIN },
		addEventListener: (type: string, handler: FetchListener) => {
			if (type === "fetch") listener = handler;
		},
	});

	// The worker registers its listener as a side effect of evaluation.
	const source = readWorkerSource();
	new Function(source)();

	if (!listener) throw new Error("worker did not register a fetch listener");
	return listener;
}

function readWorkerSource(): string {
	return readFileSync(join(process.cwd(), "worker/index.js"), "utf8");
}

function navigationEvent(url: string): { event: FetchEventLike; settled: Promise<Response> } {
	let resolveSettled: (response: Promise<Response> | Response) => void;
	const settled = new Promise<Response>((resolve) => {
		resolveSettled = (response) => resolve(Promise.resolve(response));
	});

	return {
		event: {
			request: { method: "GET", mode: "navigate", url },
			respondWith: (response) => resolveSettled(response),
		},
		settled,
	};
}

describe("offline navigation fallback worker", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("serves a revisioned precache entry when the network is unavailable", async () => {
		const shell = new Response("<!doctype html>app shell", {
			headers: { "content-type": "text/html" },
		});
		const match = vi.fn(async (request: string, options?: CacheQueryOptions) => {
			// Mirrors Workbox: the entry is only reachable when the revision query
			// string is ignored.
			if (request === "/dashboard" && options?.ignoreSearch) return shell;
			return undefined;
		});
		vi.stubGlobal("caches", { match });

		const listener = loadWorker();
		const { event, settled } = navigationEvent(`${ORIGIN}/dashboard`);
		listener(event);

		const response = await settled;
		expect(response).toBe(shell);
		expect(await response.text()).toContain("app shell");
		expect(match).toHaveBeenCalledWith("/dashboard", { ignoreSearch: true });
	});

	it("falls back to the shell for a route that was never precached", async () => {
		const shell = new Response("shell");
		vi.stubGlobal("caches", {
			match: vi.fn(async (request: string) => (request === "/dashboard" ? shell : undefined)),
		});

		const listener = loadWorker();
		const { event, settled } = navigationEvent(`${ORIGIN}/accounts`);
		listener(event);

		expect(await settled).toBe(shell);
	});

	it("ignores API requests so auth calls are never served from cache", async () => {
		const match = vi.fn();
		vi.stubGlobal("caches", { match });

		const listener = loadWorker();
		const respondWith = vi.fn();
		listener({
			request: { method: "GET", mode: "navigate", url: `${ORIGIN}/api/auth/session` },
			respondWith,
		});

		expect(respondWith).not.toHaveBeenCalled();
		expect(match).not.toHaveBeenCalled();
	});

	it("ignores non-navigation requests", async () => {
		vi.stubGlobal("caches", { match: vi.fn() });

		const listener = loadWorker();
		const respondWith = vi.fn();
		listener({
			request: { method: "GET", mode: "cors", url: `${ORIGIN}/_next/static/chunk.js` },
			respondWith,
		});

		expect(respondWith).not.toHaveBeenCalled();
	});
});
