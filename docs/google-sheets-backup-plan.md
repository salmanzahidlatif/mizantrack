# Work Plan: Google Sheets Backup

**Version:** 1.0
**Last Updated:** 2026-09-29
**Status:** Draft — blocked on `docs/google-sheets-backup-questions.md`
**Feasibility Reference:** `docs/google-sheets-backup-feasibility.md`
**Design Reference:** `docs/google-sheets-backup-design.md`
**Repository:** mizantrack

---

## Vision & Metrics

**Vision:** For MizanTrack users who want a backup they can actually open and read, Google Sheets Backup keeps a live spreadsheet in their own Google Drive up to date with their financial data — using the Google account they already signed in with, requesting only the permission to touch the one file it creates.

**Success Metrics**

| Metric | Target |
|---|---|
| New OAuth scopes requested | Exactly 1 (`drive.file`, non-sensitive) |
| Google verification / CASA required | None |
| New npm dependencies | 0 |
| New environment secrets | 0 |
| Full backup, 50,000 transactions | < 60 s |
| Sheets write-quota utilisation per run | < 20% of 60/min/user |
| Tokens reachable by client-side JavaScript | 0 |
| Duplicate backup sheets created | 0 |
| Serialise→deserialise round-trip fidelity | 100% |
| Tables backed up that Firebase sync misses | 3 (`goldItems`, `zakatCalculations`, `zakatPayments`) |

---

## Summary

**6 phases · 18 stories · ~13–19 working days**

Phases 0–4 deliver the complete feature as requested. Phase 5 (restore) and Phase 6 (scale) are explicitly optional and should be funded separately, if at all.

| Phase | Title | Effort | Independently shippable? |
|---|---|---|---|
| **0** | Spike & Google Cloud setup | 1 day | N/A — decision gate |
| **1** | OAuth foundation & token lifecycle | 2–3 days | Yes — "Connect" works, nothing is written |
| **2** | Sheet creation & first write | 3–4 days | Yes — **this is the feature the user asked for** |
| **3** | Robustness, chunking, discovery | 3–4 days | Yes — production-ready |
| **4** | UI polish & automatic backup | 2–3 days | Yes — feature complete |
| **5** | *(Optional)* Restore from sheet | 4–5 days | Yes — separate decision |
| **6** | *(Optional)* Scale & summary tab | 2–3 days | Yes — only if needed |

**Minimum viable delivery: Phases 0–2, ~6–8 days.** At that point the app creates, writes and updates a real Google Sheet. Phases 3–4 are what make it trustworthy rather than merely working, and should not be skipped for anything a user relies on for backups.

---

## Phase 0: Spike & Google Cloud Setup

**Description:** Close the open questions in feasibility §11 before committing to scope. This is a decision gate, not a deliverable.
**Business Value:** One day here can prevent a week of rework on discovery, and prevents shipping a feature that forces weekly re-consent.
**Priority:** Critical — blocks everything
**Estimated Effort:** 1 day

---

### Story S-000: Google Cloud configuration

**As a** developer **I want** the existing OAuth client configured for `drive.file` in production publishing status **so that** refresh tokens do not expire after 7 days.

**Tasks**
- Google Auth Platform → **Data Access** → add `https://www.googleapis.com/auth/drive.file`; record the sensitivity label the console displays.
- Enable the **Google Sheets API** and the **Google Drive API** in the project.
- Google Auth Platform → **Audience** → set publishing status to **In production**.
- Confirm the redirect URIs already registered still cover local (`http://localhost:3000/api/auth/callback/google`) and production.
- Consider a **separate Cloud project for dev vs. production**, per <https://developers.google.com/identity/protocols/oauth2/policies>.

**Acceptance Criteria**
- [ ] Cloud Console labels `drive.file` as **non-sensitive**
- [ ] Sheets API and Drive API both show as enabled
- [ ] Publishing status reads **"In production"**
- [ ] A consent flow requesting `drive.file` completes and shows the "only the specific files you use with this app" wording
- [ ] **No new secret is added to `.env.local` or the repository** — the existing `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` are unchanged

