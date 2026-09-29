# Feasibility Study: Google Sheets as an Alternative Backup Target

**Document Version:** 1.0
**Last Updated:** 2026-09-29
**Status:** Awaiting user decisions — see `docs/google-sheets-backup-questions.md`
**Repository:** mizantrack
**Related:** `docs/google-sheets-backup-design.md`, `docs/google-sheets-backup-plan.md`

---

## Table of Contents

1. [Verdict](#1-verdict)
2. [What Was Asked](#2-what-was-asked)
3. [Current System — What Exists Today](#3-current-system--what-exists-today)
4. [Scope Analysis](#4-scope-analysis)
5. [Google Verification & App Review](#5-google-verification--app-review)
6. [Incremental Authorisation in next-auth v5](#6-incremental-authorisation-in-next-auth-v5)
7. [Refresh Token Handling](#7-refresh-token-handling)
8. [Server Route Handler vs. Direct Browser Calls](#8-server-route-handler-vs-direct-browser-calls)
9. [Technical Limits That Actually Bite](#9-technical-limits-that-actually-bite)
10. [Risk Register](#10-risk-register)
11. [Unknowns That Must Be Resolved by a Spike](#11-unknowns-that-must-be-resolved-by-a-spike)
12. [Sources](#12-sources)

---

## 1. Verdict

**Yes — this is feasible, and it is one of the cheaper features on the roadmap, *provided* we use the `drive.file` scope and nothing broader.**

The single most important finding of this study:

> `https://www.googleapis.com/auth/drive.file` is classified by Google as a **non-sensitive** scope. Apps that request only non-sensitive scopes **are not required to complete Google's OAuth app verification**, and therefore never trigger a CASA third-party security assessment.
> — <https://support.google.com/cloud/answer/13463073>

That one fact moves this feature from "multi-thousand-dollar annual compliance burden" to "a normal two-to-three-week engineering task." `drive.file` is sufficient to **create** a spreadsheet, **write** to it, **update** it, **rename** it and **delete** it — because a file the app itself created is, by definition, a file the app has per-file access to.

**The key caveat.** There are three, in order of importance:

1. **File re-discovery on a new device is documented ambiguously.** Google's Sheets guide says "Using the `files.list` method to list a user's spreadsheets requires a restricted Drive API scope" (<https://developers.google.com/workspace/sheets/api/guides/create>). In practice `drive.file` restricts the *result set* of `files.list` to app-created files, so an `appProperties`-filtered query should return only our own backup file without a broader scope — but **we could not find an unambiguous official sentence confirming this.** The design therefore does not depend on it: the `spreadsheetId` is persisted locally and propagated via the existing Firebase prefs sync, with the Drive query only as a secondary recovery path. **This must be validated by a one-day spike before Phase 1 is committed** (see §11).
2. **MizanTrack has no server-side datastore today.** `@auth/firebase-adapter` is in `package.json` but is *not* wired into `src/lib/auth.ts` — the app runs on the default JWT session strategy with no database. There is therefore nowhere to put a refresh token except the Auth.js encrypted session cookie. That is acceptable for user-initiated backups (which is what is being asked for) but rules out unattended/scheduled server-side backups without new infrastructure.
3. **The app does not request offline access today.** `src/lib/auth.ts` passes only `{ prompt: "select_account" }` and no `access_type`, so Google currently issues **no refresh token at all**, and the `jwt` callback discards `account.access_token`. Everything token-related is net-new work.

An honest difficulty rating: **Medium.** The Google API surface is simple and well documented. The complexity is concentrated in (a) token lifecycle correctness, (b) not breaking the existing sign-in flow when adding incremental consent, and (c) chunking large datasets within Sheets' payload guidance. There is no research risk of the "will this even work" kind, only execution risk.

---

## 2. What Was Asked

> "I want you to plan it as a side job to directly be able to create / save / update a Google Sheet instead of just exporting for backup … an alternative backup to Google Sheets using the same Gmail account the user is logged in with. Is it possible?"

Restated as requirements:

| ID | Requirement |
|---|---|
| FR-GS-001 | The app creates a real Google Spreadsheet in the signed-in user's own Google Drive |
| FR-GS-002 | The app writes the user's MizanTrack data into that spreadsheet |
| FR-GS-003 | On subsequent backups the app **updates the same spreadsheet** rather than creating a new one |
| FR-GS-004 | Authorisation reuses the Google account the user already signed in with — no second account, no service account, no API key pasting |
| FR-GS-005 | This is an *alternative* backup target, coexisting with the existing Firebase sync and the existing `.xlsx` download |

---

## 3. Current System — What Exists Today

Read before designing anything. Every statement below was verified against the source in this repository.

### 3.1 Authentication — `src/lib/auth.ts`

```ts
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.AUTH_GOOGLE_ID!,
      clientSecret: process.env.AUTH_GOOGLE_SECRET!,
      authorization: { params: { prompt: "select_account" } },
    }),
  ],
  callbacks: { authorized, jwt, session },
  pages: { signIn: "/login" },
});
```

| Question | Answer |
|---|---|
| Session strategy | **JWT** — no `adapter` key is passed, so Auth.js defaults to JWT. The session is an encrypted (JWE) cookie. |
| Is `@auth/firebase-adapter` used? | **No.** It is listed in `package.json` (`^2.11.1`) but never imported anywhere in `src/`. There is no central Firestore project and no server-side account table. |
| Scopes requested | Auth.js Google provider defaults only — `openid email profile`. No Drive, no Sheets. |
| `access_type` | **Not set.** Defaults to `online` → Google issues **no refresh token**. |
| Is `access_token` persisted? | **No.** The `jwt` callback receives `account` on initial sign-in but only calls `pinTokenSubToProvider(token, account)`, which copies `account.providerAccountId` into `token.sub` and drops everything else. |
| What the session exposes | `session.user.{id,name,email,image}` only. `id` is Google's stable numeric `sub`, deliberately pinned (see `src/lib/auth/session.ts` — the UUID-fallback bug it works around is documented there). |

**Implication:** obtaining a Drive-capable token is entirely additive work. Nothing existing needs to be redesigned, but the `jwt` callback must be extended carefully so it does not clobber tokens on re-sign-in (see §7.3).

### 3.2 Route protection — `src/proxy.ts`

Next.js 16 renamed Middleware to **Proxy** (`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`: *"Starting with Next.js 16, Middleware is now called Proxy to better reflect its purpose."*). The repo already has `src/proxy.ts` using the `auth()` wrapper.

Its matcher is:

```
/((?!api|_next/static|_next/image|_next/data|favicon\.ico|manifest\.json|icon-.*\.png|sw\.js|workbox-.*\.js|offline|login).*)
```

**`api` is excluded.** Any new route handler under `/api/…` is therefore **not** protected by Proxy and **must** call `auth()` itself. This is the single easiest way to ship an authentication hole in this feature. The Next.js 16 Proxy guide says the same thing in general terms: *"it should not be used as a full session management or authorization solution."*

### 3.3 Local database — `src/lib/db/local.ts`

Dexie, database name `mizantrack`, currently at **version 4**:

| Table | Primary key + indexes |
|---|---|
| `accounts` | `id, userId, isArchived, accountType, updatedAt, deletedAt` |
| `categories` | `id, userId, type, currency, updatedAt, deletedAt` |
| `transactions` | `id, userId, type, date, accountId, categoryId, toAccountId, updatedAt, deletedAt` |
| `dbConfig` | `id` (= userId) |
| `syncMeta` | `id` |
| `dashboardStats` | `id, updatedAt` |
| `goldItems` | `id, userId, purity, updatedAt, deletedAt` |
| `zakatCalculations` | `id, userId, islamicYear, assessmentDate, updatedAt, deletedAt` |
| `zakatPayments` | `id, userId, islamicYear, date, calculationId, updatedAt, deletedAt` |

Conventions in `src/types/index.ts`: every syncable record carries `updatedAt: number` (Unix ms) and an optional `deletedAt?: number` soft-delete tombstone. `dashboardStats` is a derived cache and should never be a backup source of truth.

### 3.4 Existing Firebase sync — `src/lib/db/sync.ts`

This is the closest analogue and the design borrows from it heavily.

- **Bring-your-own-Firebase.** The user pastes their *own* Firebase web config JSON into `dbConfig.firebaseConfig`; `getFirestoreForUser()` initialises a per-user app instance. The developer runs no central database. This is a deliberate privacy stance and it constrains the Sheets design (see §8).
- **Runs entirely client-side.** Firestore is talked to from the browser.
- **Per-table high-water marks.** `syncMeta` holds `lastSync:accounts`, `lastSync:categories`, `lastSync:transactions` (with a legacy `lastSync` fallback).
- **Push:** records where `updatedAt > lastSync`, batched at 499 (Firestore's 500 limit), `undefined` values stripped.
- **Pull:** `where("updatedAt", ">", lastSync)`, applied locally only if `!local || remote.updatedAt > local.updatedAt` — **last-write-wins on `updatedAt`.**
- **Watermark is captured *before* the sync runs** (`syncStartedAt`), which is the correct ordering to avoid losing concurrent edits.
- **Coverage gap:** only `accounts`, `categories`, `transactions` sync, plus two fixed documents (`settings/prefs`, `analytics/dashboard`). **`goldItems`, `zakatCalculations` and `zakatPayments` are not backed up anywhere today.** Google Sheets backup closes that gap — a genuine, independent reason to fund this work.

### 3.5 Existing export — `src/lib/export.ts`, `src/lib/zakatExport.ts`

`exportToExcel()` builds a workbook with three sheets — `ACTIVITIES`, `ACCOUNT`, `CATEGORY` — deliberately shaped to match the Hysab Kytab import format that `src/lib/import/hysabKytab.ts` consumes.

**This format is unsuitable as a backup format** and that must be stated plainly:

- It carries **no `id`** — records cannot be matched on re-import, only heuristically re-created.
- It carries **no `updatedAt` or `deletedAt`** — no conflict resolution and no tombstones are possible.
- It is **single-currency** and filters by date range — it is a *report*, not a *snapshot*.
- Account/category IDs are flattened to display names.

Conclusion: the Google Sheet needs its **own, lossless, ID-bearing tab layout**. Human familiarity can be provided by an optional extra read-only "Summary" tab in a later phase (see the design doc §5.4). Do not reuse the Hysab Kytab layout for the backup tabs.

### 3.6 Settings UI — `src/components/settings/`

`SettingsPageClient.tsx` renders, in order: `PreferencesForm`, `AppLockSettings`, a two-column grid of `ImportPanel` + `ExportPanel`, then `FirebaseSyncPanel`, then `ResetLocalDataPanel`.

`FirebaseSyncPanel.tsx` is the template to copy: a bordered card (`rounded-xl border border-border/60 bg-card p-4 shadow-[var(--shadow-card)]`), a heading, an enable `Switch`, action `Button`s, a status line using `formatDistanceToNow`, a `Progress` bar for usage, a per-table "backed up / pending" breakdown, and destructive actions behind a `Dialog`. A Google Sheets panel that mirrors this will look native immediately.

### 3.7 Configuration conventions

`.env.local.example` currently contains exactly three variables — `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`. **This feature requires no new secrets**, only additional scopes on the existing OAuth client. That is a meaningful reduction in operational risk.

`next.config.js` wraps the config in `@ducanh2912/next-pwa` with a catch-all `runtimeCaching` rule: `urlPattern: /^https?.*/` with a `NetworkFirst` handler and a 10-second network timeout. **This will intercept GET requests to any new API route.** The design must add a `NetworkOnly` exclusion for the backup endpoints — see design doc §9.3.

---

## 4. Scope Analysis

### 4.1 The options

| Scope | Google classification | Can create a Sheet? | Can write to it? | Can list *all* the user's sheets? | Verification required? |
|---|---|---|---|---|---|
| `…/auth/drive.file` | **Non-sensitive** | Yes | Yes (files it created) | No — app-created files only | **No** |
| `…/auth/drive.appdata` | Non-sensitive | Only into the hidden app-data folder | Yes | No | No |
| `…/auth/spreadsheets` | Not explicitly classified in the table we could retrieve; widely treated as **sensitive** | Yes | Yes (any sheet) | No (that's a Drive capability) | Yes, if sensitive |
| `…/auth/drive` | **Restricted** | Yes | Yes | Yes | Yes + **CASA annual security assessment** |
| `…/auth/drive.readonly` | **Restricted** | — | — | Yes | Yes + CASA |
| `…/auth/drive.metadata.readonly` | **Restricted** | — | — | Metadata only | Yes + CASA |

Source for the Drive classifications: <https://developers.google.com/workspace/drive/api/guides/api-specific-auth>. Google's verbatim description of `drive.file` is:

> "Create new Drive files, or modify existing files, that you open with an app or that the user shares with an app while using the Google Picker API or the app's file picker."

### 4.2 Recommendation — `drive.file` only

**Request exactly `https://www.googleapis.com/auth/drive.file` in addition to the existing `openid email profile`. Request nothing else.**

Reasoning:

1. **It is sufficient.** `spreadsheets.create` accepts `drive.file`, and every subsequent `spreadsheets.values.*` / `spreadsheets.batchUpdate` call operates on a `spreadsheetId` the app itself created — which is precisely what `drive.file` grants. Setting `appProperties` via `files.update`, renaming, and trashing the file are likewise operations on an app-created file.
2. **It is non-sensitive, so no verification and no CASA.** This is the decisive commercial fact (§5).
3. **It is the honest scope.** The app genuinely does not need to see any other file in the user's Drive, and the consent screen will say so. For an app holding a user's complete financial history, "this app can only touch the one file it made for you" is a meaningfully better story than "this app can see and manage all your Drive files."
4. **It has no deprecation risk.** The only recent movement around `drive.file` was an *enhancement* — `DocsView.setFileIds()` in the Google Picker API, announced November 2024 and rolling out from 20 January 2025 (<https://workspaceupdates.googleblog.com/2024/11/new-file-picker-method-for-pre-selecting-google-drive-files.html>). No deprecation notice exists; Google continues to position it as the preferred low-friction scope.

**Why not `spreadsheets`?** It buys nothing we need — we only ever touch our own file — and it is very likely classified sensitive, which pulls in the verification process for zero benefit.

**Why not `drive`?** It is restricted. It would force an annual CASA assessment (<https://support.google.com/cloud/answer/13465431>) for the single capability of enumerating the user's spreadsheets — which the design avoids by other means.

### 4.3 Consequences of choosing `drive.file`

| Consequence | Impact | Mitigation |
|---|---|---|
| The app cannot see a spreadsheet the user created by hand | Low — we create the file ourselves | Document that "Back up to an existing sheet of mine" is not supported without a Google Picker integration |
| If the user deletes the backup sheet, the app cannot find it again by name | Medium | Detect `404`/`trashed` and offer to create a fresh one (design §8.4) |
| Re-discovery on a new device depends on `files.list` + `appProperties` behaviour that is not explicitly documented | **This is the top technical risk** | Primary discovery is the stored `spreadsheetId` synced through Firebase prefs; the Drive query is only a fallback. Validate by spike (§11). |

---

## 5. Google Verification & App Review

### 5.1 When verification is required

> "Apps that request access to scopes categorized as **sensitive** or **restricted** must complete Google's OAuth app verification before being granted access… If your app utilizes only **non-sensitive** scopes, it is not mandatory for your app to complete the app verification process. However, if you want your app to display an app name and logo on the OAuth consent screen, you will need to complete a lighter-weight verification process known as 'brand-verification'."
> — <https://support.google.com/cloud/answer/13463073>

Three tiers:

| Tier | Trigger | What it costs you |
|---|---|---|
| **Brand verification** | Wanting your app name + logo shown on the consent screen, in production, for any scope | A verified domain you own, a real homepage describing the app, and a privacy policy linked from both the homepage and the consent screen |
| **Sensitive-scope verification** | Requesting a sensitive scope | The above, plus a scope-justification review and usually a demo video |
| **Restricted-scope verification** | Requesting a restricted scope (e.g. `drive`) | All of the above, plus an **annual CASA security assessment** |

Because MizanTrack with `drive.file` sits in the non-sensitive band, **none of these is mandatory.**

### 5.2 The personal-use exemption

Separately and additionally, Google's OAuth 2.0 Policies page (last modified 5 August 2026) defines:

> "An app is considered to be for personal use if it's **not shared with anyone else or will be used by fewer than 100 people (all of whom are known personally to you).**"
> — <https://developers.google.com/identity/protocols/oauth2/policies>

For MizanTrack's actual audience today — the developer and family — this exemption applies on its own terms, independent of the scope choice.

### 5.3 What the user actually experiences

Two publishing statuses matter, both documented at <https://developers.google.com/identity/protocols/oauth2/production-readiness/overview>:

**Testing / External:**

> "Only users explicitly added to the test user allowlist can access the app (limited to a hard cap of **100 test users**). Exception: If the app only requests basic identity scopes (`openid`, `email`, `profile`), any user can access without being on the allowlist. Users see a warning UI indicating the app is in testing, rather than the standard unverified app screen."

**Published / External / Unverified:**

> "Any Google user can access. **Strongly discouraged.** Because the app has not completed brand verification, the app's name and logo are not displayed… for apps requesting sensitive or restricted scopes, unverified app warnings (Danger UI) will be displayed to users, and **a hard cap of 100 total users applies**."

So the 100-user cap applies in **both** statuses for an unverified app. For this project that is not a constraint.

The practical experience for a single personal user: a consent screen that shows the raw OAuth client ID or an unverified-app notice rather than a polished app name and logo, with an "Advanced → Go to … (unsafe)" style escape hatch. Once consent is granted, everything works normally.

### 5.4 The one trap to avoid: Testing mode and the 7-day refresh token

This is the highest-impact operational gotcha in the whole feature.

> "This status overrides certain standard OAuth limitations for the organization's users, such as **the 100-test-user cap and the 7-day refresh token expiration limit for apps in the Testing status**."
> — <https://developers.google.com/identity/protocols/oauth2/production-readiness/overview> (describing the Workspace-admin "Trusted" override)

That sentence is an explicit, current confirmation that **refresh tokens issued by an app in Testing publishing status expire after 7 days.** If MizanTrack's OAuth client is left in Testing, the user will be forced to re-consent **every week**, forever, and it will look like a bug.

**Action:** the OAuth consent screen must be moved to **"In production"** publishing status. This is a single toggle in the Google Auth Platform → Audience page and, for non-sensitive scopes, does **not** by itself require verification. This is a configuration step, not an engineering task, but it is a release blocker.

### 5.5 Console changes to expect (2025–2026)

Consent-screen configuration now lives under **Google Auth Platform** in the Cloud Console, split across **Branding** (`/auth/branding`), **Audience** (`/auth/audience`) and **Data Access** (`/auth/scopes`) — <https://developers.google.com/workspace/guides/configure-oauth-consent>.

If brand verification is ever pursued, the homepage requirements are strict (<https://support.google.com/cloud/answer/13464321>): the homepage must be on a **verified domain you own**, must describe the app's functionality, **cannot be only a login page**, and must itself link to the privacy policy using the same URL given on the consent screen. The OAuth policies page additionally requires **separate projects for testing and production** and a **hosted homepage for production apps**.

Cloud Console's own Data Access screen labels each scope's sensitivity live; treat it as the authoritative check at implementation time.

### 5.6 Cost if we ever did need restricted scopes

Google publishes **no** official price or turnaround for CASA. The framework is described at <https://support.google.com/cloud/answer/13465431>:

> "applications requesting access to restricted scopes must undergo an **annual security assessment**… leveraging the industry standard App Defense Alliance and its Cloud App Security Assessment framework (CASA)… assigned to either the **AL1 or AL2** assurance level… **Annual Recertification**: All applications must be revalidated every year."

Third-party assessor pricing found in search results suggests roughly **$500–$4,500/year** for AL1. **This is not a Google figure and should not be quoted as one.** It is included only to size the risk of *not* choosing `drive.file`. With `drive.file`, this cost is **$0** and the point is moot.

---

## 6. Incremental Authorisation in next-auth v5

**Goal:** plain sign-in stays lightweight (`openid email profile`, no scary consent screen). The Drive scope is requested only when — and if — the user switches on Sheets backup in Settings.

### 6.1 The mechanism (verified against the installed package)

`next-auth@5.0.0-beta.31` exposes a **third parameter** on `signIn` for arbitrary authorization parameters, in both the server and client entry points:

```
// node_modules/next-auth/index.d.ts:263
signIn: <P extends ProviderId, R extends boolean = true>(
  provider?: P,
  options?: FormData | ({ redirectTo?: string; redirect?: R } & Record<string, any>),
  authorizationParams?: string[][] | Record<string, string> | string | URLSearchParams
) => Promise<R extends false ? any : never>;

// node_modules/next-auth/react.d.ts:79
export declare function signIn(provider?, options?, authorizationParams?): Promise<void>;
```

`next-auth/lib/actions.js:19` shows they are simply appended to the sign-in URL query string:

```js
let url = `${signInURL}/${provider}?${new URLSearchParams(authorizationParams)}`;
```

and `@auth/core/lib/actions/signin/authorization-url.js` merges them **last**:

```js
const params = Object.assign(
  { response_type: "code", client_id: provider.clientId, redirect_uri, ...provider.authorization?.params },
  Object.fromEntries(provider.authorization?.url.searchParams ?? []),
  query            // <-- our authorizationParams, wins on conflict
);
```

**This is the decisive detail:** signIn-time `authorizationParams` **override** the provider-level `authorization.params`. The existing `prompt: "select_account"` in `src/lib/auth.ts` can therefore be overridden with `prompt: "consent"` for the upgrade flow only, without touching the default sign-in experience at all.

### 6.2 The concrete upgrade call

```ts
// Server Action, invoked from the Settings panel
"use server";
import { signIn } from "@/lib/auth";

export async function connectGoogleSheetsAction() {
  await signIn(
    "google",
    { redirectTo: "/settings?sheets=connected" },
    {
      scope: "openid email profile https://www.googleapis.com/auth/drive.file",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
    }
  );
}
```

Parameter-by-parameter:

| Parameter | Why |
|---|---|
| `scope` | Must repeat the base OIDC scopes — Auth.js needs the ID token to complete the sign-in |
| `access_type=offline` | *"instructs the Google authorization server to return a refresh token and an access token the first time that your application exchanges an authorization code for tokens"* — <https://developers.google.com/identity/protocols/oauth2/web-server> |
| `prompt=consent` | Forces the consent screen so a **new refresh token is issued every time**, defeating the "only on first authorization" behaviour. Auth.js's own Google provider docs warn about exactly this: *"Google only provides Refresh Token to an application the first time a user signs in."* |
| `include_granted_scopes=true` | *"If you set this parameter's value to `true` and the authorization request is granted, then the new access token will also cover any scopes to which the user previously granted the application access."* — same source |

### 6.3 The alternative we rejected

A second `GoogleProvider({ id: "google-drive", … })` instance with Drive scopes baked in would also work, and reads slightly more declaratively. It is rejected because it doubles the provider surface, requires a second entry in `ProviderId`, and adds an account-linking code path that the JWT-only setup does not need. The `authorizationParams` approach requires **zero** changes to the provider configuration.

---

## 7. Refresh Token Handling

### 7.1 Where tokens can live — and the constraint nobody expects

**MizanTrack has no server-side database.** There is no central Firestore, no Postgres, no adapter. The only server-side persistence available is the Auth.js session cookie itself.

| Option | Viability |
|---|---|
| **A. Auth.js encrypted JWT session cookie** | **Recommended for Phase 1.** Auth.js encrypts the JWT as a JWE with `AUTH_SECRET`; the browser cannot read it. Zero new infrastructure, zero new secrets. Cost: tokens are lost on sign-out, and the cookie grows by ~300 bytes. |
| **B. Wire up `@auth/firebase-adapter` against a central Firestore** | Possible — the dependency is already installed — but requires provisioning a Firebase project *the developer owns*, a service-account secret, and contradicts the app's BYO-Firebase privacy stance. Only needed if unattended/scheduled server-side backups are wanted. |
| **C. The user's own Firestore** | Do **not** do this. The user's Firebase config lives client-side and the client would need the token to write it — which defeats the entire point of keeping tokens off the client. |
| **D. IndexedDB / `localStorage`** | **Never.** A refresh token in `localStorage` is a long-lived, XSS-exfiltratable credential to the user's Google Drive. |

**Recommendation: Option A.** It exactly matches the requested feature (user presses "Back up now", or the app backs up while open), and it can be upgraded to Option B later without changing the API surface.

### 7.2 Refresh flow

Access tokens are short-lived (approximately one hour — widely established, though we did not re-quote an official page stating the exact figure in this study). The refresh is a plain POST:

```
POST https://oauth2.googleapis.com/token
Content-Type: application/x-www-form-urlencoded

client_id=…&client_secret=…&grant_type=refresh_token&refresh_token=…
```

The `jwt` callback is the right place to do this: on every request, if `token.googleExpiresAt` is within a 60-second skew of now, refresh and write the new values back onto the token.

### 7.3 The bug we must not ship

The existing `jwt` callback is:

```ts
jwt({ token, account }) {
  return pinTokenSubToProvider(token, account) as typeof token;
}
```

`src/components/layout/LockScreen.tsx:274` calls `signIn("google", { redirect: false })` — a **plain** re-sign-in with no `access_type=offline`. If the extended callback naively does `token.googleRefreshToken = account.refresh_token`, that call will overwrite a perfectly good refresh token with `undefined` and silently disconnect Sheets backup.

**Rule: only assign token fields when the incoming `account` actually carries them.** Guard on `account?.scope?.includes("drive.file")` and on the individual values being non-nullish. This is called out again as an explicit acceptance criterion in the plan doc.

### 7.4 When refresh tokens die

| Cause | Verified? | Handling |
|---|---|---|
| App in **Testing** publishing status → 7-day expiry | **Yes**, official — see §5.4 | Move the OAuth client to "In production". Release blocker. |
| User revokes access at <https://myaccount.google.com/permissions> | **Yes** — *"Refresh tokens can be invalidated at any time. For example, the user could choose to revoke access to your app, a manual or automated process designed to protect users could purge the token, or the token could expire."* (<https://developers.google.com/identity/protocols/oauth2/policies>) | Surface "Reconnect Google Sheets" in Settings |
| OAuth **client** deleted after 6 months of inactivity | **Yes** — *"Google reserves the right to delete unused OAuth clients if the client is inactive for at least 6 months… Deleted clients can be restored… for 30 days following deletion."* (same page) | Operational note for the developer, not a user-facing case |
| >100 refresh tokens per client per account; 6-month token inactivity; password-change invalidation for certain scopes | **Not re-verified** on a live official page in this study. Widely cited historically. | Treat all of them as "assume it can vanish"; the recovery path is identical |

Whatever the cause, the symptom is the same and is documented:

> "`invalid_grant`: When refreshing an access token or using incremental authorization, the token may have expired or has been invalidated. Authenticate the user again and ask for user consent to obtain new tokens… Otherwise, the user account may have been deleted or disabled."
> — <https://developers.google.com/identity/protocols/oauth2/web-server>

**Handling:** catch `invalid_grant` → clear the stored Google token fields from the JWT → set a `needsReconnect` flag on the session → the Settings panel shows "Reconnect" → re-run the §6.2 flow with `prompt=consent`. Never retry an `invalid_grant`; it will never succeed.

---

## 8. Server Route Handler vs. Direct Browser Calls

This is the most consequential architectural decision in the feature, and it is genuinely contested, because MizanTrack is an **offline-first PWA whose data lives only in the browser's IndexedDB**. The server has never seen the user's financial data and currently has no way to.

### 8.1 The two architectures

**Option A — Server route handler proxy.** The client reads rows from Dexie, POSTs them to `/api/google-sheets/backup`, and the Next.js server (Node runtime) holds the tokens and calls Google.

**Option B — Token broker.** The server mints a short-lived access token via `/api/google-sheets/token` and hands it to the browser; the browser calls `sheets.googleapis.com` directly.

### 8.2 Comparison

| | **A — Server proxy** | **B — Token broker** |
|---|---|---|
| Refresh token exposure | Never leaves the server | Never leaves the server |
| **Access token exposure** | **Never leaves the server** | **In browser memory for ~1 hour** — XSS-reachable |
| Financial data path | Device → **app server (memory only)** → Google | Device → Google, directly |
| CORS dependency | None | **Depends on undocumented behaviour** — see below |
| Payload limits | Bound by hosting request-body limits (Vercel ≈ 4.5 MB); requires chunking | None beyond Sheets' own 2 MB guidance |
| Retry / backoff / quota logic | Centralised, unit-testable server-side | Duplicated in the client bundle |
| Bundle-size impact | Zero client-side | Slightly larger client bundle |
| Offline behaviour | Identical — both require connectivity | Identical |

On CORS, our research could not locate any official Google statement that `sheets.googleapis.com` or `www.googleapis.com` returns permissive `Access-Control-Allow-Origin` headers for arbitrary web-app origins. Google's documented browser pattern is the `gapi` client library or Google Identity Services, not raw `fetch` from an arbitrary origin. **Option B therefore rests on an unverified assumption.**

### 8.3 Recommendation

**Choose Option A — route all Sheets and Drive calls through a Next.js 16 Route Handler.**

1. **No token ever reaches the browser.** For a scope that can write to the user's Drive, this is the correct posture. Google's own architectural distinction between the "code model" (tokens stay server-side) and the "token model" (token handed to client JS) points the same way, and next-auth already implements the code model.
2. **No reliance on unverified CORS behaviour.** Option B could fail at implementation time for reasons nobody can confirm in advance.
3. **Backoff, quota accounting and chunking live in one testable place**, mirroring how `src/lib/db/sync.ts` centralises Firestore batching.
4. **Tiny blast radius if the app server is compromised** — it is stateless with respect to this feature.

**The honest cost, stated plainly:** Option A means the user's financial rows transit the app's server. Today, with BYO-Firebase, they never do. That is a real regression in the app's privacy story and the user deserves to decide it consciously — it is Question 3 in the questions document. The mitigations are meaningful but not absolute:

- The route handler is `export const runtime = "nodejs"`, streams through, and **persists nothing**.
- **Never log request bodies.** Log only counts, durations and error codes.
- TLS end to end; the server already terminates an authenticated session for this user.
- MizanTrack is self-hostable — a user who objects can run the server themselves, at which point the objection disappears entirely.
- If the user rejects this trade-off, Option B remains available; the Phase 0 spike should therefore include a five-minute CORS probe to keep that door open.

### 8.4 Offline and PWA implications

- **Backups require connectivity.** They are a network operation like Firebase sync. The UI must disable "Back up now" when `navigator.onLine === false` and say why.
- **Do not attempt Background Sync.** A backup is a multi-request, token-refreshing, several-megabyte operation. The Background Sync API's one-shot model is a poor fit and the failure modes are invisible to the user. Trigger backups from the foreground only.
- **The service worker must not cache these routes.** `next.config.js` currently applies `NetworkFirst` to `/^https?.*/`, which would serve a stale cached response for a GET status endpoint. Add a `NetworkOnly` rule for `/api/google-sheets/*` **ahead of** the catch-all (Workbox evaluates `runtimeCaching` rules in order).
- **The app must keep working entirely offline.** Nothing about this feature may become a startup dependency. If the backup panel cannot reach the server, it renders "Offline — last backed up 3 days ago" and does nothing else.

---

## 9. Technical Limits That Actually Bite

All figures below are from <https://developers.google.com/workspace/sheets/api/limits> unless noted.

| Limit | Value | Does it bite us? |
|---|---|---|
| Read requests | 300/min per project, **60/min per user per project** | No — a full backup is ~10 requests |
| Write requests | 300/min per project, **60/min per user per project** | Only if we chunk too aggressively. Budget ≤ 30 writes per backup run. |
| Requests per day | *"Provided that you stay within the per-minute quotas, there's no limit to the number of requests per day."* | No |
| Recommended max payload | *"there's no hard size limit for an API request… we recommend a 2 MB maximum payload"* | **Yes — this is the binding constraint.** Drives the chunking design. |
| Per-request processing time | *"more than 180 seconds… returns a timeout error"* | Only for pathological batches; chunking avoids it |
| Cells per spreadsheet | **20 million cells or 100 MB** — <https://support.google.com/drive/answer/37603> | No. 50,000 transactions × 17 columns ≈ 850k cells ≈ 4% of the ceiling. |
| Max columns / rows per sheet, max chars per cell | **Not found on an official page.** Commonly cited as 18,278 columns and 50,000 chars/cell. | Matters only for the JSON-encoded `ZakatCalculation.accountBalances` cell — see design §5.3 |
| Atomicity | *"All Sheets requests are applied atomically… if any request is not valid then the entire update is unsuccessful."* | Per request only. Multi-request runs need the `_Meta` status sentinel (design §8.5). |
| Backoff | Official algorithm `wait = min((2^n + random_ms), max_backoff)`, `max_backoff` 32–64 s | Implement exactly this |

**One forward-looking note worth flagging to the user**, from the same limits page:

> "All standard use of the Google Sheets API is available at no additional cost. **Exceeding the quota request limits is planned to incur charges to your Google Cloud billing account later in 2026.**"

It is free today, and staying inside 60 writes/minute/user keeps it free. The design's request budget (≤ 30 writes per run) has ample headroom, but this is a reason to prefer batched snapshot writes over chatty per-row updates.

Drive-side search syntax is confirmed at <https://developers.google.com/workspace/drive/api/guides/ref-search-terms>: `appProperties has { key='…' and value='…' }`. Drive API quotas live on a separate page that was not retrieved in this study.

---

## 10. Risk Register

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | `files.list` + `appProperties` does not work under `drive.file` alone | Medium | High — breaks new-device discovery | Stored `spreadsheetId` is the primary path; Drive query is fallback only. **Resolve by spike before Phase 1.** |
| R2 | OAuth client left in Testing → weekly re-consent | **High if forgotten** | High — looks like a broken feature | Publishing-status change is a checklist item in Phase 0 and a release blocker |
| R3 | Refresh token clobbered by `LockScreen`'s plain `signIn` | **High if unguarded** | High — silent disconnect | Guard the `jwt` callback on `account.scope` and non-nullish values; unit test it |
| R4 | Financial data transits the app server (Option A) | Certain | Medium — privacy posture regression | Stateless handler, no body logging, self-host path, explicit user consent. **User decision required.** |
| R5 | Partial write leaves the sheet half-updated | Medium | Medium — a corrupt backup is worse than none | `_Meta.status` sentinel written first/last plus a per-run `backupId`; UI shows "Last backup incomplete" |
| R6 | Two devices back up concurrently | Low | Medium — interleaved rows | Compare-and-set on `_Meta.backupId` + Drive `version`; second writer aborts with "another device is backing up" |
| R7 | Sheets coerces IDs/dates into the wrong type | Medium | High — silent data corruption on restore | `valueInputOption: "RAW"` everywhere; round-trip test in CI |
| R8 | Two-way sync loses data when the user edits the sheet | High **if built** | **Severe** | Phase it separately, gate it behind explicit opt-in, validate with zod, always snapshot before import |
| R9 | Service worker caches a backup-status response | Medium | Low | `NetworkOnly` rule ahead of the catch-all |
| R10 | Google changes `drive.file` classification | Low | High | Re-check Cloud Console's Data Access labels at each release; no deprecation signal exists today |

---

## 11. Unknowns That Must Be Resolved by a Spike

**Phase 0 exists precisely to close these. Roughly one day of work. Do not commit Phase 1 scope until it is done.**

1. **Does `files.list?q=appProperties has { key='mizantrackBackup' and value='v1' } and trashed=false` return results under `drive.file` alone?** This is R1 and the single most important open question. If it fails, discovery relies entirely on the stored `spreadsheetId` and the recovery UX becomes "paste your sheet's URL".
2. **Is `spreadsheets` labelled sensitive in Cloud Console today?** We could not find `spreadsheets` / `spreadsheets.readonly` in an official non-sensitive/sensitive/restricted classification table. Confirm by adding the scope in Cloud Console → Data Access and reading the label — then remove it. (Moot if we hold the line on `drive.file`.)
3. **Does `spreadsheets.create` succeed with only `drive.file` granted?** Expected yes; verify in five minutes.
4. **Does `sheets.googleapis.com` return usable CORS headers to a browser `fetch`?** Not needed for Option A, but determines whether Option B stays viable as a fallback.
5. **Actual wall-clock time and request count for a realistic dataset.** The repo contains a 2.2 MB `HYSAB KYTAB transaction data .xls` and a 312 KB CSV under `docs/` — import them and measure a real backup.
6. **Max characters per cell.** Needed to size the JSON-encoded `ZakatCalculation.accountBalances` cell. Test empirically with a large calculation.

---

## 12. Sources

Every Google-policy or API claim in this document traces to one of these. All were fetched and verified during this study except where explicitly marked.

**OAuth scopes and classification**
- Drive API-specific authorisation & scope classification — <https://developers.google.com/workspace/drive/api/guides/api-specific-auth>
- Full OAuth 2.0 scope list — <https://developers.google.com/identity/protocols/oauth2/scopes>
- Drive custom file properties (`appProperties`) — <https://developers.google.com/workspace/drive/api/guides/properties>
- Drive search query terms — <https://developers.google.com/workspace/drive/api/guides/ref-search-terms>
- Google Picker `setFileIds` announcement (Nov 2024, rollout Jan 2025) — <https://workspaceupdates.googleblog.com/2024/11/new-file-picker-method-for-pre-selecting-google-drive-files.html>

**Verification and policy**
- When OAuth app verification is required — <https://support.google.com/cloud/answer/13463073>
- Publishing status, user caps, 7-day testing-mode refresh-token expiry — <https://developers.google.com/identity/protocols/oauth2/production-readiness/overview>
- OAuth 2.0 policies, personal-use definition, refresh-token invalidation, unused-client deletion (last modified 2026-08-05) — <https://developers.google.com/identity/protocols/oauth2/policies>
- Restricted-scope CASA security assessment — <https://support.google.com/cloud/answer/13465431>
- Brand-verification homepage requirements — <https://support.google.com/cloud/answer/13464321>
- Configuring the OAuth consent screen (Google Auth Platform UI) — <https://developers.google.com/workspace/guides/configure-oauth-consent>

**Sheets and Drive APIs**
- Sheets API usage limits, quotas, 2 MB payload guidance, 180 s timeout, backoff algorithm, 2026 billing notice — <https://developers.google.com/workspace/sheets/api/limits>
- Creating and managing spreadsheets — <https://developers.google.com/workspace/sheets/api/guides/create>
- Google Drive / Sheets storage limits (20 million cells) — <https://support.google.com/drive/answer/37603>

**OAuth mechanics**
- Web-server OAuth flow: `access_type`, `prompt`, `include_granted_scopes`, `invalid_grant` — <https://developers.google.com/identity/protocols/oauth2/web-server>
- OAuth 2.0 overview — <https://developers.google.com/identity/protocols/oauth2>

**Next.js 16 (read from `node_modules/next/dist/docs/`)**
- `01-app/01-getting-started/15-route-handlers.md` — Route Handler conventions, caching behaviour, segment config
- `01-app/01-getting-started/16-proxy.md` — Middleware → Proxy rename, `proxy.ts` convention, "not a full authorization solution"
- `01-app/03-api-reference/03-file-conventions/route.md` — `export const runtime = 'nodejs'` and other segment config options
- `01-app/02-guides/data-security.md` — Data Access Layer pattern, `server-only`, DTO minimisation
- `01-app/03-api-reference/05-config/01-next-config-js/serverActions.md` — `bodySizeLimit` (1 MB default)
- `01-app/03-api-reference/05-config/01-next-config-js/serverExternalPackages.md`

**Installed packages (read directly from `node_modules/`)**
- `next-auth/index.d.ts:263`, `next-auth/react.d.ts:79`, `next-auth/lib/actions.js:19` — the `authorizationParams` third argument
- `@auth/core/lib/actions/signin/authorization-url.js` — signIn-time params override provider params
- `@auth/core/providers/google.js` — *"Google only provides Refresh Token to an application the first time a user signs in."*

**Client library metadata (npm registry, live)**
- `googleapis` 182.0.0 — monolithic; Google's guidance is to prefer scoped `@googleapis/sheets` / `@googleapis/drive` packages
- `google-auth-library` 11.1.0 — depends on `jws`, `gaxios`, `gcp-metadata`, `ecdsa-sig-formatter`; Node-oriented, not Edge-safe

**Explicitly uncertain** — restated here so it is not lost:
`spreadsheets` scope classification · `files.list`+`appProperties` under `drive.file` · max rows/columns/chars-per-cell · the 100-refresh-tokens-per-client limit, 6-month token inactivity and password-change invalidation · exact access-token lifetime · CORS headers on `sheets.googleapis.com` · CASA pricing.
