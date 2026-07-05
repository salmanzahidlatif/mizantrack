# Work Plan: App Lock — PIN Code & Biometric Authentication

**Version:** 1.0  
**Last Updated:** 2026-07-04  
**PRD Reference:** docs/app-lock/prd.md  
**Design Reference:** docs/app-lock/design.md  

---

## Vision & Metrics

**Vision:** For MizanTrack users who leave their device unattended, the App Lock feature is a privacy guard that prevents unauthorized access to financial data without disrupting the authenticated session or causing any data loss.

**Success Metrics:**

| Metric | Target |
|---|---|
| Lock screen renders from app-return event | < 100ms |
| PIN verification round-trip | < 50ms |
| Financial data visible before authentication | 0% |
| Settings restored correctly on new device via sync | 100% |
| Biometric auth works on iOS 16+ Safari PWA | Confirmed in device test |

---

## Summary: 3 Epics · 8 Stories · 2 Sprints

---

## Epic E1: Core Lock Engine

**Description:** The cryptographic and state foundations — PIN hashing, lock-store, and the background/return detection guard.  
**Business Value:** Nothing else in this feature works without these primitives.  
**Priority:** Critical  
**Estimated Effort:** 1 sprint

---

### Story US-001: PIN Crypto Module

**As a** developer **I want** a dedicated `pinCrypto.ts` module **so that** PIN hashing and verification are isolated, testable, and never accept plaintext outside the module.

**Acceptance Criteria:**
- [ ] `hashPin("1234")` returns a 64-char SHA-256 hex string via Web Crypto API
- [ ] `verifyPin("1234", hash)` returns `true` for matching PIN, `false` otherwise
- [ ] Calling `hashPin` with the same input twice produces the same hash (deterministic)
- [ ] Module never stores or logs the plaintext PIN
- [ ] Unit tests cover: correct match, wrong PIN, empty string input

**Design Reference:** §11.1 of docs/app-lock/design.md  
**Technical Notes:** Use `crypto.subtle.digest('SHA-256', encoder.encode(pin))`. Convert ArrayBuffer to hex with `Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('')`.  
**Dependencies:** None  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

### Story US-002: Lock Store (Zustand)

**As a** developer **I want** a `lock-store` Zustand store **so that** lock state, failed attempts, and lockout timer are shared reactively across components.

**Acceptance Criteria:**
- [ ] `isLocked` starts `false`; `lock()` sets it `true`; `unlock()` sets it `false`
- [ ] `recordFailedAttempt()` increments `failedAttempts`; after 5 it sets `lockoutUntil = Date.now() + 30_000`
- [ ] `resetAttempts()` clears both `failedAttempts` and `lockoutUntil`
- [ ] `startGraceTimer(ms)` stores a `setTimeout` handle; `cancelGraceTimer()` clears it
- [ ] Unit tests cover all state transitions including lockout boundary (4 fails → not locked, 5 fails → locked)

**Design Reference:** §11.3 of docs/app-lock/design.md  
**Technical Notes:** Use Zustand `create`. Grace timer handle stored in store state but not serialized. The `lockoutUntil` is a Unix ms timestamp so `LockScreen` can compute countdown with `Date.now()`.  
**Dependencies:** None  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

### Story US-003: App Lock Guard Component

**As a** user **I want** the app to automatically show the lock screen when I return to it after leaving **so that** my data is protected without me having to do anything manually.

**Acceptance Criteria:**
- [ ] `AppLockGuard` mounts a `visibilitychange` listener on mount; removes it on unmount
- [ ] When page becomes `hidden`: starts a 30-second grace timer via `lock-store.startGraceTimer(30_000)`
- [ ] When page becomes `visible`: if grace timer has expired AND `dbConfig.appLockEnabled = true`, calls `lock-store.lock()`
- [ ] If grace timer has NOT expired, cancels it and does not lock
- [ ] When `isLocked = true`, renders `<LockScreen>` as a full-viewport overlay (z-index above header)
- [ ] Children remain mounted but are inaccessible behind the overlay
- [ ] When `appLockEnabled = false`, never shows lock screen regardless of visibility events
- [ ] Integration test: mock `visibilitychange` hidden → 31s → visible → assert `isLocked = true`

**Design Reference:** §11.4, §3.2, §6.1 of docs/app-lock/design.md  
**Technical Notes:** Mount in `AppShell.tsx` as `<AppLockGuard userId={user.id}>{children}</AppLockGuard>`. Use `Date.now()` snapshots to calculate timer expiry rather than relying on `setTimeout` firing exactly.  
**Dependencies:** US-001, US-002  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

## Epic E2: Lock Screen UI & Biometrics

