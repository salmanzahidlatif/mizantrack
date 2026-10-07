# Engineering Log — 2026-09-29 to 2026-10-07

**Product:** MizanTrack — Next.js 16 + React 19 + Dexie/IndexedDB personal finance and zakat tracker PWA  
**Purpose:** Record production regressions, root causes, fixes, feature work, and open risks from the late September / early October recovery session.  
**Primary source:** git history, especially commit bodies. Where a detail came from current owner direction rather than a committed change, it is labelled as such.

---

## Read This Before Editing Finance Logic

This session exposed a pattern: several changes passed tests but failed against the owner's real financial data. Future work must preserve these invariants:

1. **A transfer must never destroy money.** If both legs are known and same-currency, debit one side and credit the other.
2. **No displayed total may sum unrelated currencies.** AED and PKR can be listed together only if not summed as one value.
3. **Computation scope is not display scope.** Balance computation may need all accounts to preserve transfer symmetry; the UI must still filter presentation by selected currency.
4. **Caches are optional acceleration.** A cache miss, stale entry, or invalid entry must never block rendering.
5. **Sync cursors must be server-authoritative.** Device clocks are not safe distributed counters.
6. **Derived data is not stored data.** Balances are recomputed; do not ask users to "fix" a computed balance by editing opening balances until the stored source records are proven wrong.

---

## Bug Fixes and Root Causes

### 1. Transactions page showed both currencies

**Commit:** `348bcff` — `fix(transactions): filter by the active currency context`

**Symptom**

The Transactions page displayed AED and PKR records together even when the app had an active currency selected. Account/category controls could also show values from the wrong currency.

**Investigation**

The hook `useTransactions` already supported a `currency` filter. The page component simply was not passing the active currency into the hook.

**True root cause**

`src/components/transactions/TransactionsPageClient.tsx` read filter state but ignored `activeCurrency` when calling `useTransactions`. That left `src/hooks/useTransactions.ts` with no currency context, so it returned records across every account.

**Fix**

`348bcff`:

- reads `activeCurrency` from `useFilterStore`;
- derives `currencyAccounts`;
- clears a selected account when it no longer belongs to the selected currency;
- passes `currency` to `useTransactions`;
- scopes `useCategories` and `TransactionFilters` to the selected currency.

**Prevention**

The page, filters, categories, and transaction query must all receive the same currency context. Any future hook with an optional currency filter needs a caller-side test proving the page actually passes it.

---

### 2. Transfer submit silently did nothing, then the PWA wedged

**Commit:** `23af589` — `fix(transactions): recover transfer submit failures`

**Symptom**

Submitting a transfer sometimes appeared to do nothing. In some paths the PWA then got stuck on a crash screen, especially around IndexedDB version upgrades with another tab open.

**Investigation**

The transfer drawer had several failure modes on the same submit path:

- destination accounts could be filtered down to an empty list;
- validation errors could attach to fields below the viewport or not surface as a toast;
- direct Dexie writes in the drawer did not give a bounded, validated action boundary;
- Dexie v3→v4 upgrade blocking had no helpful user-facing recovery.

**True root cause**

The UI and persistence layer treated invalid submit as a local form concern, but the user-visible action was "save this transfer." When the destination selector became empty or validation failed off-screen, the save button appeared broken.

**Fix**

`23af589`:

- added validated transaction actions in `src/lib/actions/transactions.ts`;
- routed create/update/delete through those actions from `src/components/transactions/TransactionDrawer.tsx`;
- added visible invalid-submit toast handling;
- added save/delete timeouts and safer error messages;
- restricted new transfer destinations to same-currency accounts while preserving legacy edit context;
- added Dexie `blocked` and `versionchange` event handling in `src/lib/db/local.ts` so stale tabs no longer wedge silently.

**Prevention**

Validation errors in a mobile drawer must be surfaced at the action level, not only beside fields. Storage upgrade events need user-visible recovery instructions: close other tabs, reload, then retry.

---

### 3. Money destroyed by the Excel importer

**Commit:** `8038ba0` — `fix(import): stop unpaired transfers from destroying money`

**Symptom**

The Hysab Kytab Excel importer drove a real Cash account to roughly **-500,000 PKR**. The owner then entered a fabricated opening balance of **532,154.23** to compensate. The commit body records a synthetic reproduction turning a true Cash balance of **378.09** into **-531,776.14**.

**Investigation**

