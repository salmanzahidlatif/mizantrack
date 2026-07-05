# Work Plan: UI/UX Polish — Mobile-First Visual Redesign

**Version:** 1.0  
**Last Updated:** 2026-07-04  
**PRD Reference:** docs/ui-ux-polish/prd.md  
**Design Reference:** docs/ui-ux-polish/design.md  

---

## Vision & Metrics

**Vision:** For MizanTrack users who primarily use the app on their phones who find taps unreliable and the UI visually flat, the UI/UX Polish feature is a mobile-first visual refresh that makes every tap feel immediate, every async operation visible, and the overall design feel like a premium finance app.

**Success Metrics:**

| Metric | Target |
|---|---|
| Tap feedback visible on all interactive elements | 100% |
| Loading skeleton present for all async data views | 100% |
| Minimum tap target size (≥ 44×44px) | 100% compliance |
| Animations disabled with `prefers-reduced-motion` | 100% |
| Drawer open/close @ 60fps on mid-range Android | Confirmed in device test |
| User-reported "tap not registered" incidents | 0 after primary user testing |

---

## Summary: 2 Epics · 8 Stories · 2 Sprints

---

## Epic E1: Design System & Visual Polish

**Description:** CSS tokens, glassmorphic surfaces, shadows, and touch feedback — the visual foundation that everything builds on.  
**Business Value:** Establishes the consistent visual language; makes the app look and feel premium on first glance.  
**Priority:** High

---

### Story US-001: CSS Design Tokens & Global Touch Rules

**As a** developer **I want** CSS custom properties for shadows and animations and global touch rules **so that** all components share a consistent visual language and there is no 300ms tap delay.

**Acceptance Criteria:**
- [ ] `globals.css` defines `--shadow-card`, `--shadow-overlay`, `--shadow-modal` for both light and dark modes (values per §12.1 of design.md)
- [ ] `--anim-fast: 80ms`, `--anim-normal: 200ms`, `--anim-slow: 300ms` defined
- [ ] `touch-action: manipulation` and `-webkit-tap-highlight-color: transparent` applied globally to all `button`, `a`, `[role="button"]` elements
- [ ] Global `min-height: 44px; min-width: 44px` on all interactive elements
- [ ] `@media (prefers-reduced-motion: reduce)` rule disables all animations and transitions globally
- [ ] Tailwind v4 `@theme` block exposes `shadow-card`, `shadow-overlay`, `shadow-modal` as utility classes
- [ ] Verify: tapping a button on iPhone shows no default blue flash (replaced by custom active state)

**Design Reference:** §12.1, §12.2 of docs/ui-ux-polish/design.md  
**Technical Notes:** All changes in `src/app/globals.css`. The `@theme` block must come after `@import "tailwindcss"` in the file. Test `prefers-reduced-motion` via Chrome DevTools → Rendering → Emulate CSS media feature.  
**Dependencies:** None  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

### Story US-002: Button & List Row Touch Feedback

**As a** user on mobile **I want** every tap on a button or list row to give immediate visual feedback **so that** I always know my tap was registered.

**Acceptance Criteria:**
- [ ] All `<Button>` components scale to 95% on press (`active:scale-95`) and return to 100% on release
- [ ] Transition is `duration-75` (75ms) — fast enough to feel instant
- [ ] All transaction list rows show a subtle background highlight on press (`active:bg-muted/50`)
- [ ] All account cards show the same active highlight on press
- [ ] Disabled buttons show `opacity-50 cursor-not-allowed` and do NOT scale on press
- [ ] Visual regression: pressing button on device — visible press-down effect confirmed
- [ ] `cursor-pointer` present on all interactive elements for desktop users

**Design Reference:** §12.3, §7 of docs/ui-ux-polish/design.md  
**Technical Notes:** Add `active:scale-95 transition-transform duration-75 touch-manipulation [-webkit-tap-highlight-color:transparent]` to `button.tsx` cva base class. Add `active:bg-muted/50 transition-colors duration-75` to `TransactionRow` wrapper div.  
**Dependencies:** US-001  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

### Story US-003: Glassmorphic Header & Bottom Navigation

**As a** user scrolling through transactions **I want** the header and bottom nav to have a frosted-glass appearance **so that** the app feels layered and modern.

