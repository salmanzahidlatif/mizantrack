# Engineering log — 9 October 2026 handover

This log captures findings from the long 9 October 2026 session. It is a handover document for the next engineer or agent picking up MizanTrack cold.

Distinguish proven findings from hypotheses. Several confident diagnoses during the session later turned out to be wrong.

## 1. Outstanding security issue — highest priority

**Status:** proven, outstanding, unfixed.

The highest-priority issue is still Firebase security.

`docs/engineering-log-2026-10.md:459-470` records that the app documentation/setup flow has used Firestore rules equivalent to:

```text
allow read, write: if true
```

on `/users/**`.

With the Firebase web config public in the app, those rules expose synced financial records and `pinHash` to anyone who knows or discovers the Firebase project details. This is not theoretical: the owner actively syncs two books of real financial data. The Firebase project ID is public in the app config.

Do not treat "each user has their own Firebase project" as a sufficient security boundary while public project config and open rules are in use. Before recommending or expanding Firebase sync, fix authorisation or move sync behind an authenticated backend/token broker.

## 2. Zakat findings from today's audit

**Status:** proven from code/docs/workbook audit unless marked open question.

The new authoritative zakat specification is [`zakat-requirements-2026-10.md`](zakat-requirements-2026-10.md). Follow it over the older zakat docs.

Findings:

- The implemented calculation used a single assessment-date snapshot and had **no hawl / Islamic-year logic**. This contradicts the owner's own documented rule that zakat is due on the **minimum wealth held across the full lunar year**.
- Accounts were manually ticked as zakatable. Negative asset balances were silently excluded. Liabilities were deducted only when explicitly typed and selected.
- The implementation produced separate per-currency obligations and had no FX model. AED and PKR therefore had to be combined by hand.
- Payments were recorded but did not reduce any obligation and did not create a transaction.
- The code silently made jurisprudential choices: gold nisab, 85g standard, positive balances zakatable, and pure-gold valuation.
- **Nisab has now been dropped entirely at the owner's instruction.** The owner said to "forget about the nisab etc."; do not reintroduce a threshold unless the owner asks.
- `goldItems`, `zakatCalculations`, and `zakatPayments` are **not covered by Firebase sync**, so zakat data has no cloud backup.
- Open question: `docs/ZAKAT-QUICK-START.md:218-229` says the owner **lent to Papa**; `docs/zakat-enhancement-plan.md:185-186` says the owner **owes Papa**. These are opposite signs. Do not guess.

Workbook clarification:

- Trust `2020`–`2024` only as the owner's hand-calculated history and formula reference.
- `2025` and `2026` in `docs/Zakat - All.xlsx` are known-bad. The owner said: "2025 and 2026 are never calculated properly and have wrong data tbh".
- Reconciliation tests should cover `2020`–`2024` only.
- The app is expected to compute `2025` and `2026` fresh from MizanTrack transaction data and state clearly which currencies/books have sufficient history.

## 3. Data investigations resolved today

### misc / noon-mashreq balances

**Status:** proven; these were correct data, not balance bugs.

The reported "wrong balances" for `misc` and `noon-mashreq` were not app calculation bugs.

Root cause: MizanTrack was computing balances **as of today**, while Hysab Kytab shows **all-time including future-dated entries**.

Specific findings:

- `misc` has 13 future transactions netting `-7,848.20` through mid-2027.
- Two discrepancies were Hysab Kytab's own errors:
  - a wrong opening balance on `noon-mashreq`;
  - a phantom opening balance displayed for `misc` that does not exist in stored data.
- A third discrepancy was a deleted `3/6` cheque leg in Hysab Kytab. That made Hysab Kytab lose `7,160`; MizanTrack's figure was the correct one.

### Include-future toggle

**Status:** implemented during the session.

A new **Include future** toggle exists on both the Accounts page and the Dashboard.

Behaviour:

- defaults ON;
- displays an "Incl. future" / "As of today" badge;
- shared through `filter-store`.

### Export/import round-trip

**Status:** validated.

Export/import round-trip results:

- AED reconciled exactly:
  - expense to the cent;
  - transfers `0.00`;
  - income differed only by `+113.25`, which the owner deliberately reclassified;
  - budgets `210/210`.
- PKR expense total was byte-identical.