Previous import work fixed transfer pairing order-dependence, but surplus / unpaired transfer rows still became `Transfer` records without a `toAccountId`.

**True root cause**

A MizanTrack transfer without `toAccountId` is financially invalid. Balance math interpreted it as:

- debit source account;
- credit no destination account.

That silently destroyed money. The importer preserved ambiguous HK rows as invalid transfers instead of representing them as visible one-sided adjustments that the owner could review.

**Fix**

`8038ba0`:

- improved HK pairing in `src/lib/import/hysabKytab.ts` with deterministic match keys and account-name complement scoring;
- stopped writing unmatched HK transfer rows as destination-less transfers;
- imports unmatched rows as visible Income/Expense by sign with `[HK unmatched transfer]` descriptions;
- added `src/lib/import/transferIntegrity.ts`;
- added a Settings Transfer Integrity Check that reports affected records and repairs only after explicit confirmation;
- updated balance hooks to skip known invalid transfer counterparties with warnings rather than silently draining accounts.

**Prevention**

Importers must never produce records that violate ledger invariants. Ambiguous source data should be preserved visibly and repaired explicitly, not hidden as a structurally invalid transfer.

---

### 4. Cross-device sync silently lost records

**Commit:** `19f214e` — generic message `few more bug fixes and category menu item added`; root-cause evidence is in the diff to `src/lib/db/sync.ts` and `src/lib/db/local.ts`.

**Symptom**

Records written on one device could fail to appear on another device, without a hard sync error.

**Investigation**

Sync queried remote records using a local `updatedAt` watermark. That value comes from each browser's wall clock.

**True root cause**

Device wall clocks were being used as a distributed version counter. If Device A's clock was slower than Device B's, a record written by A could have `updatedAt` below B's stored watermark. B would never pull it because it asked Firestore only for records newer than that watermark.

**Fix**

`19f214e` replaced the cursor model:

- Dexie hooks mark created/updated core records with `pendingSync`;
- push reads `pendingSync === true`, writes to Firestore, and clears the flag only after commit;
- Firestore writes include `syncedAt: serverTimestamp()`;
- pull queries `where("syncedAt", ">", cursor)` plus `orderBy("syncedAt")`;
- per-table cursor keys store the latest observed server `syncedAt`;
- `migrateTableToServerCursor` backfills / stamps existing remote records;
- sync results now include partial status and per-scope error details instead of one opaque failure.

**Prevention**

Use server time for "what has reached the server" and local dirty flags for "what must still be pushed." Never use browser clocks as the only pull cursor across devices.

---

### 5. Balances read -4,494,676.42

**Commit:** `9cbb789` — `fix(analytics): stop currency scoping from hiding accounts and breaking balances`

**Symptom**

The owner's Cash balance read **-4,494,676.42** after balance arithmetic was consolidated.

**Investigation**

Transfer validation and balance map construction used different account scopes.

**True root cause**

`hasInvalidTransferCounterparty` validated against all active accounts, but the balance map was seeded only with accounts matching the active currency. A transfer between an in-scope and out-of-scope account could therefore debit one side and credit nothing. The error scaled with transfer volume.

**Fix**

`9cbb789`:

- added `src/lib/analytics/balanceMath.ts`;
- computes balances from all active accounts;
- applies transfer legs symmetrically or not at all;
- keeps income/expense figures currency-scoped;
- trims and uppercases currency comparisons;
- keeps accounts with blank or unknown currencies visible with warnings.

**Prevention**

Balance computation must operate on the complete graph needed to preserve transfer symmetry. Currency filtering belongs in the analytics result / presentation layer.

---

### 6. Dashboard and accounts mixed AED and PKR into one total

**Commit:** `e93fe6f` — `fix(analytics): scope displayed balances to the selected currency`

**Symptom**

After `9cbb789`, the dashboard and Accounts screen listed AED and PKR accounts together, summed them into a single net worth, and rendered rows with the selected currency's symbol.

**Investigation**

The previous fix correctly widened computation scope but failed to re-apply display scope.

**True root cause**

The code confused two different concerns:

- **computation scope**: all active accounts are needed so transfer legs balance;
- **display scope**: only accounts in the selected currency should contribute to selected-currency totals.

**Fix**

`e93fe6f`:

- separated computation and presentation at the `aggregateAccountsAnalytics` boundary;
- keeps full-account balance computation;
- returns selected-currency `accounts`, `netWorth`, `inflow`, and `outflow`;
- renders each row with the account's own currency;
- groups blank/unknown/not-enabled currency accounts under "Other / Unknown currency";
- bumped analytics cache logic version so bad cached shapes are discarded.