> **Release blocker.** Feasibility §5.4: leaving the client in Testing status means the refresh token dies every 7 days and the feature looks broken.

---

### Story S-001: Discovery spike

**As a** developer **I want** to know empirically whether `files.list` + `appProperties` works under `drive.file` alone **so that** the discovery design (design §10) is settled before it is built.

This is **risk R1**, the largest unknown in the project.

**Tasks** — throwaway script, **not committed**, run with a real token:
1. `POST /v4/spreadsheets` → create a spreadsheet. Record success/failure.
2. `PATCH /drive/v3/files/{id}` → set `appProperties.mizantrackBackup = "v1"`.
3. `GET /drive/v3/files?q=appProperties has { key='mizantrackBackup' and value='v1' } and trashed=false&spaces=drive` → **does it return the file?**
4. Revoke and re-grant consent, then repeat step 3 with the **new** token — does the file survive a new grant?
5. `PUT /values/A1?valueInputOption=RAW` → write ~1,000 rows; confirm no type coercion of UUIDs or ISO dates.
6. `GET /drive/v3/files?q=mimeType='application/vnd.google-apps.spreadsheet'` → confirm this *broader* query is refused or returns only app-created files.
7. Write a 60,000-character string into one cell → find the real per-cell limit.
8. From a browser console on `localhost:3000`, `fetch("https://sheets.googleapis.com/v4/spreadsheets/{id}")` with a Bearer token → **does CORS permit it?** (Keeps the token-broker option alive.)

**Acceptance Criteria**
- [ ] Every step has a recorded yes/no with the exact HTTP status
- [ ] A short findings note is appended to `docs/google-sheets-backup-feasibility.md` §11, replacing "unverified" with the observed result
- [ ] If step 3 or 4 fails → design §10 layer 4 ("paste your sheet URL") is promoted from fallback to a required Phase 3 story
- [ ] If step 5 shows coercion → escalate immediately; `RAW` failing would be a fundamental problem
- [ ] The spike script is **deleted**, not committed

**Effort:** 0.5 day

---

## Phase 1: OAuth Foundation & Token Lifecycle

**Description:** Incremental consent, token storage, refresh, and a status endpoint. No sheet is created yet.
**Business Value:** The riskiest non-obvious code in the feature — the `jwt` callback and refresh handling — lands and is tested in isolation, before any Sheets complexity is layered on.
**Priority:** Critical
**Estimated Effort:** 2–3 days

---

### Story S-101: Extend the NextAuth token pipeline

**As a** signed-in user **I want** the app to remember my Google Drive permission **so that** I do not re-authorise on every backup.

**Files**
- `src/lib/auth.ts` *(edit — additive)*
- `src/lib/googleSheets/server/tokens.ts` *(new)*
- `src/types/next-auth.d.ts` *(new or edit — module augmentation)*

**Implementation** — design §7.2 / §7.3.

**Acceptance Criteria**
- [ ] `jwt` callback still calls `pinTokenSubToProvider(token, account)` **first**; `src/lib/auth/session.ts` is unmodified
- [ ] Tokens are stored **only** when `account.scope` includes `drive.file` **and** the individual values are non-nullish
- [ ] **Regression test (R3):** calling the callback with an `account` that lacks the Drive scope — the shape `LockScreen.tsx:274` produces via `signIn("google", { redirect: false })` — leaves `token.googleRefreshToken` untouched
- [ ] Access token refreshes when within 60 s of expiry
- [ ] A refresh response omitting `refresh_token` preserves the existing one
- [ ] `invalid_grant` clears the tokens and sets `googleTokenError = "RequiresReconnect"`; **it is never retried**
- [ ] `session.googleSheets` exposes `{ connected, needsReconnect }` — **no token value appears anywhere on the session**
- [ ] Existing auth tests (`src/test/autoGoogleSignIn.test.tsx` and any session tests) still pass
- [ ] Measured session-cookie growth is recorded; if > 3 KB, the access token is dropped from the JWT per design §7.5