**Description:** The user-facing lock screen: PIN pad, lockout countdown, biometric button, and the forgot-PIN re-authentication flow.  
**Business Value:** The user experience of App Lock — first impressions and daily friction.  
**Priority:** Critical  
**Estimated Effort:** 1 sprint

---

### Story US-004: Lock Screen PIN Pad

**As a** user **I want** a clean PIN entry screen with large tap targets **so that** I can unlock the app quickly on my phone without frustration.

**Acceptance Criteria:**
- [ ] Full-viewport overlay; no app content visible behind it
- [ ] Displays app logo + signed-in user avatar at top
- [ ] 4 PIN dot indicators fill as digits are entered; clear on backspace
- [ ] Numeric pad (0–9 + backspace): each button ≥ 60×60px
- [ ] On 4 digits entered: automatically calls `verifyPin`; shows "Incorrect PIN. N attempts remaining" on failure
- [ ] After 5 failed attempts: pad disabled; countdown timer shows seconds remaining; re-enables automatically
- [ ] On correct PIN: calls `lock-store.unlock()` + `resetAttempts()`; overlay dismissed
- [ ] "Forgot PIN" link visible below the pad

**Design Reference:** §11.5, §6.2 of docs/app-lock/design.md  
**Technical Notes:** `LockScreen` receives `userId` and `onUnlock` prop. Read `pinHash` from `db.dbConfig.get(userId)`. Lockout countdown: `useEffect` interval that ticks every second while `lockoutUntil !== null`.  
**Dependencies:** US-001, US-002, US-003  
**Estimated Effort:** 1.5d  
**Priority:** Must Have

---

### Story US-005: Forgot PIN — Re-Authentication Flow

**As a** user who has forgotten their PIN **I want** to re-authenticate with Google or biometrics and set a new PIN **so that** I can regain access without losing any data.

**Acceptance Criteria:**
- [ ] Tapping "Forgot PIN" shows a sheet/dialog: "Re-authenticate to reset your PIN"
- [ ] If biometric is enrolled on device: offers "Use Face ID / Fingerprint" button first
- [ ] If biometric not enrolled or fails: shows "Continue with Google" button which triggers `signIn()` OAuth re-flow
- [ ] After successful re-authentication: shows a "Set New PIN" form (enter + confirm, 4 digits)
- [ ] Mismatched confirmation shows inline error; does not save
- [ ] On save: `hashPin(newPin)` → `db.dbConfig.update(userId, { pinHash: hash })`; lock screen dismissed
- [ ] No local data is deleted at any point in this flow

**Design Reference:** §6.3, §3.4 (decision B) of docs/app-lock/design.md  
**Technical Notes:** Use NextAuth `signIn("google", { redirect: false })` for re-auth without full page reload. After re-auth, verify the returned session `user.id` matches current `userId` before allowing PIN reset.  
**Dependencies:** US-004  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

### Story US-006: Biometric Authentication (WebAuthn)

**As a** user with Face ID / fingerprint on my phone **I want** to unlock the app with biometrics **so that** I don't have to type my PIN every time.

**Acceptance Criteria:**
- [ ] `isBiometricAvailable()` returns `true` on supported devices (iOS Safari PWA, Android Chrome)
- [ ] `registerBiometric(userId)` calls `navigator.credentials.create()` and returns a Base64 credentialId
- [ ] `authenticateBiometric(credentialId)` calls `navigator.credentials.get()` and returns `true` on success
- [ ] Lock screen triggers biometric prompt automatically on appear (if enrolled)
- [ ] Biometric failure or cancellation falls through to PIN pad silently
- [ ] Biometric `credentialId` stored in `dbConfig.biometricCredentialId` (local only, never synced)
- [ ] On a device where biometrics are not available, biometric UI is hidden entirely
- [ ] Device test: Face ID unlocks on iPhone; fingerprint unlocks on Android Chrome

**Design Reference:** §11.2, §3.3 of docs/app-lock/design.md  
**Technical Notes:** WebAuthn `rpId` = `window.location.hostname`. `challenge` = `crypto.getRandomValues(new Uint8Array(32))`. `authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" }`.  
**Dependencies:** US-004  
**Estimated Effort:** 1.5d  
**Priority:** Must Have

---

## Epic E3: Settings & Firebase Sync

**Description:** User-facing settings controls and the Firebase settings-sync extension.  
**Business Value:** Users can configure App Lock and have preferences restored on new devices.  
**Priority:** High  
**Estimated Effort:** 0.5 sprint

---

### Story US-007: App Lock Settings Panel

**As a** user **I want** to configure App Lock in Settings **so that** I can enable/disable the lock screen, set or change my PIN, and toggle biometric authentication.

