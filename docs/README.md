# MizanTrack Documentation Index

**Before starting work on this repository, read the relevant documents in `docs/`.** MizanTrack contains hard-won production lessons from real financial data; do not rely only on code search or tests.

## Start Here

- [`engineering-log-2026-10.md`](engineering-log-2026-10.md) — production regressions, root causes, fixes, features, open risks, and reference commits from the Sep/Oct 2026 recovery session.
- [`engineering-log-2026-10-09.md`](engineering-log-2026-10-09.md) — 9 October handover: outstanding Firebase security risk, zakat audit findings, sync state, data reconciliations, and parked branch work.
- [`lessons-learned.md`](lessons-learned.md) — durable engineering lessons and prevention rules. Read this before touching import, sync, analytics, balances, or PWA code.
- [`pwa-offline-notes.md`](pwa-offline-notes.md) — focused notes on offline cold-start failures and Workbox precache conflicts.

## Product and Architecture

- [`prd.md`](prd.md) — product requirements and user flows.
- [`design.md`](design.md) — technical architecture, data model, sync model, and implementation notes.
- [`workplan.md`](workplan.md) — implementation stories and historical sprint status.

## Existing Bug-Fix Writeups

- [`hk-import-fix-2026-06-22.md`](hk-import-fix-2026-06-22.md) — HK transfer pairing root cause and regression tests.

## Feature Areas

- [`multi-currency/`](multi-currency/) — multi-currency and country management PRD/design/workplan.
- [`app-lock/`](app-lock/) — PIN/biometric app-lock PRD/design/workplan.
- [`ui-ux-polish/`](ui-ux-polish/) — mobile-first visual redesign docs.
- [`cloud-sync-onboarding/`](cloud-sync-onboarding/) — cloud sync onboarding instructions.
- [`zakat-requirements-2026-10.md`](zakat-requirements-2026-10.md) — **authoritative zakat requirements** from the owner's October 2026 specification and `Zakat - All.xlsx`.
- Superseded zakat notes: [`ZAKAT-FEATURE-COMPLETE.md`](ZAKAT-FEATURE-COMPLETE.md), [`ZAKAT-QUICK-START.md`](ZAKAT-QUICK-START.md), [`zakat-enhancement-plan.md`](zakat-enhancement-plan.md). Keep them for history, but follow `zakat-requirements-2026-10.md` where they disagree, especially on nisab, yearly minimum/maximum basis, gold pricing, Islamic date boundaries, and implementation status.

## Google Sheets / Backup Planning

- [`google-sheets-backup-feasibility.md`](google-sheets-backup-feasibility.md)
- [`google-sheets-backup-design.md`](google-sheets-backup-design.md)
- [`google-sheets-backup-plan.md`](google-sheets-backup-plan.md)
- [`google-sheets-backup-questions.md`](google-sheets-backup-questions.md)

Check `engineering-log-2026-10.md` for the latest owner decisions before implementing; older planning docs may contain superseded recommendations.

## Safety Notes

- Do not sum balances across currencies unless an explicit conversion model exists.
- Do not write invalid transfers without a destination; preserve ambiguous import rows visibly.
- Do not treat cached analytics as a source of truth.
- Do not use device wall clocks as sync cursors.
- The Firestore rules guidance using `allow read, write: if true` is a known unfixed security risk; see the engineering log before touching sync onboarding.
