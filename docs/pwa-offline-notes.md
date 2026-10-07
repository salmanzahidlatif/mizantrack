# PWA Offline Notes — Workbox Precache Conflict

**Context:** October 2026 offline recovery work for the installed MizanTrack PWA.  
**Most important commit:** `da2ff05` — `fix(pwa): stop a conflicting precache entry disabling the service worker`.

---

## Failure Summary

Launching the installed app offline from the home screen showed a white screen / browser `ERR_FAILED`. Going offline during an already-open session could appear to work, which made the service worker look healthier than it was.

The final root cause was not simply "the route was not cached." It was subtler:

- `additionalManifestEntries` added `/` with the commit SHA as its revision.
- `@ducanh2912/next-pwa` / Workbox already precached the start URL with the build ID.
- Workbox saw the same URL with two different revisions and threw:

```text
add-to-cache-list-conflicting-entries
```

The generated `sw.js` wrapped execution inside an AMD `define()` callback. The exception was swallowed there. Result:

- browser/devtools showed the service worker as installed and activated;
- `precacheAndRoute` did not finish;
- runtime routes did not register;
- cache storage had no useful app precache;
- offline cold start had nothing to serve.

After removing the duplicate `/` manifest entry, production verification showed the precache moving from **0 to 89 entries** and an offline cold start returned 200 and rendered.

---

## Failure Chain Found During Investigation

### 1. App routes required the network

**Commits:** `0ef6428`, `f891a92`

Server components and auth/proxy reads made app routes dynamic. Offline navigation could not render because the route depended on a network session check.

Fixes:

- `0ef6428` added client-side offline session resolution with a locally persisted, validated user snapshot. It stores identity only, not tokens.
- `f891a92` moved page data loading into client components so the route shells could build as static.

### 2. Custom worker missed Workbox revisioned entries

**Commit:** `e0a28fc`

Workbox precaches documents under a cache key containing `?__WB_REVISION__`. The custom worker looked up bare pathnames, so every lookup missed and fell through to `Response.error()`.

Fix:

- match precached navigation entries with `ignoreSearch`.

### 3. Conflicting precache entries disabled the worker silently

**Commit:** `da2ff05`

The duplicate `/` entry with a different revision caused Workbox to throw before route registration completed. The worker still appeared activated, so registration status was a false positive.

Fix:

- remove `/` from `additionalManifestEntries`;
- rely on next-pwa's own start URL precache;
- add `src/test/serviceWorkerManifest.test.ts` to reject URLs listed with conflicting revisions and assert that the configured start URL remains precached.

---

## Files Involved

- `next.config.js`
  - PWA configuration.
  - `additionalManifestEntries`.
  - runtime caching rules.
  - NetworkOnly handling for API / Google / Firebase requests.
- `worker/index.js`
  - custom worker navigation fallback and precache lookup behaviour.
- `src/components/layout/RegisterSW.tsx`
  - service-worker registration/update handling.
- `src/lib/auth/offline-session.ts`
  - offline identity snapshot.
- `src/test/serviceWorkerManifest.test.ts`
  - guards against conflicting Workbox precache revisions.
- `src/test/offlineWorker.test.ts`
  - covers revisioned precache navigation lookup.
- `tests/e2e.spec.ts`
  - offline app-shell behaviour.

---

## Do Not Reintroduce

Do **not** add `/` to `additionalManifestEntries` unless you have proved next-pwa no longer precaches the start URL itself. A duplicate URL with a different revision can disable the effective worker while leaving registration state green.

Avoid hand-adding any URL that next-pwa already emits into the generated precache manifest. If a route needs offline coverage, first check whether it is already generated as part of the build/app shell.

---

## Verification Checklist

For any future PWA/offline change, verify all of the following against a production build:

1. `public/sw.js` has no duplicate URL with conflicting revisions.
2. The configured start URL is present in the generated precache manifest.
3. `caches.keys()` shows the expected Workbox precache after first online load.
4. The relevant precache contains app-shell entries; do not accept "0 entries".
5. Kill the tab, disable the network, and launch from the installed home-screen icon.
6. Offline cold start returns HTTP 200 and renders the app shell.
7. API, Google, and Firebase responses are not cached; they should stay NetworkOnly.

Registration state alone is not enough. An "activated" service worker can still have registered no precache and no runtime routes if an exception was swallowed during setup.

---

## Regression Test Intent

`src/test/serviceWorkerManifest.test.ts` is intentionally about the generated artifact, not just config source. It checks what Workbox will actually see:

- every URL maps to one revision only;
- the start URL needed for cold launch is precached.

Keep this test or an equivalent artifact-level guard if the PWA library changes.