**Effort:** 1 day

---

### Story S-102: Connect / disconnect Server Actions

**As a** user **I want** a single button that grants Drive permission **so that** setup is one click.

**Files**
- `src/lib/actions/googleSheets.ts` *(new)*
- `src/app/api/google-sheets/disconnect/route.ts` *(new)*

**Implementation** — design §7.1; the `signIn` third-argument mechanism is verified in feasibility §6.1.

**Acceptance Criteria**
- [ ] `connectGoogleSheetsAction()` calls `signIn("google", { redirectTo: "/settings?sheets=connected" }, { scope, access_type: "offline", prompt: "consent", include_granted_scopes: "true" })`
- [ ] The consent screen shows the Drive-file permission
- [ ] `prompt: "consent"` overrides the provider-level `prompt: "select_account"` (verified: signIn-time params merge last in `@auth/core/lib/actions/signin/authorization-url.js`)
- [ ] A refresh token is issued **on every** connect, not only the first
- [ ] Normal sign-in from `/login` is **unchanged** — still `openid email profile` with `select_account`
- [ ] Disconnect POSTs to `https://oauth2.googleapis.com/revoke` and clears the stored token fields
- [ ] The disconnect handler calls `auth()` itself and returns 401 without a session

**Effort:** 0.5 day

---

### Story S-103: Status endpoint

**As a** Settings panel **I want** to know the connection state **so that** I render the right thing.

**Files**
- `src/app/api/google-sheets/status/route.ts` *(new)*
- `src/lib/googleSheets/errors.ts` *(new)*

**Acceptance Criteria**
- [ ] `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`
- [ ] Calls `auth()` and returns 401 when unauthenticated — **Proxy's matcher excludes `/api`** (design §9.2)
- [ ] Returns `{ connected, needsReconnect }`; other fields appear from Phase 2
- [ ] Returns no token material under any code path
- [ ] Integration test covers authenticated, unauthenticated, and needs-reconnect

**Effort:** 0.5 day

---

### Story S-104: Service-worker exclusion

**As a** user **I want** backup requests to always hit the network **so that** I never see a stale cached status.

**Files**
- `next.config.js` *(edit)*

**Acceptance Criteria**
- [ ] A `NetworkOnly` rule for `/api/google-sheets/.*` is **prepended** to `runtimeCaching`, ahead of the `/^https?.*/` catch-all (Workbox is order-sensitive)
- [ ] A `NetworkOnly` rule for `sheets.googleapis.com` / `www.googleapis.com` is also present
- [ ] The existing catch-all rule is otherwise byte-for-byte unchanged
- [ ] Verified in DevTools → Application → Service Workers that `/api/google-sheets/status` is not served from cache
- [ ] Offline fallback (`/offline`) and existing PWA install behaviour still work

**Effort:** 0.25 day

---

### Phase 1 Definition of Done

- [ ] A user can connect and disconnect Google Sheets from a temporary debug button
- [ ] The token survives a page reload and a normal re-sign-in
- [ ] `npm run validate` passes (typecheck + lint + format)
- [ ] **No Sheets API call has been written yet** — this phase is deliberately boring

---

## Phase 2: Sheet Creation & First Write

**Description:** Create a spreadsheet, serialise every table, write it. The core of the request.
**Business Value:** This is the feature. Everything after is hardening.
**Priority:** Critical
**Estimated Effort:** 3–4 days

---

### Story S-201: Schema and serialisation

**As a** developer **I want** pure, tested serialisation **so that** the backup is lossless and round-trippable.

**Files**
- `src/lib/googleSheets/schema.ts` *(new)* — `SHEET_SCHEMA_VERSION`, tab names, column definitions, `DRIVE_FILE_SCOPE`
- `src/lib/googleSheets/serialize.ts` *(new)*
- `src/lib/googleSheets/deserialize.ts` *(new)* — written now, used in Phase 5; it is the only way to test the round trip
- `src/lib/googleSheets/__tests__/serialize.test.ts` *(new)*

