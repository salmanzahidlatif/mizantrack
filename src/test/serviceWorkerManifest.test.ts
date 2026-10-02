import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Guards the generated service worker's precache manifest.
 *
 * Workbox throws `add-to-cache-list-conflicting-entries` when the same URL is
 * precached twice with different revisions. The generated sw.js wraps
 * everything in an AMD `define()` callback, so that throw is swallowed: the
 * worker still reports as "activated" while precacheAndRoute and every
 * runtimeCaching route silently fail to register. The result is a worker that
 * looks healthy in devtools but caches nothing, so the app only appears to work
 * offline while the page is still in memory and dies on a cold start.
 *
 * Adding "/" to additionalManifestEntries caused exactly that, because next-pwa
 * already precaches the start URL itself.
 */

const SW_PATH = join(process.cwd(), "public/sw.js");
const ENTRY_PATTERN = /\{url:"([^"]*)",revision:(?:"([^"]*)"|null)\}/g;

function readManifestEntries(): { url: string; revision: string | null }[] {
	const source = readFileSync(SW_PATH, "utf8");
	const entries: { url: string; revision: string | null }[] = [];

	for (const match of source.matchAll(ENTRY_PATTERN)) {
		entries.push({ url: match[1]!, revision: match[2] ?? null });
	}

	return entries;
}

describe("service worker precache manifest", () => {
	it.runIf(existsSync(SW_PATH))("never lists a URL with conflicting revisions", () => {
		const revisionsByUrl = new Map<string, Set<string>>();

		for (const { url, revision } of readManifestEntries()) {
			const revisions = revisionsByUrl.get(url) ?? new Set<string>();
			revisions.add(revision ?? "<null>");
			revisionsByUrl.set(url, revisions);
		}

		const conflicting = [...revisionsByUrl.entries()]
			.filter(([, revisions]) => revisions.size > 1)
			.map(([url, revisions]) => `${url} -> ${[...revisions].join(", ")}`);

		expect(conflicting).toEqual([]);
	});

	it.runIf(existsSync(SW_PATH))("precaches the start URL so cold starts work offline", () => {
		const urls = new Set(readManifestEntries().map((entry) => entry.url));

		// start_url in public/manifest.json — a cold launch from the home screen
		// navigates straight here, so it must be precached.
		expect(urls.has("/dashboard")).toBe(true);
	});
});