**Prevention**

Repeat the durable rule in review: **computation scope ≠ display scope**. The test suite now includes no-cross-currency-total coverage in `src/test/currencyDisplayScope.test.tsx`.

---

### 7. Dashboard analytics took 21.4 seconds

**Commit:** `607dee6` — `perf(analytics): cache aggregates with precise invalidation`

**Symptom**

Dashboard account analytics took **21,392ms** on a 10,064-transaction dataset.

**Investigation**

The app had over-corrected after an earlier stale cache displayed **6,517** for a month whose true expense exceeded **10,000**. To avoid stale figures, analytics rescanned source rows on each render.

**True root cause**

The cache had no precise validity model. Removing or bypassing it made correctness easier, but performance unacceptable on the owner's dataset.

**Fix**

`607dee6`:

- added `src/lib/analytics/cache.ts`;
- added `src/lib/analytics/cacheMetadata.ts`;
- stamps entries with `logicVersion` and deterministic `dataVersion`;
- validates cache entries against current source data and aggregation logic;
- invalidates on transaction, account, opening balance, category, login, sync pull, and pull-to-refresh changes;
- reduced aggregation loop work.

Measured improvement in the commit body: **21,392ms → 69.89ms**.

**Prevention**

Financial caches must prove they match both current data and current logic. If not, recompute; never show a stale number as current.

---

### 8. Every analytics screen loaded forever

**Commit:** `6a7ebc7` — `fix(analytics): never block rendering on cache validation`

**Symptom**

Dashboard, Accounts, and analytics-backed screens could show skeletons forever.

**Investigation**

The hook rendered only when a cached entry validated. Recompute was guarded by a per-token set intended to prevent duplicate work.

**True root cause**

If a freshly written cache entry read back invalid, the recompute token was already marked used. The value stayed `undefined`, no retry happened, and the skeleton never cleared. The cache had become a correctness gate.

**Fix**

`6a7ebc7`:

- added `src/hooks/useCachedAnalyticsValue.ts`;
- keeps and renders freshly computed values directly;
- lets cache misses or version mismatches cost recomputation only;
- stores compute callbacks in refs to avoid effect churn from unstable identities.

**Prevention**

A cache may affect speed, never liveness. The UI must be able to render from a fresh computation even if every cache read/write fails.

---

### 9. Offline PWA showed a white screen / `ERR_FAILED`

**Commits:** `0ef6428`, `f891a92`, `d5cff5f`, `e0a28fc`, `da2ff05`

**Symptom**

The installed PWA opened to a white screen offline. In some cases going offline during an already-open session seemed to work, which made the failure misleading.

**Investigation and root causes**

Three separate causes were found in sequence:

1. **Routes required the network.** Server components and proxy/session reads made app routes dynamic.  
   - `0ef6428` moved session resolution client-side via an offline session snapshot.
   - `f891a92` moved page data loading into client components so routes could build static.
2. **Custom worker lookup missed revisioned entries.** Workbox precached documents under `?__WB_REVISION__`, while the custom navigation handler matched bare pathnames.  
   - `e0a28fc` fixed lookup with `ignoreSearch`.
3. **The real cold-start blocker: duplicate precache revisions.** `additionalManifestEntries` added `/` with the commit SHA, while next-pwa already precached the start URL with the build ID. Workbox threw `add-to-cache-list-conflicting-entries` inside the generated AMD `define()` wrapper. The throw was swallowed: the worker reported "activated", but `precacheAndRoute` and every runtime route silently failed to register.  
   - `da2ff05` removed the duplicate `/` entry.

**Fix**

After `da2ff05`, production verification showed the precache moving from **0 to 89 entries** and an offline cold start returning HTTP 200 and rendering.

**Prevention**

Do not trust service-worker registration state alone. Verify:

- `caches.keys()` and the relevant precache entry count;
- offline cold launch from the installed home-screen icon;
- no duplicate URLs with conflicting revisions in `public/sw.js`.

See `docs/pwa-offline-notes.md` for the focused Workbox notes.

---

### 10. Drawer dismissed while scrolling; submit button rendered below the viewport

**Commit:** `c046906` — `drawer fixes`

**Symptom**

On mobile, scrolling form content could dismiss the drawer. The submit footer could also appear below the visible viewport.