**Acceptance Criteria:**
- [ ] Settings page shows "App Lock" section with an enable/disable toggle
- [ ] When enabled and no PIN is set: shows "Set PIN" action; opens a PIN creation form
- [ ] When enabled and PIN is set: shows "Change PIN" and "Remove PIN" actions
- [ ] "Change PIN" requires entering current PIN first, then new PIN + confirm
- [ ] "Remove PIN" disables App Lock and clears `pinHash`
- [ ] If device supports biometrics AND PIN is set: shows "Use Face ID / Fingerprint" toggle
- [ ] Enabling biometric toggle calls `registerBiometric()` immediately (triggers OS prompt)
- [ ] All changes persist to `dbConfig` via `db.dbConfig.update()`

**Design Reference:** §11.6, §4.1 of docs/app-lock/design.md  
**Technical Notes:** Disabling biometric clears `biometricCredentialId` from dbConfig but keeps `biometricEnabled: false`. App Lock cannot be enabled without a PIN — enforce in the toggle handler.  
**Dependencies:** US-001, US-006  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

### Story US-008: Settings Sync Extension

**As a** user who signs in on a new device **I want** my App Lock settings, theme, and currency preferences to be restored automatically **so that** I don't have to reconfigure the app from scratch.

**Acceptance Criteria:**
- [ ] `syncAll()` pushes/pulls a single Firestore document at `/users/{userId}/settings/prefs`
- [ ] Synced fields: `pinHash`, `appLockEnabled`, `biometricEnabled`, `theme`, `enabledCurrencies`, `fiscalYearStartMonth`, `updatedAt`
- [ ] NOT synced: `biometricCredentialId`, `firebaseConfig`, `enabled`, `goldApiKey`
- [ ] Conflict resolution: last-write-wins on `prefs.updatedAt`
- [ ] After fresh sign-in + sync: `dbConfig` is populated with remote prefs values
- [ ] On a new device where `biometricEnabled: true` is pulled from sync: a prompt appears in AppLockSettings to re-enroll biometrics
- [ ] Integration test: seed Firestore mock with prefs doc → call `syncAll()` → assert local `dbConfig` updated

**Design Reference:** §11.7, §6.4 of docs/app-lock/design.md  
**Technical Notes:** Add `syncSettingsPrefs(userId, firestore)` as a private helper in `sync.ts`; call it at the end of `syncAll()` before returning. The `prefs` document is a single Firestore document, not a collection — use `setDoc`/`getDoc`, not `getDocs`.  
**Dependencies:** US-007  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

## Sprint Plan

### Sprint 1: Lock Engine & UI
**Duration:** 1 week  
**Sprint Goal:** App Lock is functional — lock screen appears on app return, PIN unlock works, biometric works on device.

| ID | Title | Effort | Priority | Status |
|----|-------|--------|----------|--------|
| US-001 | PIN Crypto Module | 0.5d | Must | ✅ DONE |
| US-002 | Lock Store (Zustand) | 0.5d | Must | ✅ DONE |
| US-003 | App Lock Guard Component | 1d | Must | ✅ DONE |
| US-004 | Lock Screen PIN Pad | 1.5d | Must | ✅ DONE |
| US-005 | Forgot PIN — Re-Authentication | 1d | Must | ✅ DONE |
| US-006 | Biometric Authentication (WebAuthn) | 1.5d | Must | ✅ DONE |

**Capacity:** 5d | **Committed:** 6d *(slight overrun acceptable with AI — buffer used here)*

### Sprint 2: Settings & Sync
**Duration:** 1 week  
**Sprint Goal:** User can configure App Lock in Settings; preferences sync to Firebase and restore on new device.

| ID | Title | Effort | Priority | Status |
|----|-------|--------|----------|--------|
| US-007 | App Lock Settings Panel | 1d | Must | ✅ DONE |
| US-008 | Settings Sync Extension | 1d | Must | ✅ DONE |

**Capacity:** 5d | **Committed:** 2d *(remaining days used for device testing, bug fixes, and E2E test)*

---

## Dependencies & Risks

| Risk | Impact | Mitigation |
|---|---|---|
| WebAuthn on iOS PWA unstable across iOS versions | High | Tech spike first: test Face ID on iOS 16, 17, 18. If Face ID fails on any version, mark biometrics as beta and hide behind a feature flag. |
| `visibilitychange` unreliable on some Android WebViews | Medium | Also listen to `pagehide` as fallback trigger |
| Forgot-PIN Google re-auth `signIn({ redirect: false })` may not be supported in all NextAuth versions | Medium | Test with NextAuth v5.0.0-beta.31 specifically; fallback to full redirect if needed |
