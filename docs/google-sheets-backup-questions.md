# Decisions Needed: Google Sheets Backup

**Version:** 1.0
**Last Updated:** 2026-09-29
**For:** Salman (product owner)
**From:** Architecture review
**Feasibility:** `docs/google-sheets-backup-feasibility.md`
**Design:** `docs/google-sheets-backup-design.md`
**Plan:** `docs/google-sheets-backup-plan.md`

---

## Read this first

**Short answer to your question: yes, this is possible, and it is cheaper than you probably expect.**

The app can create, write and update a real Google Spreadsheet in your own Google Drive using the same Google account you already sign in with. It needs **one extra permission** — `drive.file`, which Google classifies as **non-sensitive** and which therefore **requires no Google app verification and no paid security audit**. That single fact is what makes this a two-week feature instead of a six-month compliance project.

There are a few decisions only you can make. They are below. Most have a clear recommendation — for those, "agree" is a complete answer.

**Blocking questions: 1, 2, 3, 4.** Everything else can be answered later.

---

## Blocking Decisions

### Q1. Do we proceed at all?

The honest cost/benefit:

**Cost:** ~11–15 working days for the complete feature. ~6–8 days for a working version you can use immediately. No money — no new dependencies, no new secrets, no Google fees, no audit.

**Benefit beyond what you asked for:** your `goldItems`, `zakatCalculations` and `zakatPayments` tables are **currently not backed up anywhere at all**. `src/lib/db/sync.ts` only syncs `accounts`, `categories` and `transactions` to Firebase. This feature closes that gap as a side effect. That alone may justify it.

**Risk:** Medium, and concentrated in known places — token lifecycle, and one undocumented Google behaviour we can settle in a one-day spike.

| Option | |
|---|---|
| **A** | Proceed with the full plan (Phases 0–4) |
| **B** | Proceed with Phases 0–2 only, then reassess after using it for a week |
| **C** | Do the 1-day Phase 0 spike only, then decide |
| **D** | Do not proceed |

**My recommendation: B.** Phases 0–2 give you a working Google Sheets backup in about a week. Live with it for a few days; the things that annoy you will tell us exactly what Phase 3 should prioritise. Phases 3–4 are genuinely necessary before you rely on it, but they will be better work if they are informed rather than speculative.

**Your answer:** ___________

---

### Q2. Which OAuth scope?

This is the most consequential technical decision and it has a clear right answer.

| Option | Google's classification | Verification needed? | Can it do what you asked? |
|---|---|---|---|
| **A. `drive.file`** | **Non-sensitive** | **No** | **Yes — fully** |
| **B. `spreadsheets`** | Probably sensitive | Likely yes | Yes, plus access to sheets we never touch |
| **C. `drive`** | **Restricted** | **Yes + annual CASA security assessment** | Yes, plus access to your entire Drive |

Google's own words:

> "If your app utilizes only **non-sensitive** scopes, it is not mandatory for your app to complete the app verification process."
> — <https://support.google.com/cloud/answer/13463073>

`drive.file` means "this app can only see and edit the files it created." That is exactly and only what a backup feature needs. Your consent screen will say so, honestly.

**The one trade-off:** with `drive.file`, the app cannot back up into a spreadsheet you made by hand — it must create its own. It also means that if you *delete* the backup sheet, the app can't go hunting for it and will ask you before creating a new one. Both are fine; arguably both are features.

**My recommendation: A — `drive.file`, and hold the line on it.** Option C would cost real money every year, forever, for capabilities we would never use.

**Your answer:** ___________

---

### Q3. Where do the Sheets API calls happen? *(This is the privacy question.)*

This one genuinely needs your judgement, because it changes MizanTrack's privacy posture.

**Important context:** your data lives in IndexedDB on your device. The server has never seen it. Right now, with bring-your-own-Firebase, your financial data goes **device → your Firebase project** and never touches any server I control.