**Implementation** — design §5.3 column layouts.

**Acceptance Criteria**
- [ ] Column definitions cover all 7 tabs, derived field-by-field from `src/types/index.ts`
- [ ] Timestamps serialise to ISO 8601; `undefined` → `""`
- [ ] `tags` joined with `|`, with `\|` escaping; round-trips a tag containing a literal pipe
- [ ] `travelCurrency` flattens to 4 columns and reconstructs exactly, including the all-absent case
- [ ] `deletedAt` tombstones are preserved, never filtered out
- [ ] `accountBalancesJson` / `monthlyBalancesJson` encode and decode; **serialisation throws** if the encoded string exceeds the cell limit measured in S-001
- [ ] `Config` uses the strict allow-list — **`pinHash`, `firebaseConfig`, `goldApiKey` and `biometricCredentialId` are excluded**, with a code comment explaining why this is deliberately narrower than `SYNCED_PREFS_FIELDS` in `sync.ts`
- [ ] `dashboardStats` is not serialised at all
- [ ] Property test: `deserialize(serialize(x))` deep-equals `x` for 1,000 generated records per table, including unicode, newlines, commas and empty optionals
- [ ] Readers resolve columns by header name, never by index

**Effort:** 1 day

---

### Story S-202: Google API wrappers

**As a** developer **I want** thin, typed `fetch` wrappers **so that** no npm dependency is added.

**Files**
- `src/lib/googleSheets/server/googleFetch.ts` *(new)* — `import "server-only"`, Bearer header, error taxonomy
- `src/lib/googleSheets/server/sheetsApi.ts` *(new)* — `createSpreadsheet`, `updateValues`, `batchUpdateValues`, `batchUpdate`, `getValues`
- `src/lib/googleSheets/server/driveApi.ts` *(new)* — `getFile`, `updateFile`, `listByAppProperties`, `trashFile`

**Acceptance Criteria**
- [ ] Every module begins with `import "server-only"` (Next.js 16 data-security guide)
- [ ] **No new package appears in `package.json`**
- [ ] Every write uses `valueInputOption=RAW`
- [ ] `getFile` always passes an explicit `fields` mask — never a bare fetch (design §6.2)
- [ ] Google error responses map to the `GoogleSheetsErrorCode` taxonomy
- [ ] Unit tests with a stubbed `fetch` cover success, 401, 403, 404, 429 and 500

**Effort:** 1 day

---

### Story S-203: Create-and-write orchestration

**As a** user **I want** my data written into a new spreadsheet **so that** I have a real backup.

**Files**
- `src/lib/googleSheets/server/backup.ts` *(new)*
- `src/app/api/google-sheets/begin/route.ts` *(new)*
- `src/app/api/google-sheets/chunk/route.ts` *(new)*
- `src/app/api/google-sheets/commit/route.ts` *(new)*
- `src/lib/googleSheets/collect.ts` *(new)* — client-side Dexie reads
- `src/lib/googleSheets/chunk.ts` *(new)*

**Implementation** — design §8.1.

**Acceptance Criteria**
- [ ] Every handler calls `auth()` and returns 401 without a session
- [ ] Every handler declares `runtime = "nodejs"` and `dynamic = "force-dynamic"`
- [ ] First run: creates the spreadsheet, titles it `MizanTrack Backup — <email>`, sets `appProperties`, stores the id in `dbConfig.googleSheetId`
- [ ] Second run: **updates the same spreadsheet**; Drive shows exactly one file (FR-GS-003)
- [ ] All 7 tabs are created with headers in row 1
- [ ] `_Meta` is written `in_progress` **before** any data and `complete` **after** the final write
- [ ] `_Meta.userId` matches `session.user.id`; a mismatch returns `SheetForeign` and writes nothing
- [ ] Chunks are ≤ 1.8 MB; a larger chunk returns 413
- [ ] `collect.ts` captures `startedAt` **before** reading Dexie, mirroring `sync.ts`'s watermark ordering
- [ ] Tombstones are included
- [ ] Verified manually: open the sheet in a browser; data is correct, IDs are intact, dates are not coerced into serial numbers

