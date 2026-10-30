# MizanTrack — UI/UX, Design-System & Performance Improvement Plan

> **Companion to** `project-analysis-2026-10.md` (read that first for architecture/constraints).
> Written 2026-10-29. This is a **plan**, not a changelog — items are proposals, each with a
> risk level and explicit guardrails. Nothing here should ship without passing
> `npm run validate && npm run test` **and** a visual check in the running app.

## Guiding principle

The app already completed a UI/UX polish sprint (tokens, glass nav, shadows, skeletons,
motion, 44px tap targets — all ✅). So this plan is **consolidation + hardening, not a
redesign**: apply the existing design system *consistently*, remove duplication, and cut
render cost — **without changing how anything looks or behaves**. We use the `ui-ux-pro-max`
skill/plugin for design-system guidance, but the visual language stays as-is.

## Hard guardrails (must not break)

- **No new npm packages.** CSS + Tailwind utilities only (project rule). No animation/glass lib.
- **No new pages/features, no brand or dark/light-theme redesign.** Out of scope by PRD.
- **No View Transitions API** (insufficient iOS Safari support — explicitly out of scope).
- **Preserve all design tokens in `globals.css`**; Tailwind v4 custom values go in `@theme`,
  not a config file.
- **Never remove focus rings.** Keep `aria-label`s, label associations, `motion-reduce`.
- **Keep ≥44×44px tap targets** and safe-area insets; keep the `@supports` `backdrop-filter`
  fallback.
- **Currency rule:** never render a cross-currency total; always go through `CurrencyAmount`.
- **Offline/PWA:** don't touch precache manifest, SW, or NetworkOnly rules as part of UI work.
- Verify every change in **light + dark** and on a **narrow (mobile) viewport**.
- Any component split or memoization must be **behavior-preserving** — no prop/semantics change.

---

## Workstreams (prioritized)

Priority = impact ÷ risk. Each item: **[risk]** + guardrail. Suggest shipping as small,
reviewable PRs per item, with before/after screenshots in light + dark.

### A. Design-system consistency (highest value, mostly low risk)

**A1. Tokenize financial-status colors.** `[low]`
Add semantic tokens in `globals.css` `@theme` + `:root`/`.dark`:
`--color-income`, `--color-expense`, `--color-transfer`, `--color-warning`, mapped to the
current emerald/red/blue/amber values **so rendered output is pixel-identical**. Then replace
the ~15-file literal spread (`TransactionRow.tsx:45-49` `TYPE_COLOR`, `RecentTransactions`,
`ImportPanel` ×22, `FirebaseSyncPanel` ×19, `BudgetList` ×19, `TransactionDrawer` ×10, …) with
the tokens. *Guardrail:* pick token values that equal today's shades in both themes; diff
screenshots to confirm no visual change. This is the single biggest consistency win.

**A2. Route all money through `CurrencyAmount`.** `[low–medium]`
Delete per-file formatters: `ImportPanel.tsx:57,79-80`, `ResetLocalDataPanel.tsx:43-46`,
`CategoryDrawer.tsx:137` (`formatCurrency`), `GoldItemsManager.tsx:122` (`.toLocaleString`),
and others. `CurrencyAmount` already handles masking (privacy), colorization, RTL symbols,
sr-only codes — the hand-rolled ones don't, so this also fixes latent `hideAmounts`/a11y gaps.
*Guardrail:* confirm each call site's currency + sign handling matches; watch Zakat (gold/
silver weights are **not** currency — don't convert those).

**A3. Replace hand-rolled buttons with `Button`/`buttonVariants` where layout allows.** `[low]`
58 raw `<button>`s across 31 files. Convert the ones that merely re-create button styling
(settings panels especially). *Keep* the legitimately custom ones (segmented month strip, nav
pills, icon-grid cells) but ensure they still carry `press-scale`/`tappable` + 44px + a11y
label. *Guardrail:* don't fight existing layouts; this is opportunistic, file-by-file.

**A4. Use the `Card` primitive on the dashboard.** `[medium]`
`DashboardPageClient` builds metric/budget cards as raw `<section>`/`<div>` with
`cn(CARD_SURFACE, …)` (`:530-560`, `:654`, `:698-701`). Migrate to `Card` for consistent
shadow/radius/padding. *Guardrail:* `Card` must render the same surface (`CARD_SURFACE`
already backs it) — verify spacing/shadow unchanged.

**A5. Standardize overlay choice (dialog vs drawer vs sheet).** `[medium]`
Three patterns are used inconsistently: `ui/drawer` (5 feature drawers), `ui/dialog` (9),
`ui/sheet` (2). Document a rule (e.g. mobile form → drawer, confirmation → dialog, settings
subpanel → sheet) and align obvious outliers (`CurrencyPicker`, `AccountIconPicker`).
*Guardrail:* behavior/focus-trap/escape must be preserved; respect the Vaul footer pitfall.

### B. Shared components / de-duplication (medium value, low–medium risk)

**B1. Extract `ListRow`.** `[medium]`
The `h-11 w-11 rounded-2xl` icon + `min-w-0 flex-1` text + right-aligned amount layout is
re-coded in `TransactionRow`, `RecentTransactions`, `AccountList`, `BudgetList`, `ZakatHistory`.
A shared presentational `ListRow` cuts drift. *Guardrail:* must be a pure refactor; the
virtualized `TransactionRow` keeps its exact DOM/height (`44`/`76`) — see C2.