| | **A. Server proxy** *(recommended)* | **B. Token broker** |
|---|---|---|
| How it works | Device sends rows to the MizanTrack server; server calls Google | Server hands the browser a 1-hour access token; browser calls Google directly |
| Where your data travels | Device → **MizanTrack server (memory only)** → Google | Device → Google, directly |
| Where the Google token lives | Server only — browser never sees it | **Browser memory for an hour** |
| If the app has an XSS bug | Token is unreachable | Token can be stolen → attacker can write to your Drive |
| Does it definitely work? | Yes | **Unverified** — depends on Google CORS behaviour that Google does not document |

**The uncomfortable part of A:** your financial rows pass through the app server. They are held in memory, forwarded, and discarded — never written to disk, never logged, never cached. But they do pass through, and today they don't.

**Mitigations if you pick A:** the handler is stateless; logging request bodies is prohibited and audited as an explicit task (S-306); everything is TLS; and MizanTrack is self-hostable, so if you run your own instance the concern disappears entirely.

**My recommendation: A.** Handing a Drive-write token to the browser is the bigger risk of the two, and B depends on behaviour nobody can confirm in advance. The Phase 0 spike will test CORS anyway, so we can keep B as an escape hatch if you change your mind.

**But this is your data and your call.** If "my financial data never touches your server" is a line you don't want to cross, say so and we will build B instead — it costs roughly the same effort, with a different risk profile.

**Your answer:** ___________

---

### Q4. One-way or two-way?

| Option | |
|---|---|
| **A. One-way** — app writes to the sheet; edits you make in the sheet are overwritten on the next backup | |
| **B. Two-way** — edits in the sheet flow back into the app | |
| **C. One-way now; a separate, explicit "Restore from sheet" button later** | |

Two-way sync on a surface the user can freely edit is where backup features go wrong. The specific failure: you delete a row in the sheet to tidy it up, the app interprets that as deleting a transaction, and it disappears from every device. That is unrecoverable, and it is the single most likely way this feature could actually hurt you.

Phase 5 of the plan designs restore properly if you ever want it — mandatory local snapshot before import, zod validation of every row, a dry-run diff you must confirm, never automatic. It is 4–5 additional days.

**My recommendation: C.** One-way for v1. A restore path exists on paper and can be built later if you find you actually want it. My guess is you won't — what you described is a *backup*, and backups are one-way by nature.

**Your answer:** ___________

---

## Configuration Decisions

### Q5. What lives in the spreadsheet?

Proposed tabs: `Transactions`, `Accounts`, `Categories`, `GoldItems`, `ZakatCalculations`, `ZakatPayments`, `Config`, plus a `_Meta` tab for versioning and integrity.

Three things I have deliberately **excluded** — please confirm:

| Excluded | Why |
|---|---|
| `pinHash` (your App Lock PIN hash) | A hash of a 4-digit PIN is brute-forced instantly. Putting it in a plaintext cloud document you might share is indefensible. *(Note: `sync.ts` **does** sync this to your Firebase today — defensible there, behind auth rules, but not here.)* |
| `firebaseConfig` and `goldApiKey` | Real API keys. Never belong in a shareable document. |
| `dashboardStats` | A derived cache; the app recomputes it. Backing it up only creates stale-data hazards. |

Consequence: after restoring to a new device you re-set your App Lock PIN and re-paste your Firebase config. That seems right to me.

| Option | |
|---|---|
| **A** | Agree with the exclusions |
| **B** | Include `pinHash` too |
| **C** | Something else — specify |

**My recommendation: A.**

**Your answer:** ___________

---

### Q6. Should the sheet be human-readable, machine-readable, or both?

The existing `.xlsx` export is shaped for Hysab Kytab — `ACTIVITIES` / `ACCOUNT` / `CATEGORY`, with account and category *names* instead of IDs, no timestamps, one currency. It's readable, but it is **lossy**: without IDs and `updatedAt` there is no way to restore it correctly.

| Option | |
|---|---|
| **A. Machine-first** — IDs, ISO timestamps, tombstones. Readable but slightly technical (a UUID column, a `deletedAt` column). |
| **B. Human-first** — reuse the export layout. Pretty, but **cannot be restored from.** |
| **C. Both** — machine-readable data tabs plus an extra read-only `Summary` tab with monthly totals and balances. |

