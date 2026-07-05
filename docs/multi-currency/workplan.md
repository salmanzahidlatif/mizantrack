# Work Plan: Multi-Currency & Country Management

**Version:** 1.0  
**Last Updated:** 2026-07-04  
**PRD Reference:** docs/multi-currency/prd.md  
**Design Reference:** docs/multi-currency/design.md  

---

## Vision & Metrics

**Vision:** For MizanTrack users managing finances across multiple countries who need clean data separation, the Multi-Currency feature is a context-switching layer that keeps PKR, AED, and any other currency's data completely isolated while allowing one-tap switching between contexts.

**Success Metrics:**

| Metric | Target |
|---|---|
| Currency switch re-render time | < 300ms on 10k transactions |
| Country picker open time | < 50ms |
| AED accounts visible when PKR is active | 0 |
| Correct currency assigned on HK import | 100% |
| Firebase clear completes without partial failure | 100% on stable connection |

---

## Summary: 4 Epics · 10 Stories · 3 Sprints

---

## Epic E1: Data Foundation

**Description:** Static currency dataset, `DbConfig` extension, and `filter-store` extension. Everything else builds on this.  
**Business Value:** Enables all other stories to compile and run.  
**Priority:** Critical

---

### Story US-001: ISO 4217 Currency Dataset

**As a** developer **I want** a bundled `currencies.ts` with all ISO 4217 currencies and flag emojis **so that** the currency picker and selector have a fast, offline-capable data source.

**Acceptance Criteria:**
- [ ] `CURRENCIES` array contains ≥ 150 entries covering all major active currencies
- [ ] Each entry has `{ code, name, country, flag }` — e.g. `{ code: "PKR", name: "Pakistani Rupee", country: "Pakistan", flag: "🇵🇰" }`
- [ ] `searchCurrencies("pak")` returns the PKR entry (case-insensitive, matches code/name/country)
- [ ] `searchCurrencies("")` returns all entries
- [ ] `getCurrencyByCode("AED")` returns the AED entry; returns `undefined` for unknown codes
- [ ] Unit tests cover: exact match, partial match, case-insensitive, unknown code

**Design Reference:** §11.1 of docs/multi-currency/design.md  
**Technical Notes:** Store as a plain TypeScript `const` array — no JSON file needed. Include at minimum: PKR, AED, USD, EUR, GBP, SAR, INR, TRY, MYR, SGD, CAD, AUD, JPY, CNY, EGP, BDT, IDR. Add remaining ~165 ISO entries. Total file size target: < 15KB.  
**Dependencies:** None  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

### Story US-002: `DbConfig` Extension + Migration

**As a** developer **I want** `dbConfig.enabledCurrencies` to exist and be seeded from existing data **so that** the currency filter has a valid starting value for all users (new and existing).

**Acceptance Criteria:**
- [ ] `DbConfig` TypeScript interface gains `enabledCurrencies?: string[]` and the three App Lock fields (`pinHash?`, `appLockEnabled`, `biometricEnabled`) from the App Lock design
- [ ] On first read after update, if `enabledCurrencies` is absent or empty: seed from `dbConfig.currency ?? "PKR"`
- [ ] Seeding writes back to `dbConfig` so it only runs once
- [ ] Unit test: `dbConfig` without `enabledCurrencies` → after migration helper → `enabledCurrencies = ["AED"]` when `currency = "AED"`

**Design Reference:** §4.1, §11.8 of docs/multi-currency/design.md  
**Technical Notes:** Implement migration as a helper `ensureEnabledCurrencies(userId)` called at the top of `PreferencesForm` `useEffect` and at the start of `importHysabKytab`. No Dexie `version()` bump needed — just a conditional `dbConfig.update()`.  
**Dependencies:** US-001  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

### Story US-003: `filter-store` Extension

**As a** developer **I want** `activeCurrency` and `showArchivedAccounts` in `filter-store` **so that** all data hooks and components react to currency context changes automatically.