**Effort:** 1.5 days

---

### Story S-204: Minimal panel

**As a** user **I want** a Settings card **so that** I can connect and press "Back up now".

**Files**
- `src/components/settings/GoogleSheetsBackupPanel.tsx` *(new)*
- `src/store/sheets-backup-store.ts` *(new)*
- `src/components/settings/SettingsPageClient.tsx` *(edit — one import, one element)*
- `src/lib/db/local.ts` *(edit — Dexie v5)*
- `src/types/index.ts` *(edit — `DbConfig` fields, new interfaces)*

**Acceptance Criteria**
- [ ] The card matches `FirebaseSyncPanel`'s visual structure (`rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]`)
- [ ] Mounted after `FirebaseSyncPanel`, before `ResetLocalDataPanel`
- [ ] Not-connected state shows **Connect** plus the scope explanation
- [ ] Connected state shows **Back up now** plus a link to the sheet
- [ ] Dexie upgrades v4 → v5 with no data loss (test with `fake-indexeddb` and manually against a populated profile)
- [ ] Success toast via `sonner`, matching existing conventions
- [ ] `FirebaseSyncPanel` is not modified

**Effort:** 0.5 day

---

### Phase 2 Definition of Done

- [ ] A user connects, presses **Back up now**, and opens a real, correct Google Sheet in their Drive
- [ ] A second backup updates the same sheet
- [ ] `goldItems`, `zakatCalculations` and `zakatPayments` are backed up — **a capability that does not exist anywhere in the app today**
- [ ] `npm run validate` and `npm test` pass

**This is the shippable milestone the user asked for.**

---

## Phase 3: Robustness

**Description:** Everything that turns a demo into something a person can rely on.
**Business Value:** A backup that fails silently is worse than no backup, because it creates false confidence.
**Priority:** High — do not skip
**Estimated Effort:** 3–4 days

---

### Story S-301: Retry, backoff, quota

**Files:** `src/lib/googleSheets/server/googleFetch.ts` *(edit)*

**Acceptance Criteria**
- [ ] Implements Google's published algorithm exactly: `wait = min(2^n × 1000 + random_ms, 32_000)`
- [ ] Max 5 attempts; 120 s wall-clock budget per run
- [ ] 429 and 5xx retry; **400, 401, 403, 404 never retry**
- [ ] `invalid_grant` is never retried
- [ ] The UI shows "Google is rate-limiting. Retrying in Ns…" rather than freezing
- [ ] Unit test asserts the exact backoff schedule with a seeded random

**Effort:** 0.5 day

---

### Story S-302: Discovery and idempotency

**Files:** `src/lib/googleSheets/server/backup.ts` *(edit)*, `src/lib/db/sync.ts` *(edit — add two fields to `SYNCED_PREFS_FIELDS`)*, `src/components/settings/GoogleSheetsBackupDialog.tsx` *(new)*

**Implementation** — design §10. **Adjust to the S-001 spike result.**

**Acceptance Criteria**
- [ ] Resolution order: stored id → `files.get` verify → Drive `appProperties` query → manual URL entry → create
- [ ] Deleted sheet (404) → stored id cleared, user prompted, **never silently recreated**
- [ ] Trashed sheet detected via `trashed: true`, with a "restore from Drive trash" hint
- [ ] Renamed or moved sheet still resolves
- [ ] Multiple matches → newest `modifiedTime` wins, UI warns
- [ ] `googleSheetId` and `googleSheetsAutoBackup` added to `SYNCED_PREFS_FIELDS`; **`googleSheetsLastBackupAt` is NOT** (per-device state)
- [ ] Manual "paste your sheet URL" path exists, extracts the id from a Drive URL, and gives a clear message when `drive.file` refuses a file the app did not create
- [ ] **Never creates a second sheet** across: new device, cleared IndexedDB, re-consent, and two rapid backups

