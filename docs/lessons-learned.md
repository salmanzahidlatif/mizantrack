# Lessons Learned

## 2026-05-31 - PWA service worker never generated (next-pwa@5 incompatibility)

### What Happened
The app was deployed to Vercel and the manifest.json rendered a "Syntax error" in the browser console. The service worker (`sw.js`) was never generated, making the app non-installable and non-functional offline. The same problem existed locally in production builds.

### Root Cause
`next-pwa@5.6.0` uses Webpack plugin hooks (`InjectManifest` from `workbox-webpack-plugin`) that are incompatible with Next.js 16's Webpack 5 build pipeline. The library silently skips SW generation without throwing a build error. The `isDev` guard in `next.config.js` also disabled the PWA wrapper entirely in dev mode, making the issue untestable locally.

Separately, `public/manifest.json` was missing fields required by current browser installability criteria: `scope`, `id`, `orientation`, `lang`, `categories`, and icon `purpose` — causing the manifest Syntax error from a stale SW serving a cached version of the manifest.

### Fix Applied
- **`package.json`**: Replaced `next-pwa@^5.6.0` with `@ducanh2912/next-pwa@^10.2.9` — maintained fork of next-pwa with `peerDeps: { next: '>=14', webpack: '>=5' }`; no extra CLI dependencies required.
- **`next.config.js`**: Changed `require("next-pwa")` → `require("@ducanh2912/next-pwa").default`; removed the `isDev` conditional entirely (the new library handles dev vs prod internally via a lightweight stub SW in dev mode); added `fallbackRoutes: { document: "/offline" }`.
- **`public/manifest.json`**: Added `id`, `scope`, `orientation`, `lang`, `categories`; updated icon entries with `purpose` fields (`"maskable any"` for 512px, `"any"` for 192px).
- **`src/app/offline/page.tsx`**: New standalone offline fallback page (no AppShell, no auth) served by the SW when offline navigation hits an uncached route.
- **`src/types/next-pwa.d.ts`**: Cleared the stale `declare module "next-pwa"` shim; `@ducanh2912/next-pwa` ships its own types.

### Regression Tests
- `manifest.test.ts`: `hasRequiredInstallabilityFields` — verifies `scope`, `id`, `orientation`, `lang`, `categories` are present
- `manifest.test.ts`: `hasAtLeastOneMaskableIcon` — verifies at least one icon has `purpose` containing `"maskable"`
- `manifest.test.ts`: `hasBothIconSizes` — verifies 192×192 and 512×512 are present

### Prevention
- `next-pwa@5` is a known dead end for Next.js ≥14. Never use it in new projects. The maintained replacement is `@ducanh2912/next-pwa`.
- Never guard `withPWA` on `isDev` — you lose the ability to test SW locally. The new library handles the dev/prod distinction correctly internally.
- Manifest required fields change over time as browser installability criteria evolve. Validate with Lighthouse PWA audit after every manifest change.
- A stale service worker can cache a broken manifest response indefinitely. Hard-refresh (Ctrl+Shift+R / Cmd+Shift+R) clears this; a new correctly-generated SW will purge the old cache on activation.

## 2026-05-31 - Firebase permission-denied on all sync operations

### What Happened
Sync operations (both `syncAll` and `getFirestoreUsage`) failed with Firebase `permission-denied`. The `getFirestoreUsage` failure surfaced as an unhandled promise rejection in the browser console. Sync errors were caught in the store but showed the raw Firebase message ("Missing or insufficient permissions.") rather than actionable guidance.

### Root Cause
MizanTrack initializes the Firebase JS SDK client-side with user-supplied credentials but never calls any Firebase Authentication API (no `signInAnonymously`, no `signInWithCustomToken`). As a result, `request.auth` is `null` for every Firestore request. The README documented rules requiring `request.auth != null && request.auth.uid == userId`, which denies every operation. This is an architectural mismatch: the app uses NextAuth (Google OAuth) for auth but the documented Firestore rules assumed Firebase Auth was also in use.

Additionally, `getFirestoreUsage` had no try/catch — Firebase errors from `getCountFromServer` (the `RunAggregationQuery` RPC) propagated as unhandled promise rejections.

### Fix Applied
- **`src/lib/db/sync.ts`**: Wrapped `getFirestoreUsage` Firebase calls in try/catch; returns `null` on any error. Usage indicator fails gracefully instead of throwing.
- **`src/store/sync-store.ts`**: Detects Firebase `permission-denied` error code and surfaces the user-friendly message: "Sync failed: permission denied. Check your Firestore security rules."
- **`README.md`**: Updated Firestore rules to `allow read, write: if true;`. This is appropriate because each user's data is in their **own private Firebase project** — isolation is at the project level, not the document level. MizanTrack has no backend to issue Firebase custom tokens.
- **`src/components/settings/SyncSetupSteps.tsx`**: Added Firestore rules to the Step 4 pre-flight checklist with an inline rules snippet, so new users are guided to set the rules before applying config.