**B2. Extract `FormDrawer` scaffold.** `[medium]`
Five drawers (`TransactionDrawer` 976, `BulkEditTransactionsDrawer` 425, `CategoryDrawer` 428,
`AccountDrawer` 282, `BudgetDrawer` 258) each rebuild header/scroll/footer around `ui/drawer`.
A shared wrapper (handling the Vaul `handleOnly`/`closeThreshold` footer pitfall once) reduces
risk across all forms. *Guardrail:* do this **after** the in-flight recurrence work lands to
avoid merge conflicts in `TransactionDrawer`.

**B3. Reuse `EmptyState` / `Skeleton*` instead of inline copies.** `[low]`
Dashboard re-implements empty states (`:714-720`, `:1019-1020`) and shimmer skeletons
(`WhatYouHaveSkeleton :360-394`, budget skeleton `:675-694`) that `EmptyState` / `SkeletonCard`
already cover. *Guardrail:* match dimensions so layout doesn't shift.

### C. Performance (high value; correctness-sensitive, so careful)

**C1. Split the three monoliths.** `[medium]`
`DashboardPageClient` (1041 LOC, 8+ inline sub-components), `TransactionDrawer` (976),
`ZakatPageClientEnhanced` (970, 29 memo/callback). Extract the already-internal
sub-components into their own files; `React.memo` the presentational ones (there is currently
**no `React.memo` anywhere**). *Guardrail:* pure mechanical extraction — identical props/
output; do Dashboard and Zakat **after** recurrence/silver WIP lands.

**C2. Memoize the hot transaction list.** `[medium]`
- `memo` `TransactionRow` (`:77`) — it's the virtualized row rendered on every scroll frame.
- Build `Map<id, Account>` / `Map<id, Category>` once in `TransactionList` and pass them down,
  instead of raw arrays + per-row `.find()` scans (`TransactionRow.tsx:94-108`).
- `useMemo` the `buildItems` call (`TransactionList.tsx:81`) — it rebuilds the whole item list
  (with `date format()` per txn) every render.
*Guardrail:* keep row height/DOM identical (virtualizer depends on it); verify sticky date
headers + stagger animation still work; add/confirm a perf invariant test.

**C3. Memoize Dashboard derived arrays.** `[medium]`
`DesktopMetricStrip`/`SummarySplitCard` compute `metrics`/`items` in the render body
(`:512-527`, `:588-649`); `selectedMonth` changes re-run the whole tree. `useMemo` these +
`memo` the presentational children (depends on C1). *Guardrail:* analytics correctness is
sacred — cache stays the data path; memoization is render-only.

**C4. (Watch, don't fix yet) long non-virtualized lists.** `[info]`
Only `TransactionList` is virtualized. `CategoryTree` (314 LOC) and report salary grids could
grow. Leave as-is at personal-finance scale; revisit if a user reports jank. Note in backlog.

**C5. (Watch) `useTransactions` over-fetch.** `[info]`
The `user-all` / category-only / type-only plans (`useTransactions.ts:156-199`) `toArray()` +
filter in JS. The Transactions page always passes a date range (hits `[userId+date]`), so this
is fine today; flag as a cliff at very large histories.

### D. Accessibility hardening (low risk, do alongside A/B)

**D1. `LockScreen` PIN input** (`LockScreen.tsx:338`) bypasses `ui/input`/`ui/label` — verify
it has an associated accessible label. `[low]`
**D2. User-chosen category colors** applied as inline `style={{color}}` (`TransactionRow.tsx:184`)
have no contrast guarantee on the muted row bg — ensure type is **also** signalled by sign/icon
(mostly already true); don't rely on color alone anywhere. `[low]`
**D3.** When converting raw buttons (A3), confirm every icon-only control keeps an `aria-label`.

### E. Explicitly NOT doing (and why)

- New visual theme / palette / logo — out of scope (PRD non-goal).
- Animation library / View Transitions — banned (no new deps; iOS Safari).
- Touching sync/PWA/SW/precache for cosmetic reasons — high blast radius (see pitfalls 6, 9).
- "Fixing" balances or currency scoping to simplify UI — would reintroduce money-destroying
  bugs (pitfalls 1, 2).
- The Firestore security issue — **real and HIGH**, but it's architecture/auth, not UI/UX;
  surfaced here only so it isn't forgotten. Needs its own decision from the owner.

---

## Suggested sequencing

1. **Phase 1 (safe, visible wins):** A1, A2, B3, D1 — token + formatter + a11y cleanup, no
   layout change. Lowest risk, immediately improves consistency.
2. **Phase 2 (structure):** A3, A4, B1 — primitive adoption + `ListRow`.
3. **Phase 3 (perf, after recurrence/silver WIP lands):** C2, C1, C3.
4. **Phase 4 (bigger refactors):** B2 `FormDrawer`, A5 overlay standardization.
5. **Backlog/watch:** C4, C5; separately escalate the Firestore security risk to the owner.

Each phase: one PR per item where possible, `validate` + `test` green, screenshots in light +
dark on mobile + desktop widths, and a boot-the-app smoke check (unit tests alone have missed
real regressions here).

## Open questions for the owner

1. **Scope confirmation:** is "improve UI/UX" strictly *consolidate the existing look* (this
   plan), or do you also want a *visual refresh* (new accent color, denser/looser spacing,
   restyled cards)? This plan assumes the former.
2. **Sequencing vs the in-flight work:** recurrence + zakat-silver are uncommitted in
   `TransactionDrawer`/zakat files. OK to start with Phase 1 (which avoids those files), and
   hold Phase 3 perf splits until they land?
3. **PR granularity:** many small PRs (easier review, slower) vs a few batched PRs per phase?
4. **Should the Firestore security risk be tracked here or in its own doc/issue?**