**Acceptance Criteria:**
- [ ] App header: `bg-background/80 backdrop-blur-sm` — frosted-glass effect when content scrolls beneath it
- [ ] Bottom nav: same treatment + `pb-[env(safe-area-inset-bottom,0px)]` to clear iPhone home indicator
- [ ] `@supports (backdrop-filter: blur(1px))` CSS fallback: solid `bg-background` on unsupported browsers
- [ ] Header and nav remain fully legible in both light and dark mode
- [ ] Device test: iPhone — header is frosted; home indicator not obscured by nav

**Design Reference:** §12.6, §5 of docs/ui-ux-polish/design.md  
**Technical Notes:** Glassmorphic treatment is two class additions only — `bg-background/80 backdrop-blur-sm`. No new component. The `env()` safe area value defaults to `0px` on browsers that don't support it.  
**Dependencies:** US-001  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

### Story US-004: Shadow System on Cards, Drawers & Dialogs

**As a** user **I want** financial cards and overlays to have depth shadows **so that** the visual hierarchy makes it clear what's interactive, what's floating, and what's modal.

**Acceptance Criteria:**
- [ ] All account cards and balance cards have `shadow-card` class applied
- [ ] Transaction drawer and all `Drawer`/`Sheet` components have `shadow-overlay`
- [ ] All `Dialog` components (import result, export, Firebase reset confirm) have `shadow-modal`
- [ ] Shadows render correctly in dark mode (darker, more contrast as per design tokens)
- [ ] No existing test fails from the class additions

**Design Reference:** §12.1, §5 of docs/ui-ux-polish/design.md  
**Technical Notes:** `shadow-card` → `AccountCard`, `BalanceCard`. `shadow-overlay` → `DrawerContent` in `components/ui/drawer.tsx`. `shadow-modal` → `DialogContent` in `components/ui/dialog.tsx`. These are shadcn/ui primitive files — add classes to the component variant rather than every callsite.  
**Dependencies:** US-001  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

## Epic E2: Loading States & Interaction Completeness

**Description:** Skeletons for every async view, animated sync badge, and tap-target compliance audit.  
**Business Value:** The app never looks broken or frozen — every state is explicitly designed.  
**Priority:** High

---

### Story US-005: Skeleton Loading Components

**As a** user opening the app **I want** meaningful placeholder shapes while data loads **so that** I never see raw zeros or blank spaces that make the app look broken.

**Acceptance Criteria:**
- [ ] `SkeletonBalance` renders N balance card skeletons matching real card dimensions
- [ ] `SkeletonTransactionRow` renders N transaction row skeletons matching real row dimensions
- [ ] `SkeletonChart` renders a full-width skeleton at configurable height
- [ ] All skeletons use `animate-pulse bg-muted rounded` (no custom CSS needed)
- [ ] Skeletons render in both light and dark mode without visible content flash

**Design Reference:** §12.4 of docs/ui-ux-polish/design.md  
**Technical Notes:** Three new files: `src/components/shared/SkeletonBalance.tsx`, `SkeletonTransactionRow.tsx`, `SkeletonChart.tsx`. Each accepts a `count` or `height` prop per §12.4.  
**Dependencies:** None  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

### Story US-006: Wire Skeletons Into All Async Views

**As a** user **I want** every data-driven view to show a skeleton while loading **so that** the app always communicates state clearly.

**Acceptance Criteria:**
- [ ] `BalanceCards`: shows `<SkeletonBalance count={3}>` when `accounts === undefined`
- [ ] `TransactionList`: shows `<SkeletonTransactionRow count={5}>` when `transactions === undefined`
- [ ] `TrendBarChart` (dashboard): shows `<SkeletonChart height={160}>` while data loads
- [ ] `CategoryBreakdownChart` (reports): shows `<SkeletonChart height={200}>` while data loads
- [ ] `RecentTransactions` (dashboard): shows `<SkeletonTransactionRow count={3}>` while loading
- [ ] No component renders `0` or blank space for a loading state anywhere on the app

**Design Reference:** §6, §12.4 of docs/ui-ux-polish/design.md  
**Technical Notes:** Pattern: `if (data === undefined) return <Skeleton...>; if (data.length === 0) return <EmptyState>; return <RealComponent>`.  
**Dependencies:** US-005  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

### Story US-007: Sync Status Badge Animation

**As a** user triggering a sync **I want** to see a spinner while syncing and a checkmark on completion **so that** I know exactly when the sync has finished.