**Investigation**

Vaul snap points translate the drawer content box down by `(1 - activeSnapPoint) * innerHeight`. A bottom-pinned footer inside that translated content is physically pushed below the viewport.

**True root cause**

The drawer treated the whole content surface as a drag target and used layout assumptions that did not account for snap-point translation or keyboard/safe-area constraints.

**Fix**

`c046906`:

- passes `handleOnly` and a custom `closeThreshold` for transaction forms;
- makes the handle a larger explicit touch target;
- updates drawer content sizing and scrolling behaviour;
- adds `src/test/drawerDismissUx.test.tsx`.

**Prevention**

For Vaul bottom sheets, keep drag-to-dismiss on the handle for complex forms. Test with real mobile viewport heights, keyboard open, and content taller than the viewport.

---

### 11. Smaller but important UX regressions

| Bug | Commit | Root cause | Fix / prevention |
|---|---|---|---|
| Duplicate page headings on mobile | `2da88f4` | Both `AppShell` and page clients rendered headings. | Removed duplicate page headers across app client screens. |
| Account 3-dot menu navigated away | `5ecf9fc` | Overflow menu was nested inside the row's clickable navigation element, an invalid nested-interactive pattern. | Made tappable row and menu siblings; added `src/test/accountListMenu.test.tsx`. |
| Duplicate / glitchy dropdowns | `83b66c0` | `includeRecordsById` appended edited records without id de-duplication; Select content inside the drawer had poor positioning and viewport limits. | Ordered id-keyed union; portalled Select content with popper positioning and bounded height. |
| Stale transaction form after save / edit | `23af589` | Drawer local state did not reliably reset around open/close/edit transitions, and writes were direct Dexie calls. | Reset edit-only state on close, load legacy edit records explicitly, and route writes through transaction actions. |

---

## Features Delivered

### Multi-currency and category tagging

- `348bcff` aligned transaction page query scope with active currency.
- `9b0a13d` added opt-in category currency backfill in `src/lib/db/categoryCurrencyBackfill.ts` and `src/components/settings/CategoryCurrencyBackfillPanel.tsx`.
- The backfill tags a category only when all its transactions belong to accounts of one currency. Shared, unused, or explicitly set categories are left alone to avoid hiding them and orphaning transactions.

### Native-mobile UI system

- `4ef4ae1` added shared motion tokens in `src/lib/motion.ts` and safe haptic callbacks in `src/hooks/useHaptics.ts`.
- `bea1032` rebuilt the app shell around mobile-first navigation, liquid-glass bottom nav, contextual headers, and `src/hooks/useSwipeNavigation.ts`.
- `c046906` and `83b66c0` hardened drawer snap, keyboard, select, and scroll behaviour.

### UAE Dirham glyph

**Commit:** `2aed773`

Unicode assigned the new UAE Dirham sign at **U+20C3**, but current fonts have no coverage. The app therefore renders it as an inline SVG in `src/components/shared/DirhamSign.tsx`, inherited from current color and `em` sizing. Amount rendering uses bidi isolation so the symbol stays on the left instead of being reordered by the old RTL `د.إ` abbreviation.

### Historical analytics and month navigation

- `2592d2d` added arbitrary-period analytics in `src/lib/analytics/periodAnalytics.ts`: monthly, quarterly, half-yearly, yearly, all-time, per-category breakdowns, local-time boundaries, uncategorised slices, and single-currency totals.
- `a0764c1` added dashboard month navigation and swipe support.
- `07f5ea6` rebuilt dashboard, reports, and accounts around the new period API, including account summaries, interval chooser, month strip, and category donuts whose legends sum to the displayed total.

### Usage-ranked dropdowns and inferred category icons

**Commit:** `18262ef`

`src/lib/usageRanking.ts` ranks options by recent usage over a 183-day window with stable title tie-breaking. `src/lib/categoryIcons.ts` infers display icons by title only when no explicit icon is stored.

### Per-currency reset

**Commit:** `ded01cd`

`src/components/settings/ResetLocalDataPanel.tsx` and `src/lib/db/reset.ts` now support resetting one currency locally without touching other currencies, shared/untagged categories, settings, or zakat data. Cross-currency transfers touching the reset currency are removed so no orphaned transaction remains.

### Indexed transaction queries

**Commit:** `07f5ea6`