**Effort:** 1 day

---

### Story S-303: Partial write & concurrency

**Files:** `src/lib/googleSheets/server/backup.ts` *(edit)*

**Acceptance Criteria**
- [ ] A unique `backupId` per run, verified on every `/chunk` and `/commit`
- [ ] `in_progress` newer than 5 minutes → `ConcurrentBackup` (409)
- [ ] `in_progress` older than 5 minutes → taken over, **all tabs forced dirty**
- [ ] Commit trims rows beyond `rowCount + 1` via `deleteDimension` — no ghost rows after a shrink
- [ ] `_Meta.status = "in_progress"` on load renders a persistent amber "Last backup didn't finish" banner
- [ ] Killing the process mid-backup and re-running produces a correct sheet

**Effort:** 1 day

---

### Story S-304: Dirty-tab optimisation

**Files:** `src/lib/googleSheets/collect.ts` *(edit)*, `backup.ts` *(edit)*

**Acceptance Criteria**
- [ ] `/begin` returns only tabs whose `max(updatedAt)` exceeds the per-tab `lastBackupAt` in `_Meta`
- [ ] A schema-version change forces **all** tabs dirty
- [ ] A backup with no changes at all completes in < 3 s and issues ≤ 3 requests
- [ ] Adding one transaction rewrites only the `Transactions` tab

**Effort:** 0.5 day

---

### Story S-305: Error surfacing and offline

**Files:** `GoogleSheetsBackupPanel.tsx` *(edit)*, `sheets-backup-store.ts` *(edit)*

**Acceptance Criteria**
- [ ] Every `GoogleSheetsErrorCode` maps to specific, plain-language copy — **never a raw Google error string**
- [ ] `navigator.onLine === false` → **Back up now** disabled with "You're offline"
- [ ] An `online` listener clears the offline error
- [ ] `RequiresReconnect` → amber card with a single **Reconnect** button
- [ ] `SheetTooLarge` explains the 20-million-cell limit in user terms
- [ ] Pre-flight cell-count estimate warns at 80% and refuses at 100%

**Effort:** 0.5 day

---

### Story S-306: Logging audit

**Files:** all new modules

**Acceptance Criteria**
- [ ] `rtk grep -rn "console\." src/lib/googleSheets src/app/api/google-sheets` reviewed line by line
- [ ] **No log statement can emit a request body, a row, a cell value, a token or the user's email**
- [ ] Logged: userId, operation, tab, row count, duration, status, Google error code, backupId
- [ ] A code comment in `chunk/route.ts` warns future maintainers not to log the body

**Effort:** 0.25 day

---

### Phase 3 Definition of Done

- [ ] Backup survives: offline, quota limits, token expiry, a deleted sheet, a partial write, and concurrent devices
- [ ] Every failure produces an actionable message
- [ ] Measured against the real 2.2 MB dataset in `docs/`, within the NFR targets

---

## Phase 4: UI Polish & Automation

**Description:** Make it feel like part of the app.
**Priority:** Medium
**Estimated Effort:** 2–3 days

---

### Story S-401: Full panel states

**Acceptance Criteria** — design §14.2
- [ ] Not-connected, connected-idle, backing-up, needs-reconnect, offline and incomplete states all render correctly
- [ ] Per-table row counts, matching `FirebaseSyncPanel`'s breakdown idiom
- [ ] `Progress` bar during backup with "Writing Transactions… 8,000 / 12,481"
- [ ] Relative last-backup time via `formatDistanceToNow`, as elsewhere in Settings
- [ ] `⋮` menu: Open in Google Sheets · Rename · Disconnect
- [ ] Mobile-first at 360 px; no horizontal overflow

**Effort:** 1 day

---

### Story S-402: Connect and disconnect dialogs