**Acceptance Criteria:**
- [ ] `SyncStatusBadge` has 4 visual states: `idle`, `syncing`, `success`, `error`
- [ ] `syncing`: `<Loader2 className="animate-spin">` icon replaces the cloud icon
- [ ] `success`: `<Check>` icon + "Synced" text, auto-transitions to `idle` after 2000ms
- [ ] `error`: `<CloudOff>` icon; toast is also shown by `AppShell` (existing behaviour)
- [ ] `idle`: cloud icon + "Synced X mins ago" (or "Never synced" if no `lastSync`)
- [ ] All state transitions are driven by `useSyncStore` reactive values
- [ ] Animation respects `prefers-reduced-motion` (icon changes still occur; spin/fade animations disabled)

**Design Reference:** §12.5 of docs/ui-ux-polish/design.md  
**Technical Notes:** Derive `SyncBadgeState` from `useSyncStore({ syncing, lastSync, error })`. Use a local `useState<'success' | null>` with a `useEffect` and `setTimeout(2000)` to flash the checkmark.  
**Dependencies:** None  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

### Story US-008: Tap Target Audit & Compliance

**As a** user with average-sized fingers **I want** every tappable element to be large enough to hit reliably **so that** I never have to try multiple times to tap something.

**Acceptance Criteria:**
- [ ] Lighthouse / axe tap target audit passes with 0 violations (or all violations fixed)
- [ ] All bottom-nav icons and labels together form a ≥ 44px tall tap area
- [ ] All form field labels have associated inputs (label `for` / `htmlFor`) — no orphaned labels
- [ ] All icon-only buttons have accessible labels (`aria-label` or `title`)
- [ ] `cursor-pointer` on all interactive elements confirmed via visual check on desktop
- [ ] No interactive element smaller than 44×44px remains after this story

**Design Reference:** §7 (Touch Feedback System), §12.1 of docs/ui-ux-polish/design.md  
**Technical Notes:** Run `npx axe-core` or use Chrome DevTools Lighthouse. Common fixes: wrap icon buttons in a `<button>` with `p-2` padding to increase hit area; add `aria-label` to icon-only buttons.  
**Dependencies:** US-001  
**Estimated Effort:** 0.5d  
**Priority:** Should Have

---

## Sprint Plan

### Sprint 1: Design System Foundation
**Duration:** 1 week  
**Sprint Goal:** CSS tokens in place, touch feedback on all interactive elements, glassmorphic surfaces, shadow system, sync badge animated.

| ID | Title | Effort | Priority | Status |
|----|-------|--------|----------|--------|
| US-001 | CSS Design Tokens & Global Touch Rules | 0.5d | Must | ✅ DONE |
| US-002 | Button & List Row Touch Feedback | 0.5d | Must | ✅ DONE |
| US-003 | Glassmorphic Header & Bottom Nav | 0.5d | Must | ✅ DONE |
| US-004 | Shadow System on Cards, Drawers & Dialogs | 0.5d | Must | ✅ DONE |
| US-007 | Sync Status Badge Animation | 0.5d | Must | ✅ DONE |

**Capacity:** 5d | **Committed:** 2.5d *(remaining days for device testing on iPhone + Android)*

### Sprint 2: Loading States & Accessibility
**Duration:** 1 week  
**Sprint Goal:** All async views show skeletons; tap targets compliant; no blank/zero loading states remain.

| ID | Title | Effort | Priority | Status |
|----|-------|--------|----------|--------|
| US-005 | Skeleton Loading Components | 0.5d | Must | ✅ DONE |
| US-006 | Wire Skeletons Into All Async Views | 1d | Must | ✅ DONE |
| US-008 | Tap Target Audit & Compliance | 0.5d | Should | ✅ DONE |

**Capacity:** 5d | **Committed:** 2d *(remaining days for cross-browser testing, `backdrop-filter` Android benchmark, and final visual polish)*

---

## Dependencies & Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `backdrop-filter` causes scroll jank on low-end Android | Medium | Benchmark on Snapdragon 6xx before Sprint 1 ships; fallback to `@supports` disabling it below threshold |
| `active:scale-95` conflicts with Vaul drawer drag gesture (dragging could trigger scale) | Low | Only apply to `<Button>` elements; Vaul's drag handle is a `<div>`, not a `<button>` |
| Tailwind v4 `@theme` syntax differs from v3 — may need adjustment | Low | Confirmed as correct via project setup (`tailwindcss v4` + `@tailwindcss/postcss`) |