Dexie schema version 7 added `[userId+date]` on `transactions`. `src/hooks/useTransactions.ts` chooses a bounded `user-date` plan for date ranges. The regression test seeds **10,064** user rows plus other-user rows and verifies the monthly query scans **64** indexed candidates, not the whole table.

### Offline support

- `0ef6428`: offline session snapshot; no tokens stored locally.
- `f891a92`: app routes moved to client components and static build output.
- `d5cff5f`: custom worker/app-shell precache, update handling, NetworkOnly for API / Google / Firebase requests.
- `e0a28fc`: revisioned precache lookup fixed.
- `da2ff05`: duplicate precache revision conflict fixed.

---

## Current State and Open Items

### Owner decisions on record

The following are current owner decisions captured from the 2026-10-07 task context, even where older docs still show earlier alternatives:

- **Google Sheets backup:** one-way only, app → Sheets.
- **Google Sheets architecture:** token broker; financial data should not transit the app server.
- **Source IDs:** currency-scoped, e.g. `hk:PKR:account:19`.
- **Imports:** merge by source ID rather than wiping.
- **Preferred backup/import format:** `.db` import/export is preferred over Excel for durable round-trips.

### In flight as of 2026-10-07

These were described as active work and/or visible in the working tree, not necessarily committed:

- `.db` importer;
- budget feature;
- all-columns backup;
- Google Sheets implementation;
- duplicate-category merge;
- unpaired-transfer resolution at import time.

Do not assume these are complete without checking the current branch and tests.

### Known security finding — outstanding and unfixed

**Severity:** High for any shared Firebase project or leaked Firebase config.

The app documentation/setup flow has instructed users to deploy Firestore rules equivalent to:

```text
allow read, write: if true
```

on `/users/**`. With a public Firebase web config, that exposes synced financial records and `pinHash` to anyone who knows or can discover the project details.

Historical docs justified this by assuming each user owns a private Firebase project. That is not a sufficient security boundary if the config is present in the app or shared. Before recommending Firebase sync to anyone else, design proper authorization or move sync behind an authenticated backend / token broker. Do not bury this risk in setup docs.

### Known cosmetic issue

- React hydration warning **#418** on offline cold start. It is currently tracked as cosmetic, but verify before changing offline auth, service-worker startup, or first-render theme/session code.

---

## Lessons for Future Work

1. **Fix at the correct layer.** Removing currency scoping globally fixed missing transfer legs and then immediately created cross-currency totals.
2. **Tests must encode invariants.** Conservation of money, transfer-leg symmetry, and no cross-currency summing matter more than example snapshots.
3. **Flaky tests destroy signal.** The indexed-query perf test had to be made deterministic (`12d0fde`) because tolerated intermittent failures are how regressions pass unnoticed.
4. **Parallel agents need coordination around shared arithmetic.** Many agents edited shared files; balance arithmetic reached the user without the review it deserved.
5. **Silent failure modes are the most expensive.** Swallowed service-worker exceptions, fail-closed caches, and unrendered validation errors all caused long investigations.
6. **Verify against reality.** The decisive offline diagnosis came from reproducing a cold start and checking cache contents, not from unit tests alone.
7. **Derived data must stay derived.** If a recomputed balance looks wrong, inspect source transactions and account opening balances separately before changing stored data.

---

## Reference Commits

| Commit | Area |
|---|---|
| `348bcff` | Transactions active-currency filter |
| `23af589` | Transfer submit recovery, visible validation, Dexie upgrade handling |
| `8038ba0` | HK importer no longer writes destination-less transfers |
| `19f214e` | Server-authoritative sync cursor and `pendingSync` flags |
| `9cbb789` | Balance arithmetic invariant / all-active-account computation |
| `e93fe6f` | Selected-currency display scope |
| `607dee6` | Version-stamped analytics cache |
| `6a7ebc7` | Analytics cache cannot block rendering |
| `0ef6428`, `f891a92`, `d5cff5f`, `e0a28fc`, `da2ff05` | Offline PWA sequence |
| `c046906`, `83b66c0` | Drawer and dropdown mobile fixes |
| `2da88f4`, `5ecf9fc` | Duplicate headings and nested menu fixes |
| `4ef4ae1`, `bea1032`, `2aed773` | Native mobile UI and AED glyph |
| `2592d2d`, `a0764c1`, `07f5ea6` | Historical analytics, month navigation, rebuilt dashboard/accounts |
| `18262ef`, `9b0a13d`, `ded01cd` | Category ranking/icons, category currency tagging, per-currency reset |
