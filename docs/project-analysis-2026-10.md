# MizanTrack — Project Knowledge Base (for agents)

> **Purpose.** A single orientation document so any agent can understand MizanTrack
> without re-reading the whole tree. Pairs with `ui-ux-improvement-plan-2026-10.md`
> (the actionable plan). Written 2026-10-29. If this drifts from the code, trust the
> code and update this file.
>
> **Read this first, then** `AGENTS.md` (⚠️ Next.js 16 has breaking changes — read
> `node_modules/next/dist/docs/` before writing framework code) and the deep docs it
> points to (`docs/prd.md`, `docs/lessons-learned.md`, `docs/engineering-log-2026-10.md`,
> `docs/design.md`, `docs/ui-ux-polish/`, `docs/pwa-offline-notes.md`).

---

## 1. What the app is

A **privacy-first, offline-first PWA personal-finance tracker**. Defining choice: there is
**no shared backend** — each user optionally syncs to **their own Firebase/Firestore
project**. All financial computation is client-side. Deployed at `mizantrack.vercel.app`.
Inspired by (and imports/exports) Hysab Kytab (HK).

**Non-negotiable product constraints** (`prd.md`):
- Privacy-first: no MizanTrack server stores financial data; PII (name/email/avatar) is
  display-only, never written to Firestore.
- Offline-first: 100% of core CRUD + reports work offline after first load.
- User-owned Firebase: sync is opt-in; config pasted as JSON, stored in Dexie `dbConfig`
  (never localStorage/cookies, never sent to any app server).
- Per-user isolation: everything scoped by `userId` (Dexie + Firestore `/users/{userId}/…`).
- **Multi-currency with NO forced conversion.** Amounts stored as entered. **No displayed
  total may ever sum unrelated currencies.** Exchange rates are used only in summary/Zakat
  views.
- Single-user (not collaborative), no bank feeds, no investments, no server-side processing.

## 2. Tech stack

| Layer | Tech |
|---|---|
| Framework | **Next.js 16** (App Router, `--webpack` build) + **React 19** |
| Language | TypeScript (strict, zero-error gate) |
| Auth | NextAuth v5 (beta) + Google OAuth, **no DB adapter** |
| Local DB | **Dexie / IndexedDB** (source of truth) via `dexie-react-hooks` `useLiveQuery` |
| Cloud sync | Firebase Firestore (user-supplied), opt-in |
| UI | shadcn/ui (`radix-nova` style) + Radix + **Tailwind CSS v4** |
| State | **Zustand** (UI/session state only — never financial data) |
| Forms | React Hook Form + Zod |
| Charts | Recharts (lazy-loaded) |
| Lists | `@tanstack/react-virtual` (transactions list only) |
| PWA | `@ducanh2912/next-pwa` (Workbox) — **not** `next-pwa@5` |
| Export/Import | SheetJS (`xlsx`); `.db` (sql.js) import/export preferred |
| Dates | `date-fns` |

## 3. Repo map

```
src/
  app/
    (app)/            # protected routes; each page.tsx is a thin server shim → *PageClient
      dashboard|transactions|accounts|categories|budgets|reports|zakat|settings/
      layout.tsx      # → AuthenticatedAppShell (client)
    (auth)/login/
    api/auth/[...nextauth]/ , api/google-sheets/{status,token,disconnect}/
    globals.css       # ⚠️ ALL design tokens live here (Tailwind v4 @theme block)
    layout.tsx, error.tsx, global-error.tsx, offline/, privacy/, terms-of-service/
  components/
    ui/               # 22 shadcn primitives (button, card, drawer, dialog, sheet, …)
    layout/           # AppShell, BottomNav, SyncStatusBadge, LockScreen, CurrencySelector…
    shared/           # EmptyState, CurrencyAmount, Skeleton*, FieldSwitch…
    transactions/ accounts/ categories/ budgets/ dashboard/ reports/ zakat/ charts/
    settings/ (15 files) auth/ marketing/ icons/
  hooks/              # 25 hooks = the data layer (useLiveQuery wrappers + analytics cache)
  store/              # 5 Zustand stores: ui, filter, privacy, lock, sync
  lib/
    db/               # local.ts (Dexie schema v15), sync.ts (~1900 LOC), firebase.ts, reset.ts
    actions/          # transactions.ts (validated write boundary), accounts, categories…
    analytics/        # balanceMath, periodAnalytics, cache, cacheMetadata (the perf layer)
    zakat*.ts         # ~15 files — the richest domain
    export/ import/ reports/ sheets/ validations/ + utils, currencies, dateRange, motion…
  types/index.ts      # all domain interfaces, heavily doc-commented
  test/               # Vitest suites (invariant-focused)
docs/                 # design docs, PRD, lessons-learned, engineering log, zakat specs
```

## 4. Architecture — how it actually works

**Page wiring (uniform "PageClient" pattern).** Every `src/app/(app)/*/page.tsx` is a thin
server component with `export const dynamic = "error"` that renders one `*PageClient`
(client). The whole authenticated app is client-rendered (offline-first requires it);
there are **no RSCs doing data work**. `(app)/layout.tsx` → `AuthenticatedAppShell` →
`OfflineAuthProvider` → `RequireOfflineUser` → `AppShell`.

