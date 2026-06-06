# Lessons Learned

## 2026-06-06 - NextAuth v5 generates a fresh UUID userId per session; cross-environment sync broken

### What Happened
After syncing data from the local dev environment to Firestore and then opening the Vercel production deployment, pressing "Sync" on production pulled no data. The Firebase console showed two completely separate `/users/{id}/` document trees despite both environments being logged in with the same Google account. The userId on local was a UUID (`d351689b-7c79-4f3c-9d13-5b4041cdcc23`); the userId on production was a different UUID.

### Root Cause
NextAuth v5 (Auth.js) **intentionally** sets `user.id = crypto.randomUUID()` on every OAuth sign-in, independent of the Google account's identity. The comment in `@auth/core/lib/actions/callback/oauth/callback.js` states:

> "The user's id is intentionally not set based on the profile id, as the user should remain independent of the provider and the profile id is saved on the Account already, as `providerAccountId`."

Google's stable numeric sub (`providerAccountId`) is therefore never propagated to `token.sub` by default. Without a custom `jwt` callback, `token.sub` = a new UUID per session per device/environment. Two sign-ins (local + production) produce two different UUIDs → two different Firestore paths → sync finds nothing to pull.

### Fix Applied
- **`src/lib/auth/session.ts`**: Extracted `pinTokenSubToProvider(token, account)` helper that copies `account.providerAccountId` → `token.sub` when the account object is present (only on the initial sign-in; null on subsequent JWT refreshes).
- **`src/lib/auth.ts`**: Added `jwt` callback that calls `pinTokenSubToProvider`. `account` is non-null only during the OAuth sign-in flow, so `token.sub` is pinned once and then persists across all subsequent requests on that device.

After the fix, `session.user.id` = Google's stable numeric account ID (e.g. `"118402808840027279814"`) on every environment. Firestore paths are consistent: `/users/118402808840027279814/...` everywhere.

### Migration Steps Required (one-time after deploying this fix)
1. Deploy the fix to Vercel.
2. Sign out on both local dev and Vercel (clears the JWT cookies that contain the old UUID-based `token.sub`).
3. Sign back in on both environments. `token.sub` will now be the Google numeric ID.
4. **Local Dexie (IndexedDB):** existing data is stored under the old UUID. Open DevTools → Application → Storage → IndexedDB → `mizantrack` → clear all tables. Then reimport from the HK backup.
5. **Vercel Firestore:** delete the old UUID documents in the Firebase console, then sync fresh data from local after reimport.

### Regression Tests
- `auth.test.ts`: `onSignIn_PinsTokenSubToProviderAccountId`
- `auth.test.ts`: `onSubsequentRequest_NullAccount_PreservesExistingTokenSub`
- `auth.test.ts`: `sameGoogleAccount_LocalAndProduction_ProduceSameUserId`