**Acceptance Criteria:**
- [ ] `filter-store` gains `activeCurrency: string` (default `""` until seeded by `AppShell`)
- [ ] `filter-store` gains `showArchivedAccounts: boolean` (default `false`)
- [ ] `setActiveCurrency(code)` updates `activeCurrency`; does not affect any other state
- [ ] `setShowArchivedAccounts(v)` updates `showArchivedAccounts`
- [ ] `reset()` clears `showArchivedAccounts` to `false`; does NOT reset `activeCurrency` (currency context persists through filter resets)
- [ ] `AppShell` seeds `activeCurrency` on mount: reads `dbConfig.enabledCurrencies[0]` and calls `setActiveCurrency` if current value is `""`
- [ ] Unit tests: state transitions, reset behaviour

**Design Reference:** §4.2, §11.8 of docs/multi-currency/design.md  
**Technical Notes:** `activeCurrency` is seeded asynchronously from `dbConfig` — use a `useEffect` in `AppShell` that depends on `[config?.enabledCurrencies]`.  
**Dependencies:** US-002  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

## Epic E2: Data Hooks & Import

**Description:** Currency and archived-account filters in the Dexie live-query hooks; import currency selection.  
**Business Value:** Data separation — the core functional promise of the feature.  
**Priority:** Critical

---

### Story US-004: `useAccounts` Currency & Archived Filters

**As a** user **I want** the Accounts page to show only accounts for my selected currency **so that** my PKR and AED data never appear together.

**Acceptance Criteria:**
- [ ] `useAccounts(userId, { currency: "PKR", showArchived: false })` returns only active PKR accounts
- [ ] `useAccounts(userId, { currency: "PKR", showArchived: true })` returns active + archived PKR accounts
- [ ] AED accounts are never returned when `currency = "PKR"` regardless of `showArchived`
- [ ] `useAccounts(userId)` with no filters returns all active accounts (backward-compatible default)
- [ ] Existing callers that pass no filters continue to work without changes
- [ ] Integration tests cover all four combinations: currency×showArchived

**Design Reference:** §11.4 of docs/multi-currency/design.md  
**Technical Notes:** Add filter logic after `.where("userId").equals(userId).filter(...)`. Chain: `!t.deletedAt` → `!currency || a.currency === currency` → `showArchived || !a.isArchived`.  
**Dependencies:** US-003  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

### Story US-005: `useTransactions` Currency Filter

**As a** user **I want** the transaction list to show only transactions belonging to the active currency **so that** PKR and AED transactions don't mix.

**Acceptance Criteria:**
- [ ] When `activeCurrency = "PKR"`: only transactions where `accountId` (or `toAccountId`) belongs to a PKR account are returned
- [ ] When `activeCurrency = "AED"`: same rule for AED accounts
- [ ] Existing date, type, category, search filters continue to work alongside the currency filter
- [ ] Integration test: 5 PKR transactions + 3 AED transactions → activeCurrency "PKR" returns exactly 5
- [ ] Transfer transactions crossing currencies (PKR→AED) appear in BOTH currency views

**Design Reference:** §11.5 of docs/multi-currency/design.md  
**Technical Notes:** Resolve `accountIds` for active currency first via `db.accounts.where("userId").equals(userId).and(a => a.currency === currency).primaryKeys()`. Cache with `useMemo([activeCurrency, accounts])` to avoid re-resolving on every transaction query tick.  
**Dependencies:** US-004  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

### Story US-006: HK Import Currency Prompt

**As a** user importing a Hysab Kytab backup **I want** to choose which currency to assign to the imported accounts **so that** data lands in the correct currency context automatically.