### Export bug fixed on `wip-sheets-export`

**Status:** found and fixed on branch `wip-sheets-export`; not yet landed on `main`.

Bug: annual budgets were lost during export.

Root cause:

- `Budget.period` is a string.
- Hysab Kytab stores a yearly budget as month `0`.
- Import converts that to `"YYYY-00"`.
- `"2019-00"` sorts below `"2019-01"`, so every annual budget fell outside any export range.

Impact:

- 14 budgets worth `111,000 PKR` were silently dropped.

### AED same-account transfer report

**Status:** corrected analysis error.

The owner's earlier report of 27 same-account transfers in the AED file was caused by analysis error, not by 27 real self-transfers.

Mistake: the investigation compared the stale denormalised `ACCOUNTNAME` label instead of `ACCOUNTID`.

Correct result:

- only one genuine self-transfer existed.

Caution for future Hysab Kytab backup work:

- `ACCOUNTNAME` frequently disagrees with the real account.
- Example: 564 rows labelled `"FAB - Credit Card"` actually belong to `"FAB - Share Card"`.
- Always resolve by `ACCOUNTID`, not by `ACCOUNTNAME`.

## 4. Sync findings

### Reverted sync commit

**Status:** proven history; causality still unproven.

Commit `5400fa4` added cursor safety, server-forced reads, and a Firebase count manifest. It was reverted in `7627b58`.

Reason for revert:

- forcing `getDocsFromServer()` on every pull was too expensive on the Firebase free tier;
- the change coincided with `429` quota exhaustion across two devices.

Important uncertainty:

- It is **unproven** whether `5400fa4` caused the missing backup counts.
- The `429` quota exhaustion alone explains missing/incomplete pulls.
- Verify once quota resets.

### Worth restoring from `5400fa4`

**Status:** recommendation, not yet implemented.

Recover the useful parts with `git revert 7627b58`, but do **not** restore the cache bypass.

Worth restoring:

- The owner's **manifest idea**: a small per-table count document, one cheap read per sync, so gaps report **partial sync** instead of green success.
- **Cursor safety**: the watermark only advances past a timestamp group once every record in that group is applied; inclusive comparison prevents exact timestamp ties from being skipped.

### Known sync symptom

**Status:** observed.

Records created on one device intermittently take several syncs to appear on another. They eventually arrive, so the current symptom is delayed sync rather than proven data loss.

## 5. Other known issues and process lessons

### Dexie server/client boundary noise

**Status:** observed non-fatal issue, with a known fatal variant.

`DexieError: MissingAPIError` is logged during SSR because:

- `src/lib/actions/transactions.ts`
- `src/lib/actions/accounts.ts`
- `src/lib/actions/categories.ts`

carry no `"use client"` / `"use server"` directive yet transitively import `@/lib/db/local`, which constructs Dexie at module scope.

This is currently non-fatal noise.

The fatal variant is server route code reaching `@/lib/export.ts`, which also imports Dexie at module scope. That broke the app earlier in the day and forced a revert.

### Build/test process lesson

**Status:** proven process failure.

The server/client boundary breakage passed both:

- the full test suite; and
- `npm run build`.

A green build is not evidence for server/client boundary changes. Any change touching the server/client boundary must be verified by actually booting the app and fetching pages.

### Concurrent-agent process lesson

**Status:** proven process failure.

Two concurrent agents shared one working tree. One ran `git checkout -- .` while the other was writing, destroying that other agent's work.

Agents sharing a working tree must never run bulk checkout, stash, reset, or clean commands.

### Parked work on `wip-sheets-export`

**Status:** parked on branch, not landed on `main`.

The following work is parked on `wip-sheets-export`:

- Google Sheets connect fix.
  - Root cause: NextAuth v5 only supplies `account` on initial sign-in, so granting Drive access while already signed in never persisted tokens.
- Annual-budget export fix.
- Merge self-transfer cleanup.

## 6. State at handover

**Status:** reported session state.

- `main` at `7627b58`.
- 461 tests passing.
- Typecheck, lint, and build clean.
- Roughly 19 commits unpushed.
- Firebase free-tier quota was exhausted today and should reset around 11:00 local time.
- Do not assume sync behaviour is proven until testing after quota reset.