**Acceptance Criteria**
- [ ] Connect dialog carries the §13.4 privacy copy verbatim, **including** the "not encrypted" and "passes through MizanTrack's server" bullets
- [ ] The first backup runs automatically after a successful connect
- [ ] Disconnect dialog offers "Disconnect only" and "Disconnect and delete the sheet", defaulting focus to Cancel
- [ ] Deletion uses `trashed: true`, never permanent delete
- [ ] Both use the existing `Dialog` primitives

**Effort:** 0.5 day

---

### Story S-403: Sheet formatting

**Acceptance Criteria** — design §5.4
- [ ] Header row frozen (`frozenRowCount = 1`), bold, white on `#0f9d58`
- [ ] Basic filter on every data tab
- [ ] Columns auto-sized **at creation and on schema change only** — not on every backup
- [ ] Rows with a non-empty `deletedAt` greyed and struck through
- [ ] `_Meta` column B widened; the "Do not edit" warning is visible without scrolling
- [ ] Formatting requests do not add more than 1 write per run in the steady state

**Effort:** 0.5 day

---

### Story S-404: Automatic backup

**Acceptance Criteria** — design §14.5
- [ ] Toggle, **off by default**, persisted in `dbConfig.googleSheetsAutoBackup`
- [ ] At most once per 24 h, on app foreground, online only, only when data changed
- [ ] Never runs concurrently with a manual backup
- [ ] Suppressed entirely while `needsReconnect` is set
- [ ] **No Background Sync API usage** (feasibility §8.4)
- [ ] Never blocks app startup or first paint

**Effort:** 0.5 day

---

### Story S-405: Documentation and E2E

**Acceptance Criteria**
- [ ] `.env.local.example` gains **comments only** — the scope string and the "publishing status must be In production" note. No new variable.
- [ ] `docs/google-sheets-backup-feasibility.md` §11 updated with the S-001 spike results
- [ ] `docs/lessons-learned.md` gains an entry if anything surprising was found
- [ ] Playwright: panel renders not-connected; offline disables the button; connected shows row counts (Google itself is mocked)
- [ ] `npm run validate` and `npm test` pass

**Effort:** 0.5 day

---

## Phase 5 *(Optional)*: Restore From Sheet

**Description:** Two-way. **Recommend deferring; fund only on explicit request.**
**Priority:** Low
**Estimated Effort:** 4–5 days
**Risk:** **High** — this is the only part of the feature that can destroy data.

---

### Story S-501: Validation schemas

**Files:** `src/lib/validations/googleSheetsRow.ts` *(new)*

**Acceptance Criteria**
- [ ] A zod schema per table, extending the existing `src/lib/validations/*.ts` patterns
- [ ] Every row treated as untrusted input
- [ ] UUID, enum and ISO-date validation with explicit failure — never silent coercion
- [ ] `.strict()` so unknown columns surface
- [ ] Errors accumulate per row; parsing never aborts on the first failure

**Effort:** 1 day

---

### Story S-502: Drift detection

**Acceptance Criteria** — design §11.3
- [ ] Drive `version` and `modifiedTime` recorded at commit
- [ ] `_Meta.checksum` recomputed on read; mismatch detected
- [ ] `lastModifyingUser` distinguishes our writes from the user's
- [ ] A drifted sheet triggers "This sheet was edited outside MizanTrack… [Back up anyway] [Download first]" **before** any overwrite

**Effort:** 1 day

---

### Story S-503: Restore

**Acceptance Criteria** — design §11.2
- [ ] **A local `.xlsx` snapshot is downloaded first, and cannot be skipped**
- [ ] `_Meta.schemaVersion` and `_Meta.userId` verified before anything is read
- [ ] Error rate > 1% aborts and changes nothing
- [ ] Referential integrity checked; orphans quarantined, not imported
- [ ] Merge is last-write-wins on `updatedAt`, matching `sync.ts` exactly; a newer tombstone wins
- [ ] **A dry-run diff is shown and must be confirmed** — "142 new, 8 updated, 3 deleted, 2 skipped"
- [ ] Applied in a single Dexie transaction
- [ ] `scheduleAnalyticsRecompute(userId)` afterwards
- [ ] `syncMeta` watermarks reset to 0 so Firebase reconciles
- [ ] Never automatic. Never background. Always explicit.