**Acceptance Criteria:**
- [ ] When `enabledCurrencies.length > 1`: `ImportPanel` shows a "Select import currency" step before file processing begins
- [ ] The step uses `CurrencyPicker` in `singleSelect` mode, pre-selecting the active currency
- [ ] When `enabledCurrencies.length === 1`: no prompt shown; that currency used automatically
- [ ] The selected currency is passed to `importHysabKytab(file, userId, targetCurrency)`
- [ ] All accounts created during this import have `currency === targetCurrency`
- [ ] Integration test: 2 enabled currencies → import → all new accounts have selected currency

**Design Reference:** §11.7, §6.2 of docs/multi-currency/design.md  
**Technical Notes:** `importHysabKytab` already reads `dbConfig.currency` as fallback. Add `targetCurrency?: string` as a 3rd parameter; if provided, use it instead of reading `dbConfig`.  
**Dependencies:** US-001, US-004  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

## Epic E3: UI Components

**Description:** The visible multi-currency UI: picker in Settings, selector in header, archived toggle in filter bar.  
**Business Value:** The user experience — discoverability and ease of switching contexts.  
**Priority:** High

---

### Story US-007: Currency Picker Component

**As a** user **I want** a searchable country/currency picker with flags **so that** I can easily find and select my currencies without knowing ISO codes.

**Acceptance Criteria:**
- [ ] Opens as a `Sheet` on mobile / `Dialog` on desktop
- [ ] Search input at top filters list by country name, currency name, or ISO code
- [ ] Each row: flag emoji + country name + currency code in parentheses
- [ ] Multi-select: selected items show checkmark and float to top of list
- [ ] "Save" button disabled when zero currencies selected; shows validation error on attempt
- [ ] `singleSelect` prop limits to one selection at a time
- [ ] Saving in `PreferencesForm` writes `enabledCurrencies` to `dbConfig`

**Design Reference:** §11.2 of docs/multi-currency/design.md  
**Technical Notes:** Use `useVirtualizer` from `@tanstack/react-virtual` for the list (already installed) to avoid rendering all ~180 rows.  
**Dependencies:** US-001, US-002  
**Estimated Effort:** 1.5d  
**Priority:** Must Have

---

### Story US-008: Currency Selector in Header

**As a** user with multiple currencies **I want** a currency switcher in the app header **so that** I can switch financial context from any page with one tap.

**Acceptance Criteria:**
- [ ] Selector is hidden when `enabledCurrencies.length < 2`
- [ ] Visible with ≥ 2 currencies: shows current currency as a pill/dropdown (flag + ISO code)
- [ ] Tapping/clicking opens a compact dropdown listing all enabled currencies
- [ ] Selecting a currency calls `setActiveCurrency(code)` in `filter-store`
- [ ] All data views update instantly (driven by live queries reacting to store)
- [ ] Active currency highlighted in the dropdown list
- [ ] Selector does not overflow header on small screens (truncates to flag + code only)

**Design Reference:** §11.3, §3.2 of docs/multi-currency/design.md  
**Technical Notes:** Mount `<CurrencySelector>` in `AppShell` header between the logo and the sync badge. Read `enabledCurrencies` from `useDbConfig(userId)`.  
**Dependencies:** US-003, US-007  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

### Story US-009: Archived Accounts Toggle in Filter Bar

**As a** user **I want** a toggle to show archived accounts within my active currency **so that** I can review historical data from old accounts without permanently un-archiving them.

**Acceptance Criteria:**
- [ ] A "Show archived accounts" toggle appears in the Accounts page filter bar (or header)
- [ ] When off (default): only active accounts for the current currency are shown
- [ ] When on: active + archived accounts for the current currency are shown
- [ ] AED accounts are never shown when PKR is active, regardless of this toggle
- [ ] Toggle state does not persist between sessions (resets to `false` on app open)
- [ ] Archived accounts are visually distinguished (greyed out, "Archived" badge)

**Design Reference:** §4.2, §6.1b of docs/multi-currency/design.md  
**Technical Notes:** Bind toggle to `useFilterStore(s => s.showArchivedAccounts)`. Pass to `useAccounts(userId, { currency: activeCurrency, showArchived })`.  
**Dependencies:** US-004, US-008  
**Estimated Effort:** 0.5d  
**Priority:** Should Have

