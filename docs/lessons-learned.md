# Lessons Learned

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