### Prevention
- When using NextAuth v5 with OAuth providers and NO database adapter, always add a `jwt` callback that pins `token.sub = account.providerAccountId` on sign-in. The default behavior is a random UUID per session which is only suitable for database-backed setups (where NextAuth creates a consistent internal user record).
- Verify that `session.user.id` looks like an OAuth provider ID (numeric string for Google), not a UUID (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`). A UUID here is a red flag that the jwt callback is missing.
- Add this check to any new NextAuth v5 project with OAuth + no database adapter from day one.



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

---

## 2026-06-06 - HK import hardcoded AED currency for all accounts

### What Happened
After importing a Hysab Kytab `.xlsx` backup, all 38 imported accounts showed `currency: "AED"` regardless of the user's configured default currency (PKR). The dashboard and Accounts page displayed AED amounts instead of the correct PKR amounts.

### Root Cause
`importHysabKytab` hardcoded `currency: "AED"` when writing each account. HK's `.xlsx` export does not include a per-account currency field, so there is nothing to read from the file. The correct behaviour is to use the user's configured default currency from `dbConfig`, falling back to "AED" only when no config exists.

### Fix Applied
- **`src/lib/import/hysabKytab.ts`**: Read `dbConfig` at the start of import (`const userConfig = await db.dbConfig.get(userId)`); derive `defaultCurrency = userConfig?.currency ?? "AED"`; use that for every imported account.

### Regression Tests
- `settings.test.ts`: `importHysabKytab_UserCurrencyPKR_AccountsImportedAsPKR`
- `settings.test.ts`: `importHysabKytab_NoConfig_AccountsFallBackToAED`

### Prevention
- Never hardcode a user-configuration-dependent value (currency, locale, timezone) inside an import/export function. Always read it from the user's configuration record at the start of the operation.

---

## 2026-06-06 - All date range filters showed 0 results after HK import

### What Happened
After importing historical data (2018–2024) from Hysab Kytab, every date range preset (Today, This Week, This Month, etc.) showed 0 transactions. The user perceived this as broken filters.

### Root Cause
The imported data was all from 2018–2024 but the current date was June 2026. All presets filtered to the **current** calendar period (e.g. June 2026). There was no "All Time" option that would reveal historical data.

### Fix Applied
- **`src/types/index.ts`**: Added `"all"` to the `FilterPeriod` union type.
- **`src/lib/dateRange.ts`**: `getDateRange("all")` returns `{ from: new Date(0), to: new Date(8640000000000000) }`. `new Date(0)` as `from` produces `0` when passed through `.getTime()` — which is **falsy** — so `useTransactions`'s `if (from && t.date < from)` guard is skipped, showing all records regardless of age.
- **`src/components/transactions/TransactionFilters.tsx`**: Added "All Time" as the first option in the period `<Select>`.
- **`src/components/shared/DateRangePicker.tsx`**: Added "All" as the first preset button.

### Regression Test
- `settings.test.ts`: `getDateRange_All_FromIsEpochZeroSoFilterSkipped` — verifies `from.getTime() === 0` and `to` is far in the future.

### Prevention
- Any app that supports historical data import must have an "All Time" or equivalent period that bypasses date filtering. Add it at the same time as the import feature, not later.
- When `0` (epoch) is used to represent "no lower bound", document explicitly that `0` is falsy in JS and that the filter guard `if (from && ...)` correctly skips the check. Future developers must not change this guard to `if (from !== undefined && ...)`.

---

## 2026-06-06 - Firestore WriteBatch.set() throws on undefined fields from HK import

### What Happened
After importing Hysab Kytab data and triggering a Firestore sync, the sync failed with: `Function WriteBatch.set() called with invalid data. Unsupported field value: undefined (found in field categoryId in document users/…/transactions/…)`

### Root Cause
Two contributing causes:

1. **Explicit `undefined` in import**: `importHysabKytab` stored `categoryId: undefined` and `toAccountId: undefined` as explicit object keys. Dexie stores these fine (IndexedDB ignores `undefined` values), but when `syncAll` serialised these records and passed them to `batch.set()`, the Firebase SDK treated the explicit `undefined` as an invalid value and threw.

2. **No sanitisation in sync**: `syncCollection` passed the raw Dexie record directly to `batch.set()` without stripping optional undefined fields.

### Fix Applied
- **`src/lib/import/hysabKytab.ts`**: Removed all explicit `property: undefined` assignments. Optional fields (`categoryId`, `toAccountId`, `place`) are now conditionally spread with `...(value ? { key: value } : {})` so they only appear in the stored object when they have a real value.
- **`src/lib/db/sync.ts`**: Added a sanitisation step in `syncCollection` before every `batch.set()` call: `const clean = Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined))`. This is a defence-in-depth guard for any records that may have accumulated `undefined` fields before the fix.

### Regression Test
- `sync.test.ts`: `syncAll_TransactionWithUndefinedCategoryId_DoesNotPassUndefinedToFirestore` — seeds a transaction without `categoryId`, calls `syncAll`, asserts that every document passed to `batch.set` has no `undefined` values.

### Prevention
- The Firestore JS SDK forbids `undefined` field values. Never store `property: undefined` in objects destined for Firestore. Use `...(value ? { key: value } : {})` for optional fields.
- Always sanitise `undefined` fields in the sync layer as a defence-in-depth measure — callers may not always produce clean objects.
- Note: this is distinct from Firestore `deleteField()` (which removes an existing field). Passing `undefined` is simply rejected; use `deleteField()` if you intentionally want to remove a field from an existing document.