### Regression Tests
- `sync.test.ts`: `getFirestoreUsage_PermissionDenied_ReturnsNullInsteadOfThrowing`
- `sync.test.ts`: `getFirestoreUsage_AnyFirestoreError_ReturnsNull`
- `sync.test.ts`: `getFirestoreUsage_NoConfig_ReturnsNull`

### Prevention
- When using Firebase Firestore in a no-backend app (NextAuth only, no Firebase Auth), the only viable Firestore rules pattern is `allow read, write: if true;` for user-owned projects. Document this prominently and explain the security model.
- Any function that calls Firebase SDK and is invoked with `void` (fire-and-forget) must internally catch all errors — otherwise Firebase errors become silent unhandled rejections that only appear in the browser console.
- Firebase `permission-denied` is a predictable failure mode when setting up sync. Always translate it to an actionable UI message (not the raw SDK message).

## 2026-05-31 - Settings page hydration mismatch + currency save silently failing

### What Happened
Settings page logged a React hydration warning on the theme buttons. Separately, users were unable to save a currency value (e.g. PKR) — the "Saved" indicator flashed but the value did not persist.

### Root Cause

**Hydration mismatch:** `PreferencesForm` renders theme buttons whose `className` is computed from `theme === t`. `useTheme()` returns `undefined` on the server (SSR), but the actual theme (e.g. `"dark"`) on the client. The resulting difference in `className` triggered React's hydration warning.

**Currency save silently failing:** `scheduleSave` called `db.dbConfig.update(userId, {...})`. Dexie's `update` returns `0` (not an error) when no record with that primary key exists. Because `useLiveQuery` returns `undefined` for both "still loading" and "record not found", the `if (config === undefined) return` early return in the initialization effect fires even when there is no record — so the initial `put` to create the record is never called. Every subsequent `update` silently returns 0. The `.then()` fires regardless, showing the "Saved" indicator, but nothing is persisted.

### Fix Applied
- **Hydration mismatch:** Added `mounted` state initialized to `false`, set to `true` in a `useEffect(() => { setMounted(true) }, [])`. Theme button active styling now uses `mounted && theme === t` — server always renders the inactive (border-border) style, eliminating the mismatch.
- **Currency save:** Changed `scheduleSave` to use an upsert pattern: `update` first, then `put` with safe defaults if `count === 0`.

### Regression Tests
- `settings.test.ts`: `update_WhenNoRecord_ReturnsZeroAndDoesNotCreate` — confirms Dexie update silently fails when record is absent
- `settings.test.ts`: `upsertDbConfig_WhenNoRecord_CreatesWithCorrectCurrency` — confirms the upsert pattern creates the record correctly

### Prevention
- When using `next-themes`, always gate theme-dependent rendering on a `mounted` state — SSR always has `theme = undefined`.
- Never use `Dexie.Table.update()` as the sole persistence path for a record that might not exist. Either `put` (upsert) or handle the `count === 0` case explicitly.
- Do not rely on `useLiveQuery` result being `undefined` to mean "loading" vs "not found" — the hook does not distinguish these cases.

## 2026-05-31 - Post-login `Invalid argument to Table.get()`

### What Happened
After Google sign-in, users reached `/dashboard` but the client crashed with `Uncaught TypeError: Invalid argument to Table.get()` from `useDbConfig`.

### Root Cause
`session.user.id` was assumed to exist by protected routes and client components, but NextAuth did not explicitly map `token.sub` into `session.user.id`. This created a runtime path where `userId` was missing after login.

### Fix Applied
- Added a session helper (`resolveSessionUserId`) to normalize `token.sub`.
- Added NextAuth `callbacks.session` mapping: `session.user.id = resolveSessionUserId(token) ?? ""`.
- Hardened login/protected routes to require `session.user.id` before redirecting/rendering app pages.

### Regression Test
- Added `src/test/auth.test.ts`:
  - `tokenSubPresent_ReturnsTokenSub`
  - `tokenSubMissing_ReturnsNull`

### Prevention
- Do not rely on TypeScript module augmentation alone for auth session shape; always set runtime session fields in auth callbacks.
- Gate protected routes on both session existence and required identity fields (`session.user.id`).