**My recommendation: A for v1, C later** (it's Phase 6, ~1 day). A backup's primary job is to be restorable. The data tabs will still be perfectly readable — frozen headers, filters, deleted rows greyed out — just with a couple of extra technical columns. If you want the pretty summary view, we add it once the important part works.

**Your answer:** ___________

---

### Q7. How do Firebase sync and Sheets backup relate?

| Option | |
|---|---|
| **A. Both on at once** — Firebase for device sync, Sheets for readable backup |
| **B. Mutually exclusive** — pick one |
| **C. Both, but warn that it's unusual** |

They do different jobs: Firebase is continuous two-way device sync; Sheets is a periodic, human-readable, one-way snapshot. They don't conflict — and having Firebase on actually *helps*, because the sheet's ID rides along in the prefs sync so a second device finds the same sheet automatically.

**My recommendation: A**, with one line of copy in the panel explaining the difference. No warnings.

**Your answer:** ___________

---

### Q8. Automatic backup — what triggers it?

| Option | |
|---|---|
| **A. Manual only** — you press "Back up now" |
| **B. Manual + optional daily auto-backup, off by default** |
| **C. Auto-backup on by default** |
| **D. Back up after every change** |

D is out: a snapshot rewrite after every transaction edit would burn API quota for no benefit, and Google has announced that quota overages will start incurring charges later in 2026.

**My recommendation: B.** Off by default, so nothing surprising happens. When enabled: at most once per 24 hours, only on app foreground, only when online, only when something actually changed. This mirrors the conservatism already in `sync-store.ts`.

**Your answer:** ___________

---

### Q9. What happens on "Disconnect"?

| Option | |
|---|---|
| **A. Ask** — "Disconnect only" or "Disconnect and delete the sheet" |
| **B. Always keep the sheet** |
| **C. Always delete the sheet** |

**My recommendation: A**, and "delete" means move to Drive trash, never permanent delete — you keep 30 days to change your mind.

**Your answer:** ___________

---

### Q10. What should the spreadsheet be called?

| Option | |
|---|---|
| **A** | `MizanTrack Backup — salman@gmail.com` |
| **B** | `MizanTrack Backup` |
| **C** | `MizanTrack Backup (2026-09-29)` — but note the app **updates** one file rather than creating dated copies, so a date in the name goes stale |
| **D** | Let the user choose at connect time |

**My recommendation: A**, renameable from the `⋮` menu. The app tracks the file by ID, not name, so renaming it never breaks anything.

**Your answer:** ___________

---

## Operational Decisions

### Q11. Are you willing to change the Google Cloud Console settings? *(Release blocker.)*

Three things must happen in the Google Cloud Console — about 15 minutes of clicking, no code:

1. Add the `drive.file` scope under Google Auth Platform → Data Access
2. Enable the Google Sheets API and the Google Drive API
3. **Set the OAuth consent screen publishing status to "In production"**

Item 3 matters more than it looks. Google's documentation confirms that apps left in **Testing** status have their refresh tokens **expire after 7 days**. If we skip this, you will be forced to reconnect Google Sheets *every single week*, and it will feel like a bug.

For non-sensitive scopes, switching to "In production" does **not** require verification. You may see an "unverified app" notice on the consent screen, with an "Advanced → Go to MizanTrack" path. That is cosmetic and can be removed later via brand verification if you ever want to (it needs a real homepage on a verified domain plus a privacy policy).

| Option | |
|---|---|
| **A** | Yes, I'll make these changes |
| **B** | Yes, but walk me through it step by step |
| **C** | No — leave it in Testing (**means weekly reconnection, forever**) |

**My recommendation: A or B.**

**Your answer:** ___________

---

### Q12. Is the "unverified app" consent screen acceptable?

Until (and unless) brand verification is completed, the consent screen shows an unverified-app notice rather than a polished app name and logo. Google caps unverified apps at **100 users total**, which is irrelevant for you.

Google also has an explicit exemption that covers your situation outright:

> "An app is considered to be for personal use if it's **not shared with anyone else or will be used by fewer than 100 people (all of whom are known personally to you).**"
> — <https://developers.google.com/identity/protocols/oauth2/policies>

| Option | |
|---|---|
| **A** | Fine — it's my own app |
| **B** | Pursue brand verification later (needs a homepage on a domain you own + a privacy policy) |
| **C** | Pursue brand verification before launch |

**My recommendation: A**, revisiting if MizanTrack ever goes public.

**Your answer:** ___________

---

### Q13. How big is your real dataset?

This calibrates chunking and the time estimates. Rough numbers are fine.

- Transactions: ~_______
- Accounts: ~_______
- Categories: ~_______
- Gold items: ~_______
- Zakat calculations: ~_______

For reference: 50,000 transactions ≈ 850,000 cells ≈ **4%** of Google Sheets' 20-million-cell limit, and a full backup would take roughly 9 API requests — about 15% of the per-minute quota. You would need over a million transactions to approach any hard limit.

**Your answer:** ___________

---

### Q14. Anything else the sheet should contain?

Currently planned: the 7 data tabs plus `_Meta`.

Possible additions (each roughly half a day):
- A `Summary` tab — monthly income/expense, per-account balances
- A `Zakat Summary` tab formatted like your existing zakat tracker sheet
- A `Changelog` tab logging each backup run

**My recommendation:** none for v1. Ship the backup, then add what you actually miss.

**Your answer:** ___________

---

## Quick Answer Sheet

If you agree with every recommendation, you can reply with just this:

| # | Question | Recommendation |
|---|---|---|
| 1 | Proceed? | **B** — Phases 0–2 first, then reassess |
| 2 | Which scope? | **A** — `drive.file` only |
| 3 | Where do API calls happen? | **A** — server proxy *(please read this one properly)* |
| 4 | One-way or two-way? | **C** — one-way now, restore later if wanted |
| 5 | Exclude PIN hash, API keys, stats cache? | **A** — agree |
| 6 | Sheet format? | **A** — machine-first; pretty summary later |
| 7 | Firebase + Sheets together? | **A** — both on, no warnings |
| 8 | Auto-backup? | **B** — daily, off by default |
| 9 | Disconnect behaviour? | **A** — ask; trash, not delete |
| 10 | Sheet name? | **A** — `MizanTrack Backup — <email>` |
| 11 | Change Cloud Console settings? | **A/B** — required |
| 12 | Unverified consent screen OK? | **A** — yes |
| 13 | Dataset size? | *needs your numbers* |
| 14 | Extra tabs? | none for v1 |

> Reply "agree with all, dataset is roughly N transactions" and Phase 0 can start the same day.

---

## What happens once you answer

1. **Phase 0 (1 day)** — Google Cloud setup plus the technical spike. One genuinely open question remains: whether Google's Drive API lets the app re-find its own backup file on a new device using only the `drive.file` permission. Google's documentation is ambiguous on this and I did not want to guess. The design already works without it, but the spike tells us whether the recovery path is "automatic" or "paste the sheet's URL".
2. **Phase 1 (2–3 days)** — connect/disconnect works; nothing is written yet.
3. **Phase 2 (3–4 days)** — your first real Google Sheet backup.
4. **Reassess** — use it for a week, then decide on Phases 3–4.

---

## One thing I want to be straight about

The recommended architecture (Q3, option A) means your financial data passes through the MizanTrack server on its way to Google. It is held in memory, forwarded, and discarded — never stored, never logged, and there is an explicit audit task in the plan to make sure no debug logging ever leaks a row.

But that is a change from how the app works today, where your data goes straight from your device to your own Firebase project and touches nothing of mine. I think it's the right call, because the alternative puts a Google Drive write token inside your browser where any cross-site-scripting bug could steal it. But you should be making that trade deliberately rather than discovering it later.

If it bothers you, say so. The alternative is buildable for roughly the same effort.