**Effort:** 2–3 days

---

## Phase 6 *(Optional)*: Scale & Summary

**Priority:** Low — build only if a real user exceeds ~100,000 transactions
**Estimated Effort:** 2–3 days

- **S-601 Year-partitioned transaction tabs** — `Transactions_2025`, `Transactions_2026`; only the current year is rewritten. Requires `_Meta` to track partitions and the restore reader to union them.
- **S-602 Human-readable Summary tab** — formula-driven monthly income/expense, per-account balances, zakat summary. Read-only, never parsed back, regenerated each run.

---

## Cross-Cutting Requirements

Apply to every phase:

- [ ] **No file outside the listed paths is modified.** `src/lib/export.ts`, `src/lib/import/**`, `src/lib/zakatExport.ts` and `FirebaseSyncPanel.tsx` are untouched.
- [ ] **No new npm dependency.**
- [ ] **No new secret**, and nothing secret committed.
- [ ] Every `/api/google-sheets/*` handler calls `auth()` itself — Proxy excludes `/api`.
- [ ] Every `server/` module starts with `import "server-only"`.
- [ ] No token value on the session, in a response body, or in a log line.
- [ ] `npm run validate` passes before every merge.
- [ ] Prettier formatting with tabs, matching the repo.
- [ ] Mobile-first; verified at 360 px.
- [ ] The app works fully offline; this feature is never a startup dependency.

---

## Risk Mitigation Schedule

| Risk (feasibility §10) | Addressed in |
|---|---|
| R1 `files.list` + `appProperties` under `drive.file` | **S-001** spike, then S-302 |
| R2 OAuth client left in Testing | **S-000** — release blocker |
| R3 Refresh token clobbered by `LockScreen` | **S-101** — dedicated regression test |
| R4 Data transits the app server | User decision (Q3), then S-306 logging audit + S-402 disclosure copy |
| R5 Partial write | S-303 |
| R6 Concurrent devices | S-303 |
| R7 Sheets coerces types | S-001 step 5, then S-201 round-trip property test |
| R8 Two-way data loss | Phased out to Phase 5; S-503's snapshot + dry-run gates |
| R9 Service worker caches responses | S-104 |
| R10 `drive.file` reclassified | S-000 records the label; re-check each release |

---

## Estimation Summary

| Phase | Stories | Days |
|---|---|---|
| 0 — Spike & setup | 2 | 1 |
| 1 — OAuth foundation | 4 | 2–3 |
| 2 — Create & write | 4 | 3–4 |
| 3 — Robustness | 6 | 3–4 |
| 4 — UI & automation | 5 | 2–3 |
| **Core total (0–4)** | **21** | **11–15** |
| 5 — Restore *(optional)* | 3 | 4–5 |
| 6 — Scale *(optional)* | 2 | 2–3 |
| **Grand total** | **26** | **17–23** |

**Estimates assume one developer familiar with this codebase.** The largest sources of variance are (a) the S-001 spike outcome — a negative result on Drive discovery adds ~1 day of manual-entry UX, and (b) OAuth consent-screen friction in the Google Cloud Console, which is unpredictable and occasionally involves waiting on Google.

---

## Recommended Delivery

**Ship Phases 0–2 first (~6–8 days).** That delivers exactly what was asked: the app creates, writes and updates a real Google Sheet in the user's own Drive. Use it personally for a week against real data.

**Then Phases 3–4 (~5–7 days)**, informed by what actually broke in that week.

**Hold Phase 5 indefinitely.** One-way backup solves the stated problem. Two-way editing is a different product with materially worse failure modes, and it should be a separate, deliberate decision rather than a continuation of this one.