---

## Epic E4: Firebase Data Management

**Description:** The "Clear All Firebase Data" action that gives users a clean-slate reset of their Firestore data.  
**Business Value:** Reduces friction when users need to re-sync from scratch or before switching devices.  
**Priority:** High

---

### Story US-010: Clear Firebase Data

**As a** user **I want** a button to delete all my data from Firebase **so that** I can start a fresh sync or remove cloud data without touching my local records.

**Acceptance Criteria:**
- [ ] "Clear Firebase Data" button in Settings → Firebase / Sync section
- [ ] Button is disabled and shows tooltip "Firebase not configured" when sync is not set up
- [ ] Tapping shows a confirmation dialog with destructive warning text
- [ ] Confirming calls `clearFirestoreForUser(userId)` which batch-deletes all documents under `/users/{userId}/`
- [ ] A progress indicator shows "Deleting… (N documents)" during the operation
- [ ] On success: toast "Cleared N documents from Firebase"
- [ ] On success: `syncMeta.lastSync` reset to `0` so next sync re-uploads everything
- [ ] On error: toast with error message; local data untouched
- [ ] Integration test: mock Firestore with 3 collections → clear → all deleted, `syncMeta.timestamp = 0`

**Design Reference:** §11.6, §4.4, §6.3 of docs/multi-currency/design.md  
**Technical Notes:** `clearFirestoreForUser(userId, onProgress?)` in `sync.ts`. Iterate: `accounts`, `categories`, `transactions`, `settings/prefs`. Use existing `getFirestoreForUser(userId)` for the Firestore instance.  
**Dependencies:** None (can be developed independently of currency UI)  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

## Sprint Plan

### Sprint 1: Data Foundation & Hooks
**Duration:** 1 week  
**Sprint Goal:** Currency filter is live in all data views; existing tests pass; no UI changes yet.

| ID | Title | Effort | Priority | Status |
|----|-------|--------|----------|--------|
| US-001 | ISO 4217 Currency Dataset | 0.5d | Must | ⏳ TODO |
| US-002 | DbConfig Extension + Migration | 0.5d | Must | ⏳ TODO |
| US-003 | filter-store Extension | 0.5d | Must | ⏳ TODO |
| US-004 | useAccounts Currency & Archived Filters | 0.5d | Must | ⏳ TODO |
| US-005 | useTransactions Currency Filter | 1d | Must | ⏳ TODO |
| US-010 | Clear Firebase Data | 1d | Must | ⏳ TODO |

**Capacity:** 5d | **Committed:** 4d *(1d buffer for integration testing)*

### Sprint 2: UI Components & Import
**Duration:** 1 week  
**Sprint Goal:** User can select currencies in Settings, switch context in the header, and choose currency on HK import.

| ID | Title | Effort | Priority | Status |
|----|-------|--------|----------|--------|
| US-007 | Currency Picker Component | 1.5d | Must | ⏳ TODO |
| US-008 | Currency Selector in Header | 1d | Must | ⏳ TODO |
| US-006 | HK Import Currency Prompt | 1d | Must | ⏳ TODO |
| US-009 | Archived Accounts Toggle | 0.5d | Should | ⏳ TODO |

**Capacity:** 5d | **Committed:** 4d *(1d buffer for cross-feature integration, AppShell seed logic)*

---

## Dependencies & Risks

| Risk | Impact | Mitigation |
|---|---|---|
| `useTransactions` double-Dexie-read performance at 10k+ transactions | Medium | Cache account IDs per currency in `useMemo`; benchmark before shipping |
| Existing `useAccounts` callers break when currency filter added | Medium | Make all new params optional with backward-compatible defaults; run full test suite after US-004 |
| App Lock `DbConfig` fields (from separate feature) conflict with this story's type extension | Low | Coordinate type changes in `src/types/index.ts` in a single commit that covers both features |