**Data layer = Dexie `useLiveQuery` wrapped in 25 custom hooks** (`src/hooks/`). Components
call domain hooks (`useTransactions`, `useAccounts`, `useBudgets`, `useDbConfig`, …), not
`useLiveQuery` directly. Writes go through `src/lib/actions/*` (validated, bounded, visible
errors) — not raw Dexie calls in components.

**Zustand = UI/session state only.** Five small stores: `ui-store` (drawer open/edit ids),
`filter-store` (period/currency/search, persisted to localStorage, SSR-safe), `privacy-store`
(`hideAmounts`), `lock-store` (PIN/lockout), `sync-store` (sync status/progress/error).
**No financial data in Zustand.**

**Balances are DERIVED, never stored.** `balance = openingBalance + income − expense −
transfer(src) + transfer(dest)`. Core invariant: never "repair" a wrong balance by editing
stored opening balances (`lessons-learned.md`).

**Sync model** (`lib/db/sync.ts`): server-authoritative cursor + local dirty flag. Local
writes set `pendingSync: true` (Dexie create/update hooks in `local.ts`); pushes stamp
Firestore `serverTimestamp()` as `syncedAt`; pulls query `where("syncedAt", ">", cursor)`.
**Per-table watermarks** (`lastSync:accounts|…`). `updatedAt` (device wall-clock) is for
last-write-wins conflict resolution only — **never** as the distributed cursor. Quota-aware
of Firestore free tier (20k writes/50k reads per day); auto-sync every 15 min, skips hidden
tabs. `LOCAL_ONLY_RECORD_FIELDS` strips device-local fields before push.

