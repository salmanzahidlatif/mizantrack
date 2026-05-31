# Lessons Learned

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