**Auth.** NextAuth v5, no DB adapter. A `jwt` callback pins `token.sub =
account.providerAccountId` (Google's stable numeric ID) so the Firestore path is stable
across devices. `session.user.id` must look numeric, not a UUID. Offline identity uses a
locally-persisted validated user snapshot (identity only, never tokens).

**Analytics cache (the headline perf system)** (`lib/analytics/`, hooks
`useCachedAnalyticsValue`). Dashboard aggregation was **21,392 ms** on ~10k txns (rescanning
every render); a version-stamped, precisely-invalidated Dexie-persisted cache brought it to
**69.89 ms**. Entries carry `logicVersion` + deterministic `dataVersion`. **Rule: the cache
affects speed, never liveness/correctness** — a cache miss must never leave a screen stuck on
skeletons.

**PWA.** `@ducanh2912/next-pwa` + Workbox. App routes build as static client shells so they
render offline. API/Google/Firebase requests are **NetworkOnly** (never cached). `/offline`
fallback. SW correctness is verified against a production build + real offline cold start,
not just registration state.

## 5. Data model (`src/types/index.ts`)

Core: `Account` (asset|liability, per-currency, `sourceId` for idempotent re-import),
`Category` (Income|Expense, hierarchy via `parentId`), `Transaction` (Expense|Income|
Transfer; amount always positive; `toAccountId` for transfers; `recurrenceId` groups a
materialised series), `Budget` (per `YYYY-MM`). `DbConfig` holds Firebase config, enabled
currencies, PIN/biometric, `hideAmounts` (+ deprecated gold-API fields kept unwritten).

**Zakat** (the deepest domain): works in the **Islamic lunar calendar**. `ZakatYearOverride`
stores only inputs (1-Ramaḍān anchor + carry-forward); the 12 months are always recomputed.
Gold is modelled **per-year and per-piece with cross-year lineage** (`ZakatGoldYearItem`,
`lineageId`) so selling/buying a piece never rewrites past years. Silver is one weight/one
price per year. `ZakatCalculation` is a saved snapshot. Assessment takes the **minimum month
that actually held something** (ignores pre-account zero months) + gold/silver value × rate.

**Reports** (fiscal): user-tagged transactions, projects (property/"plot" payments), salary
grid, manual entries. All report aggregates are **runtime-only, never persisted**.

**Convention:** deprecated fields are kept but never written, so old synced records (in users'
own clouds you can't centrally migrate) still read back intact. `sourceId` is external-system
identity for idempotent re-import — never a primary key.

## 6. Dexie schema (`src/lib/db/local.ts`) — currently **v15**

Cumulative versions; each spreads the previous. 18 tables. Highlights: v7 added
`[userId+date]` compound index (bounded range queries), v10 currency-scoped zakat (with
idempotent backfill), v14 per-year gold items (backfill from shared inventory), v15 added
`[userId+recurrenceId]` for series edit/delete. `MIZAN_TRACK_DEXIE_VERSION = 15` is pinned by
a test against the DB's `verno`. Dexie create/update **hooks** stamp `pendingSync: true`
(suppressible via `withoutSyncDirtyTracking`). Handles multi-tab `blocked`/`versionchange`.

## 7. Design system (already mature — see the UX plan before changing)

Everything lives in **`src/app/globals.css`** (Tailwind v4 `@theme`) mirrored by
`src/lib/motion.ts`:
- **Color:** oklch token system (background/foreground/card/primary/muted/border/…),
  light + dark. **Exception (intentional):** financial-status colors are hardcoded Tailwind
  shades, used consistently — income=emerald, expense=red, transfer=blue, warning=amber.
  These are **not yet tokenized** (literal across ~15 files).
- **Radius:** `--radius` (0.625rem) → derived `--radius-sm..4xl`.
- **Shadows:** `--shadow-card|sheet|fab|nav|overlay|modal` (dark-mode-aware). Mapping is
  mandatory: Cards → `shadow-card`, Sheets/Drawers → `shadow-overlay`, Dialogs → `shadow-modal`.
- **Motion:** easing tokens (`--ease-spring`, `--ease-out-expo`, `--ease-ios`), durations
  (`--dur-fast/base/slow`, `--anim-fast/normal/slow`). Utilities: `press`/`press-scale`,
  `tappable`, `slide-up-sheet`, `fade-scale-in`, `list-item-in`, `page-enter`, `shimmer`,
  `pop`, `pulse-soft`. **Signature effect:** `liquid-glass-nav` / `liquid-glass-pill` (bottom
  nav) + `material-blur`/`material-thick` frosted surfaces. All `motion-reduce`-aware.
- **Touch/PWA:** global 44×44px min tap targets, `touch-action: manipulation`, transparent
  tap highlight, safe-area utilities (`pt-safe`, `pb-safe-nav`, …), `@supports` fallback for
  `backdrop-filter`.

**A UI/UX polish sprint is already COMPLETE** (`docs/ui-ux-polish/workplan.md`, all 8 stories
✅): tokens, touch feedback, glass nav, shadow system, skeletons, sync-status state machine,
tap-target audit. **Do not redo these.** Aesthetic goal: "premium finance app," native/iOS
feel, glassmorphic depth — **not** a brand redesign.

## 8. Quality gates & testing

- `npm run validate` = `typecheck` (tsc strict, 0 errors) + `lint` (`eslint --max-warnings 0`)
  + `format:check`. `npm run build` must be warning-free. `npm run test` = Vitest.
- **Tests encode INVARIANTS, not example outputs**: money conservation, transfer-leg
  symmetry, currency separation (no cross-currency totals), cache liveness, real offline cold
  start. Add ≥1 invariant test per financial bug. No tolerated flaky tests.
- ⚠️ Unit tests have passed while real-data regressions shipped — **also verify by booting the
  app and against real data**, especially for sync, server/client boundaries, and offline.

## 9. Known pitfalls — do NOT repeat (from `lessons-learned.md` / engineering log)

1. **Computation scope ≠ display scope.** Never fix a layer bug by removing currency scoping
   globally — it instantly produces cross-currency totals. (#1 repeated rule.)
2. **Transfers without `toAccountId` destroy money.** Importers must never write ledger-invalid
   records silently; import ambiguous rows as visible one-sided Income/Expense.
3. **Never hardcode config-dependent values** (e.g. currency) in import/export — read `dbConfig`.
4. **Firestore rejects `undefined` field values** — omit optional keys / sanitize before `set()`.
5. **`useLiveQuery(get())` returning `undefined` is ambiguous** (loading vs absent) — pair with a
   one-shot `db.table.get()`. **`Dexie.update()` returns 0 when the row is absent** — upsert.
6. **PWA:** don't add `/` to `additionalManifestEntries` (duplicate precache revision →
   Workbox swallows the error → SW "activated" but 0 precache entries → white screen offline).
   Keep `serviceWorkerManifest.test.ts`. Never guard `withPWA` on `isDev`. next-pwa@5 is dead on
   Next ≥14.
7. **Vaul drawer:** snap points push pinned footers off-screen — use `handleOnly` +
   `closeThreshold` for complex forms. Don't put `active:scale-95` on the drag handle.
8. **Radix `DialogContent` requires `DialogDescription`** or an a11y warning fires.
9. **Server/client boundary:** `@/lib/export.ts` imports Dexie at module scope — reaching it
   from server route code is fatal and **not caught by build/tests**. Verify by booting.
10. **Parallel agents sharing a worktree:** never run bulk `checkout/stash/reset/clean` — it has
    destroyed another agent's WIP. Use isolated worktrees for parallel edits.

## 10. Outstanding risks / in-flight (as of 2026-10-29)

- **HIGH (security, unfixed):** setup docs instruct Firestore rules `allow read, write: if true`
  on `/users/**` and the Firebase web config is public → synced financial records **and
  `pinHash`** are exposed to anyone who finds the project id. "Each user owns a private project"
  is **not** a sufficient boundary. Do not recommend Firebase sync broadly until proper authz /
  token broker exists.
- **In-flight uncommitted work** (git status): **recurring transactions** (`lib/recurrence.ts`,
  schema v15, bulk-edit + selection-mode UI) and **zakat silver** — both with tests. Do not
  disturb without coordinating.
- Cross-device records may take several syncs to appear (forced server reads were reverted as
  too expensive). Cosmetic React hydration warning #418 on offline cold start.
