# Work Plan: MizanTrack

**Version:** 1.0  
**Last Updated:** 2026-05-26  
**PRD Reference:** docs/prd.md  
**Design Reference:** docs/design.md

---

## Vision & Metrics

**Vision:**  
For individuals managing finances across multiple currencies and geographies who need more than a simple ledger, MizanTrack is a privacy-first PWA that replaces Hysab Kytab with multi-currency tracking, fiscal-year reporting, and automated Zakat calculation — all offline-first, all in your own cloud.

**Success Metrics:**

| Metric | Target |
|---|---|
| HK `.xlsx` import success rate | ≥ 95% of valid HK files |
| Offline transaction CRUD | 100% without network |
| PWA installable on iOS + Android | Confirmed on both platforms |
| Zakat calculation accuracy | Matches manual calc to 2 decimal places |
| Transaction list render (10k records) | < 1 second |
| TypeScript / ESLint errors | Zero |

---

## Summary: 5 Epics · 29 Stories · 6 Sprints

| Epic | Title | Stories | Sprints | Priority |
|---|---|---|---|---|
| E1 | Foundation & Infrastructure | US-001–005 | Sprint 1 | Critical |
| E2 | Account & Category Management | US-006–010 | Sprint 2 | Critical |
| E3 | Transaction Management | US-011–014 | Sprint 3 | Critical |
| E4 | Dashboard, Reports & Data Portability | US-015–024 | Sprints 4–5 | Critical/High |
| E5 | Zakat Calculator & PWA Polish | US-025–029 | Sprint 6 | High |

---

## Epic E1: Foundation & Infrastructure

**Description:** Fix critical blockers (broken auth, missing PWA icons), establish the state management layer (Zustand), reactive data hooks (Dexie live queries), Zod validation schemas, and the testing infrastructure. Nothing in E2–E5 can start without this.  
**Business Value:** Every subsequent feature depends on these primitives. Without them the app cannot authenticate or persist data.  
**Priority:** Critical  
**Estimated Effort:** 1 sprint

---

### Story US-001: Fix Auth & Add PWA Icons

**As a** user **I want to** sign in with Google and install the app on my phone **so that** I can use MizanTrack as a PWA shortcut.

**Acceptance Criteria:**
- [ ] `src/lib/auth.ts` reads `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` env vars (NextAuth v5 convention)
- [ ] `.env.local.example` documents the corrected var names
- [ ] `public/icon-192.png` and `public/icon-512.png` exist and are referenced correctly in `manifest.json`
- [ ] `npm run dev` starts without auth errors; navigating to `/dashboard` redirects to `/login`
- [ ] `npm run typecheck` and `npm run lint` pass with zero errors/warnings

**Design Reference:** §5.1 Auth Layer, §3.3 Deployment Architecture  
**Technical Notes:** Current code uses `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — rename to `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`. PWA icons can be generated programmatically (e.g., a simple canvas-drawn icon) or any 192×512 PNG.  
**Dependencies:** None  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

### Story US-002: Create Zustand Stores

**As a** developer **I want** shared UI state stores **so that** any component can read or update filter state, sync status, and modal visibility without prop drilling.

**Acceptance Criteria:**
- [ ] `src/store/ui-store.ts` exports `useUIStore` with transaction drawer state + open/close actions
- [ ] `src/store/filter-store.ts` exports `useFilterStore` with all `FilterPeriod`, accountId, categoryId, transactionType, and searchQuery fields + setters + `reset()`
- [ ] `src/store/sync-store.ts` exports `useSyncStore` with `syncing`, `lastSync`, `error`, and `triggerSync()` action
- [ ] All three stores typed with TypeScript interfaces matching design §5.4
- [ ] Stores are importable in any client component without errors

**Design Reference:** §5.4 State Layer (Zustand), §6.4 State Shape  
**Technical Notes:** Use Zustand `create` with `immer` middleware optional. Keep stores lean — no financial data in Zustand.  
**Dependencies:** US-001  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

### Story US-003: Create Dexie Live Query Hooks

**As a** developer **I want** typed reactive hooks over Dexie **so that** any component can subscribe to live data without writing raw Dexie queries.

**Acceptance Criteria:**
- [ ] `src/hooks/useAccounts.ts` — returns live `Account[]` filtered by userId, excluding `deletedAt`
- [ ] `src/hooks/useCategories.ts` — returns live `Category[]` with optional `type` filter
- [ ] `src/hooks/useTransactions.ts` — returns live `Transaction[]` accepting `{ accountId?, categoryId?, type?, from?, to?, search? }` filter object
- [ ] `src/hooks/useAccountBalance.ts` — returns computed `number` balance (opening balance + transaction sum) reactively
- [ ] `src/hooks/useDbConfig.ts` — returns live `DbConfig | undefined` for userId
- [ ] `src/hooks/useSyncMeta.ts` — returns live `SyncMeta | undefined`
- [ ] All hooks use `useLiveQuery` from `dexie-react-hooks`; return `undefined` during load (handles skeleton state)

**Design Reference:** §5.2 Local Data Layer, §6.1 Core Entities (balance computation formula)  
**Technical Notes:** Balance formula: `openingBalance + Σ(income where accountId) - Σ(expense where accountId) - Σ(transfer where accountId=source) + Σ(transfer where toAccountId=dest)`. Query with `useLiveQuery(() => db.transactions.where(...).toArray())`.  
**Dependencies:** US-001  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

### Story US-004: Create Zod Validation Schemas

**As a** developer **I want** Zod schemas for all form entities **so that** React Hook Form can validate account, category, and transaction inputs before writing to Dexie.

**Acceptance Criteria:**
- [ ] `src/lib/validations/account.ts` — schema validates title (1–100 chars), currency (3-char ISO code), openingBalance (non-negative number), optional color and icon
- [ ] `src/lib/validations/category.ts` — schema validates title (1–100 chars), type (`"Income" | "Expense"`), optional parentId (UUID)
- [ ] `src/lib/validations/transaction.ts` — schema validates type, amount (positive number > 0), date (valid date), accountId (UUID), optional fields; Transfer type requires `toAccountId` different from `accountId`
- [ ] `src/lib/validations/dbConfig.ts` — schema validates Firebase JSON config has required fields (`apiKey`, `authDomain`, `projectId`)
- [ ] All schemas export inferred TypeScript types (e.g., `type AccountFormValues = z.infer<typeof accountSchema>`)
- [ ] `npm run typecheck` passes

**Design Reference:** §5.2 Local Data Layer, §8 Security Considerations  
**Technical Notes:** Use `zod` v4 already installed. For Transfer validation use `z.refine()` to check `toAccountId !== accountId`.  
**Dependencies:** None  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

### Story US-005: Seed Default Categories, Setup Vitest & Shared Components

**As a** user opening MizanTrack for the first time **I want** a useful set of default categories pre-loaded **so that** I can start adding transactions without setting up categories manually.

**As a** developer **I want** Vitest configured and shared UI building blocks **so that** tests can be written alongside features.

**Acceptance Criteria:**
- [ ] `src/lib/db/seed.ts` exports `seedDefaultCategories(userId)` that inserts ~15 default categories (10 Expense, 5 Income) if no categories exist for the user
- [ ] `seedDefaultCategories` is called in `AppShell` on first authenticated render (guarded by count check — runs once only)
- [ ] `vitest.config.ts` configured with `jsdom` environment; `@testing-library/react` and `fake-indexeddb` added to devDependencies
- [ ] `src/components/shared/CurrencyAmount.tsx` — renders formatted amount with currency symbol; positive amounts green, negative red (configurable via prop)
- [ ] `src/components/shared/EmptyState.tsx` — accepts `title`, `description`, optional `action` (button label + onClick)
- [ ] `src/components/shared/SkeletonCard.tsx` — generic skeleton placeholder matching card shape
- [ ] `npm test` runs without errors (even if no test files yet)
- [ ] `npm run lint` and `npm run typecheck` pass

**Design Reference:** §5.5 UI Component Library, §5.6 Feature Modules, §10 Testing Strategy  
**Technical Notes:** Default categories: Food, Transport, Shopping, Healthcare, Utilities, Rent, Education, Entertainment, Personal Care, Others (Expense); Salary, Freelance, Business, Investment, Gift (Income). Install `@testing-library/react`, `@testing-library/jest-dom`, `fake-indexeddb`, `vitest`, `jsdom` as devDependencies. Also install `@tanstack/react-virtual` for transaction list (US-011).  
**Dependencies:** US-001, US-002, US-003  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

## Epic E2: Account & Category Management

**Description:** Full CRUD UI for accounts (with live balance) and categories (with income/expense grouping). These are prerequisites for the transaction entry form.  
**Business Value:** Users with AED and PKR accounts need to create and manage them before recording any transactions.  
**Priority:** Critical  
**Estimated Effort:** 1 sprint

---

### Story US-006: Account List with Live Balances

**As a** user **I want to** see all my accounts with their current balances on the Accounts page **so that** I have a quick overview of my financial position.

**Acceptance Criteria:**
- [ ] `/accounts` page renders a grid of `AccountCard` components, one per non-deleted account
- [ ] Each card shows: account title, currency, current balance (computed live from transactions), color indicator
- [ ] Balance updates in real time when transactions are added/edited/deleted elsewhere
- [ ] Archived accounts are hidden by default; a toggle reveals them with visual distinction
- [ ] Empty state shown when no accounts exist, with a CTA to create the first account
- [ ] Loading skeleton shown while Dexie query resolves

**Design Reference:** §5.6 Feature Modules (`AccountCard`, `AccountList`), §6.1 Core Entities (balance formula)  
**Technical Notes:** Use `useAccounts(userId)` and `useAccountBalance(accountId)` hooks. Accounts page is a client component (`"use client"`). Balance hook uses `useLiveQuery`.  
**Dependencies:** E1 complete (US-001–005)  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

### Story US-007: Add & Edit Account Form

**As a** user **I want to** create a new account or edit an existing one **so that** I can track my AED and PKR accounts separately.

**Acceptance Criteria:**
- [ ] "Add Account" button opens a drawer/dialog containing the account form
- [ ] Form fields: Title (required), Currency (required, ISO-4217 text input with common shortcuts AED/PKR/USD), Opening Balance (number, default 0), Color (color picker or predefined swatches), Icon (optional text/emoji)
- [ ] Submitting a valid form creates the account in Dexie and closes the drawer; account appears immediately in the list
- [ ] Tapping an existing account card's edit action pre-fills the form with current values; saving updates the record (`updatedAt` refreshed)
- [ ] Validation errors shown inline per field (Zod schema from US-004)
- [ ] Form disabled / loading state during Dexie write

**Design Reference:** §5.6 Feature Modules (`AccountForm`), §5.4 State Layer (ui-store drawer state)  
**Technical Notes:** Use React Hook Form + `zodResolver`. Write to Dexie via `db.accounts.put(...)`. Use `useUIStore` to open/close drawer. On edit, pass account id via `useUIStore.openEditAccount(id)`.  
**Dependencies:** US-006  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

### Story US-008: Archive & Soft-Delete Accounts

**As a** user **I want to** archive accounts I no longer use or delete mistakenly created ones **so that** my active account list stays clean.

**Acceptance Criteria:**
- [ ] Account card has a context menu (three-dot or swipe) with "Edit", "Archive", "Delete" actions
- [ ] Archive sets `isArchived: true`; archived accounts disappear from the main list and transaction entry dropdowns; archived toggle in accounts page shows them
- [ ] Delete sets `deletedAt: number`; deleted accounts disappear from all UI; sync propagates tombstone to Firestore
- [ ] Deleting an account with existing transactions shows a confirmation dialog warning about orphaned transactions
- [ ] Actions show a toast notification on success

**Design Reference:** §5.2 Local Data Layer, FR-ACC-003, FR-ACC-004  
**Technical Notes:** Soft-delete pattern: `db.accounts.update(id, { deletedAt: Date.now(), updatedAt: Date.now() })`. All `useAccounts` queries already filter `!deletedAt`.  
**Dependencies:** US-007  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

### Story US-009: Category List (Income / Expense Tree)

**As a** user **I want to** see my income and expense categories organized in a tree **so that** I can understand how my spending is classified.

**Acceptance Criteria:**
- [ ] `/categories` page has two tabs: "Expense" and "Income"
- [ ] Each tab renders a flat list (parent categories, with children indented beneath them) using `useCategories(userId, type)`
- [ ] Default seeded categories from US-005 appear on first load
- [ ] Empty state shown per tab if no categories of that type exist
- [ ] Loading skeleton displayed while data loads

**Design Reference:** §5.6 Feature Modules (`CategoryTree`)  
**Technical Notes:** One level of parent/child (`parentId`). Render: filter to parents (no `parentId`), then for each parent render its children. Client component.  
**Dependencies:** E1 complete  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

### Story US-010: Add, Edit & Delete Category

**As a** user **I want to** manage my categories **so that** I can customize them to match how I actually spend.

**Acceptance Criteria:**
- [ ] "Add Category" button (one per tab) opens a form with: Title (required), Type (pre-filled to active tab), Parent Category (optional dropdown of existing same-type categories), Color (optional), Icon (optional)
- [ ] Saving creates category in Dexie; it appears immediately in the list
- [ ] Tapping an existing category's edit action pre-fills form; saving updates it
- [ ] Delete action soft-deletes the category (`deletedAt` set); child categories of deleted parent remain in list (orphaned, shown flat)
- [ ] Validation errors shown inline

**Design Reference:** §5.6 Feature Modules (`CategoryForm`), FR-CAT-001–003  
**Technical Notes:** Use same RHF + Zod pattern as US-007. Parent dropdown filtered to same `type` only. On delete: `db.categories.update(id, { deletedAt: Date.now(), updatedAt: Date.now() })`.  
**Dependencies:** US-009  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

## Epic E3: Transaction Management

**Description:** The core user interaction — entering, viewing, filtering, and managing all financial transactions. This is the feature users will use daily.  
**Business Value:** Without transaction management the app has no data. This is the primary user workflow.  
**Priority:** Critical  
**Estimated Effort:** 1 sprint

---

### Story US-011: Transaction List with Virtualization, Filters & Search

**As a** user **I want to** browse my transactions with filters **so that** I can quickly find specific income, expenses, or transfers from a large history.

**Acceptance Criteria:**
- [ ] `/transactions` page renders a virtualized transaction list (using `@tanstack/react-virtual`) that handles 10,000+ items without scroll degradation
- [ ] Transactions grouped by date (descending), with sticky date headers
- [ ] Each row shows: type icon, description/place, category chip, amount (colored: red for expense, green for income, blue for transfer), account name
- [ ] Filter bar with: Period selector (all `FilterPeriod` presets), Account dropdown, Type selector (All / Expense / Income / Transfer), Search input (description + place)
- [ ] Filters driven by `useFilterStore`; list updates reactively
- [ ] Empty state shown when no transactions match active filters
- [ ] Loading skeleton shown during initial load

**Design Reference:** §5.6 Feature Modules (`TransactionList`, `TransactionRow`, `TransactionFilters`), §9 Performance (react-virtual decision)  
**Technical Notes:** `useTransactions(userId, filters)` hook passes filter object; hook applies `useLiveQuery` with Dexie `.and()` chain. Virtualize with `useVirtualizer` from `@tanstack/react-virtual`. CurrencyAmount component from US-005.  
**Dependencies:** E1 complete, US-006 (AccountSelect), US-009 (CategorySelect)  
**Estimated Effort:** 2d  
**Priority:** Must Have

---

### Story US-012: Add Transaction Drawer (Expense & Income)

**As a** user **I want to** quickly add an expense or income transaction **so that** I can log my spending on the go.

**Acceptance Criteria:**
- [ ] FAB (floating action button) visible on all pages above bottom nav; tapping opens `TransactionDrawer`
- [ ] Drawer is a bottom sheet on mobile, centered dialog on desktop (using shadcn Sheet / Dialog)
- [ ] Segmented control at top: "Expense" · "Income" · "Transfer" (Transfer handled in US-014)
- [ ] Fields: Amount (large numeric input, required), Date (date picker, default today), Account (dropdown, required), Category (dropdown filtered by type, required for Expense/Income), Description (text, optional), Tags (comma-separated chip input, optional), Place (text, optional)
- [ ] Collapsible "Travel Currency" section: symbol, rate, local amount, location (all optional)
- [ ] Saving writes record to Dexie; drawer closes; transaction list updates instantly
- [ ] All fields validated (Zod schema from US-004); errors shown inline
- [ ] Amount field auto-focuses when drawer opens

**Design Reference:** §5.6 Feature Modules (`TransactionDrawer`), §7.2 Transaction Create Flow  
**Technical Notes:** Drawer state managed by `useUIStore`. On save: `db.transactions.put({ id: uuid(), userId, ...formValues, updatedAt: Date.now() })`. Use `useAccounts` and `useCategories` for dropdown data.  
**Dependencies:** US-011, US-007, US-010  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

### Story US-013: Edit & Soft-Delete Transaction

**As a** user **I want to** correct a mistake in a transaction or remove it **so that** my balance stays accurate.

**Acceptance Criteria:**
- [ ] Tapping a transaction row opens the edit drawer pre-filled with current values
- [ ] Saving an edit updates the record in Dexie (`updatedAt` refreshed); list reflects change immediately
- [ ] Long-press (mobile) or context menu (desktop) on a row shows "Edit" and "Delete" options
- [ ] Delete sets `deletedAt` with confirmation dialog; transaction disappears from list; account balance updates
- [ ] Deleting a Transfer transaction shows a note that the paired transfer records may need manual review

**Design Reference:** §5.6 Feature Modules (`TransactionDrawer`), FR-TXN-008, FR-TXN-009  
**Technical Notes:** Reuse `TransactionDrawer` with `editId` prop; pre-fill via `db.transactions.get(editId)`. Delete: `db.transactions.update(id, { deletedAt: Date.now(), updatedAt: Date.now() })`.  
**Dependencies:** US-012  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

### Story US-014: Transfer Transaction

**As a** user **I want to** record a transfer between my AED and PKR accounts **so that** both account balances remain accurate when I move money between them.

**Acceptance Criteria:**
- [ ] Selecting "Transfer" in the drawer hides the Category field and shows a "To Account" dropdown
- [ ] "To Account" dropdown excludes the selected source account
- [ ] Saving creates a single `Transfer` record with both `accountId` (source) and `toAccountId` (destination)
- [ ] Source account balance decreases by amount; destination account balance increases by amount
- [ ] Zod validation prevents `accountId === toAccountId`
- [ ] Transfer rows display with both account names ("From → To")

**Design Reference:** §5.6 Feature Modules (`TransactionDrawer`), FR-TXN-002, FR-TXN-003  
**Technical Notes:** Balance formula in `useAccountBalance` already accounts for transfers (design §6.1). Transfer amounts always positive; type field carries direction.  
**Dependencies:** US-012  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

## Epic E4: Dashboard, Reports & Data Portability

**Description:** Visual summaries (dashboard, charts, fiscal-year reports) and the data in/out features (HK import, XLSX export, Firebase sync UI). Two sprints.  
**Business Value:** This is what makes MizanTrack more powerful than HK — insights, fiscal reporting, and data portability.  
**Priority:** Critical (dashboard/reports), High (data portability)  
**Estimated Effort:** 2 sprints

---

### Story US-015: Dashboard — Balance Cards & Month Summary

**As a** user **I want to** see my account balances and this month's income vs expense at a glance when I open the app **so that** I know my current financial position immediately.

**Acceptance Criteria:**
- [ ] `/dashboard` replaces the stub with real content
- [ ] Account balance cards rendered horizontally (scroll on mobile); each shows account name, currency, and live balance
- [ ] Month summary strip below cards: "Income: [amount]", "Expenses: [amount]", "Net: [amount]" for the current calendar month
- [ ] Amounts formatted with currency symbol via `CurrencyAmount` component
- [ ] Multi-currency accounts each show their own currency (no forced conversion)
- [ ] Skeleton loading state while data loads
- [ ] Empty state with "Create your first account" CTA if no accounts exist

**Design Reference:** §5.6 Feature Modules (`BalanceCards`, `MonthSummary`), FR-DASH-001, FR-DASH-002  
**Technical Notes:** Use `useAccounts` + `useAccountBalance` for cards. Month summary: `useTransactions(userId, { from: startOfMonth(now), to: endOfMonth(now) })` then aggregate in component.  
**Dependencies:** E2 complete, E3 complete  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

### Story US-016: Dashboard — Recent Transactions & Trend Chart

**As a** user **I want to** see my last 10 transactions and a 6-month income/expense chart on the dashboard **so that** I can spot spending trends at a glance.

**Acceptance Criteria:**
- [ ] "Recent Transactions" section shows last 10 transactions with date, description, amount, and account
- [ ] Each row navigates to the transaction in the full list (or opens edit drawer) on tap
- [ ] 6-month bar chart (Recharts `BarChart`) shows income vs expense per month for the last 6 months
- [ ] Chart legend labels "Income" and "Expense"; bars use distinct colors
- [ ] Chart renders correctly with zero data months (empty bars, not missing)
- [ ] Chart is responsive (fills container width)

**Design Reference:** §5.6 Feature Modules (`RecentTransactions`, `TrendChart`), FR-DASH-003, FR-DASH-004  
**Technical Notes:** `useMonthlySummary(userId, 6)` hook: queries last 6 months of transactions, groups by month using `date-fns`, returns `[{ month, income, expense }]`. Recharts `ResponsiveContainer` for responsive sizing.  
**Dependencies:** US-015  
**Estimated Effort:** 1.5d  
**Priority:** Must Have

---

### Story US-017: Shared DateRangePicker Component

**As a** user **I want** a period selector that works consistently across Reports, Export, and Zakat **so that** I always filter data the same way regardless of which feature I'm using.

**Acceptance Criteria:**
- [ ] `DateRangePicker` component renders period preset pills: Today / Week / Month / Quarter / Half-Year / Year / Fiscal Year / Custom
- [ ] Selecting "Custom" opens a calendar popup (react-day-picker, already installed) for from/to dates
- [ ] Selecting "Fiscal Year" computes boundaries from `DbConfig.fiscalYearStartMonth` (default July)
- [ ] Selected period stored in `useFilterStore`; all consuming components read from store
- [ ] Component works standalone (standalone prop for export dialog that doesn't use filter store)
- [ ] Active pill visually highlighted

**Design Reference:** §5.5 UI Component Library (`DateRangePicker`), §6.4 Filter Store, `src/lib/dateRange.ts`  
**Technical Notes:** Reuse existing `getDateRange()` function from `src/lib/dateRange.ts`. Fiscal year month from `useDbConfig(userId)`. Export `getDateRange` result as `DateRange` for consumer.  
**Dependencies:** US-002 (filter store)  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

### Story US-018: Reports — Period Selector, Category Breakdown & Account Filter

**As a** user **I want to** see a breakdown of my spending by category for any period **so that** I can understand where my money goes and prepare for tax season.

**Acceptance Criteria:**
- [ ] `/reports` page replaces stub; uses `DateRangePicker` from US-017
- [ ] Summary strip: Total Income / Total Expense / Net Savings for the selected period
- [ ] Category breakdown rendered as a donut (pie) chart with a legend table below it showing category name, total, and % of expenses
- [ ] Account filter dropdown — selecting an account limits data to that account's transactions only
- [ ] Fiscal Year period correctly uses `DbConfig.fiscalYearStartMonth`
- [ ] Empty state when no transactions in selected period

**Design Reference:** §5.6 Feature Modules (`ReportFilters`, `CategoryBreakdownChart`, `ReportSummary`), FR-RPT-001–005  
**Technical Notes:** `useLiveQuery` for transactions in date range; aggregate by `categoryId` in component using `useMemo`. Recharts `PieChart` with `Cell` per category. Category names from `useCategories(userId)`.  
**Dependencies:** US-017, E3 complete  
**Estimated Effort:** 1.5d  
**Priority:** Must Have

---

### Story US-019: Reports — Monthly Trend Chart & XLSX Export

**As a** user **I want to** see month-by-month income and expense bars and export a summary to Excel **so that** I can share it with my accountant for tax filing.

**Acceptance Criteria:**
- [ ] Monthly trend bar chart (Recharts `BarChart`) on Reports page showing income and expense grouped by month for the selected period
- [ ] Chart shows all months in the range, even if zero
- [ ] "Export" button in Reports header opens a dialog with the current date range pre-filled; clicking "Download" triggers `exportToExcel(userId, range)` and downloads the file
- [ ] Exported file named `mizantrack-export-YYYY-MM-DD.xlsx`
- [ ] Export includes all transactions in the selected range (not just the current page)

**Design Reference:** §5.6 Feature Modules (`MonthlyTrendChart`), FR-RPT-003, FR-EXP-001–003  
**Technical Notes:** Reuse existing `exportToExcel` from `src/lib/export.ts`. Export dialog uses `DateRangePicker` in standalone mode.  
**Dependencies:** US-018  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

### Story US-020: Settings — Preferences Form

**As a** user **I want to** configure my default currency, fiscal year start month, and app theme in Settings **so that** reports and the Zakat calculator use my correct settings.

**Acceptance Criteria:**
- [ ] `/settings` page replaces stub with a preferences card
- [ ] Default currency: text input (3-char ISO code) with AED pre-filled on first load; saved to `DbConfig.currency`
- [ ] Fiscal year start month: dropdown (Jan–Dec, default July/7); saved to `DbConfig.fiscalYearStartMonth`
- [ ] Theme toggle: Light / Dark / System; persisted via `next-themes`
- [ ] Changes save to Dexie `dbConfig` immediately (no explicit Save button — auto-save on change with debounce)
- [ ] First-time load creates a `DbConfig` record for the user if none exists

**Design Reference:** §5.6 Feature Modules (`PreferencesForm`), FR-SET-001, FR-SET-002, FR-SET-006  
**Technical Notes:** `db.dbConfig.put({ id: userId, ...defaults })` on first login init. Use `useDbConfig(userId)` hook. Theme toggle reuses existing `ThemeToggle.tsx`.  
**Dependencies:** US-003 (useDbConfig hook)  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

### Story US-021: HK Import UI

**As a** user **I want to** upload my Hysab Kytab Excel backup and have all my history imported automatically **so that** I don't lose years of financial records.

**Acceptance Criteria:**
- [ ] Settings page has an "Import Data" card with a file picker accepting `.xlsx` only
- [ ] Uploading triggers `importHysabKytab(file, userId)` from existing `src/lib/import/hysabKytab.ts`
- [ ] Progress indicator shown during import (spinner or progress bar)
- [ ] On success: modal shows summary — "X accounts imported, Y categories imported, Z transactions imported (N transfers paired)"
- [ ] On error (missing sheet, parse failure): toast with the specific error message from the importer
- [ ] Re-importing the same file a second time results in no duplicates (upsert behavior is already in the importer)
- [ ] After import, navigating to Transactions shows imported data immediately

**Design Reference:** §5.6 Feature Modules (`ImportPanel`), §7.4 HK Import Flow, FR-IMP-001–006  
**Technical Notes:** Import logic already complete in `src/lib/import/hysabKytab.ts`. This story is UI only — file picker, progress state, success/error display.  
**Dependencies:** US-020  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

### Story US-022: Excel Export UI

**As a** user **I want to** export my transactions to an Excel file for any date range **so that** I can back up my data or open it in Hysab Kytab.

**Acceptance Criteria:**
- [ ] Settings page has an "Export Data" card with a "Download Export" button
- [ ] Clicking the button opens a dialog with a date range picker (DateRangePicker standalone from US-017)
- [ ] Default range is the current month; Fiscal Year preset also available
- [ ] Clicking "Download" calls `exportToExcel(userId, range)` and triggers browser file download
- [ ] Downloaded file named `mizantrack-export-YYYY-MM-DD.xlsx`
- [ ] Button disabled and shows spinner during export generation

**Design Reference:** §5.6 Feature Modules (`ExportPanel`), FR-EXP-001–003  
**Technical Notes:** Export logic already complete in `src/lib/export.ts`. This story is UI only.  
**Dependencies:** US-017, US-020  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

### Story US-023: Firebase Config Form & Sync Status UI

**As a** user **I want to** paste my Firebase config in Settings and see sync status **so that** my data is backed up to my own cloud.

**Acceptance Criteria:**
- [ ] Settings page has a "Cloud Sync" card with a `<textarea>` for Firebase JSON config and an Enable Sync toggle
- [ ] Saving validates the JSON (Zod schema from US-004); invalid config shows an error
- [ ] Valid config saved to `DbConfig.firebaseConfig` and `DbConfig.enabled`
- [ ] "Sync Now" button triggers `syncAll(userId)` from existing sync module; spinner shown during sync; success/error toast after
- [ ] Sync status section shows: "Last synced: [relative time]" or "Never synced" and the current `syncing` state
- [ ] Firestore usage bar shows estimated MB used vs 1GB free limit (uses `getFirestoreUsage`)
- [ ] "Reset Config" link clears Firebase config with a confirmation dialog

**Design Reference:** §5.6 Feature Modules (`FirebaseConfigForm`), §7.3 Auto-Sync Flow, FR-SYN-001–008  
**Technical Notes:** Sync logic already complete in `src/lib/db/sync.ts` and `firebase.ts`. This story is UI + wiring to `useSyncStore`. `triggerSync` action in sync-store calls `syncAll` and updates state.  
**Dependencies:** US-002 (sync-store), US-020  
**Estimated Effort:** 1d  
**Priority:** Must Have

---

### Story US-024: Auto-Sync on Online Event & Sync Status Badge

**As a** user **I want** my data to sync automatically when my phone gets internet access **so that** I never have to manually trigger sync after coming back online.

**Acceptance Criteria:**
- [ ] `src/hooks/useAutoSync.ts` registers a `window` `online` event listener on mount
- [ ] When browser goes online and sync is enabled: `syncAll(userId)` fires automatically; `useSyncStore` updates `syncing` and `lastSync`
- [ ] Auto-sync also runs on a 5-minute interval when online and enabled
- [ ] `SyncStatusBadge` component in AppShell header shows: cloud icon with spinner when syncing, checkmark with relative time when idle, error icon with tooltip when errored
- [ ] Hook cleanup removes event listener on unmount

**Design Reference:** §5.3 Sync Layer, §5.5 UI Component Library (`SyncStatusBadge`), FR-SYN-003  
**Technical Notes:** `useAutoSync` is called once in `AppShell`. Interval via `setInterval` with cleanup in `useEffect` return. Use `navigator.onLine` check before firing sync.  
**Dependencies:** US-023  
**Estimated Effort:** 0.5d  
**Priority:** Must Have

---

## Epic E5: Zakat Calculator & PWA Polish

**Description:** The Zakat calculator — the feature that differentiates MizanTrack most from HK — plus navigation updates and a PWA quality pass.  
**Business Value:** Automated Zakat calculation saves hours of manual work every Ramadan and eliminates calculation errors across multi-currency accounts.  
**Priority:** High  
**Estimated Effort:** 1 sprint

---

### Story US-025: Gold Price Client

**As a** user **I want** the Zakat calculator to automatically fetch today's gold price **so that** I don't have to look it up manually every time I calculate Zakat.

**Acceptance Criteria:**
- [ ] `src/lib/goldPrice.ts` exports `fetchGoldPrice(): Promise<number | null>` returning price per gram in USD
- [ ] Fetches from a configured gold price API (goldapi.io or metals-api — user configures API key in Settings, OQ-01)
- [ ] Result cached in Dexie `dbConfig` as `lastGoldPricePerGram` and `lastGoldPriceFetchedAt` for 1 hour; stale cache returned if API call fails
- [ ] Returns `null` if API key not configured or API unavailable after 1 retry
- [ ] API key stored in `DbConfig` (added as optional field); never logged or sent to any MizanTrack server
- [ ] Unit test covers: successful fetch, API failure (returns cached), expired cache (refetches), null when no key

**Design Reference:** §5.6 Feature Modules (`goldPrice.ts`), §7.5 Zakat Calculation Flow, FR-ZAK-005  
**Technical Notes:** Extend `DbConfig` type with `goldApiKey?: string`, `lastGoldPricePerGram?: number`, `lastGoldPriceFetchedAt?: number`. Add `goldApiKey` field to settings preferences (US-020 or here). Update Dexie schema to `version(1)` — these are new optional fields, no migration needed. Fetch via standard `fetch()` API — no extra library.  
**Dependencies:** US-020  
**Estimated Effort:** 1d  
**Priority:** Should Have

---

### Story US-026: Zakat Assessment Form & Calculation

**As a** user **I want to** select my accounts and gold weight, choose a nisab standard, and get my Zakat obligation calculated automatically **so that** I know exactly what I owe this year.

**Acceptance Criteria:**
- [ ] `/zakat` page (new route) renders the Zakat calculator
- [ ] Assessment date picker (default: today)
- [ ] Account checklist showing each account with its balance as of the assessment date; user toggles which accounts are zakatable
- [ ] Gold weight input (grams; optional tola toggle where 1 tola = 11.664g)
- [ ] Gold price per gram: auto-filled from `fetchGoldPrice()` on load; manual override input shown when auto-fetch fails or user edits
- [ ] Nisab standard selector: "Gold (85g)" or "Silver (595g)"; silver price always manual-only
- [ ] For accounts with non-reference currencies: exchange rate input per currency appears (e.g., "1 PKR = [input] AED")
- [ ] Results card shows: total zakatable wealth (in reference currency), nisab threshold, Zakat obligation (2.5%) or "Not yet liable"
- [ ] All calculations update reactively as inputs change (no submit button required for calculation)

**Design Reference:** §5.6 Feature Modules (`ZakatForm`, `ZakatAccountSelector`, `GoldInputPanel`, `ZakatResult`), §7.5 Zakat Calculation Flow, Appendix B  
**Technical Notes:** Balance at assessment date: `db.transactions.where('accountId').equals(id).and(t => t.date <= assessmentDate.getTime()).toArray()` + opening balance. Zakat formula in design Appendix B. Use `useMemo` for reactive recalculation.  
**Dependencies:** US-025, E2 complete (accounts)  
**Estimated Effort:** 1.5d  
**Priority:** Should Have

---

### Story US-027: Zakat Export & Navigation

**As a** user **I want to** export my Zakat calculation summary and access the Zakat calculator from the main nav **so that** I can share the calculation with others.

**Acceptance Criteria:**
- [ ] "Export Summary" button on Zakat results card downloads an `.xlsx` with: assessment date, per-account balances, exchange rates used, gold weight and price, nisab standard and threshold, total zakatable, Zakat obligation
- [ ] "Zakat" added to `NAV_ITEMS` in `AppShell.tsx` with a crescent/moon icon; navigates to `/zakat`
- [ ] `src/app/(app)/zakat/page.tsx` route created
- [ ] Nav item highlighted when on `/zakat`

**Design Reference:** §5.6 Feature Modules (`ZakatResult`), AppShell nav, FR-ZAK-009  
**Technical Notes:** Zakat XLSX export uses `XLSX.utils.json_to_sheet` directly (no reuse of transaction export). New sheet structure specific to Zakat summary.  
**Dependencies:** US-026  
**Estimated Effort:** 0.5d  
**Priority:** Should Have

---

### Story US-028: Mobile Bottom Navigation & UX Polish

**As a** user on my phone **I want** a bottom tab bar with large touch targets and a visible FAB **so that** I can navigate MizanTrack as easily as a native app.

**Acceptance Criteria:**
- [ ] `BottomNav` component extracted into `src/components/layout/BottomNav.tsx` — visible only on mobile (< 640px); hides on desktop where sidebar/top nav suffices
- [ ] Bottom nav has 5 primary tabs: Dashboard · Transactions · Accounts · Reports · Settings (Zakat accessible from Settings or via direct URL)
- [ ] FAB (+ icon) floats above the bottom nav bar on all pages; taps `openAddTransaction()` from ui-store
- [ ] FAB and nav items have minimum 44×44px touch targets
- [ ] Active nav item visually highlighted (filled icon + label color)
- [ ] `AppShell` updated to show BottomNav on mobile and hide desktop left nav on small screens

**Design Reference:** §6.1 Navigation Structure, §6.4 Accessibility & Responsiveness, FR-PWA-001  
**Technical Notes:** Use Tailwind `hidden sm:flex` / `flex sm:hidden` for responsive nav. FAB uses `position: fixed; bottom: calc(var(--nav-height) + 1rem)`. Tab bar height CSS variable for FAB offset.  
**Dependencies:** US-027  
**Estimated Effort:** 0.5d  
**Priority:** Should Have

---

### Story US-029: PWA Audit & E2E Tests

**As a** user **I want** the app to install correctly on my phone and pass a quality audit **so that** it feels like a real app, not a website.

**Acceptance Criteria:**
- [ ] Lighthouse PWA audit score ≥ 90 in production build
- [ ] App installs successfully on iOS Safari (Add to Home Screen) and Android Chrome (install prompt)
- [ ] E2E test (Playwright): login → create account → add expense → verify balance updated
- [ ] E2E test (Playwright): upload HK `.xlsx` import → verify transaction count in list
- [ ] E2E test (Playwright): navigate to all 6 routes without errors
- [ ] `npm run build` completes without errors or type warnings
- [ ] `npm run validate` (typecheck + lint + format) passes clean

**Design Reference:** §10 Testing Strategy, §3.3 Deployment, FR-PWA-001–004  
**Technical Notes:** Playwright config (`playwright.config.ts`). Run E2E against `npm run dev` or `npm run build && npm run start`. Lighthouse CI optional; manual audit sufficient for v1.0.  
**Dependencies:** All previous stories complete  
**Estimated Effort:** 1d  
**Priority:** Should Have

---

## Sprint Plan

### Sprint 1: Foundation
**Duration:** 1 week  
**Sprint Goal:** App starts, auth works correctly, Zustand stores wired, Dexie hooks live, Vitest running, shared components built.

| ID | Title | Effort | Priority | Status |
|----|-------|--------|----------|--------|
| US-001 | Fix Auth & Add PWA Icons | 0.5d | Must | ⏳ TODO |
| US-002 | Create Zustand Stores | 0.5d | Must | ⏳ TODO |
| US-003 | Create Dexie Live Query Hooks | 1d | Must | ⏳ TODO |
| US-004 | Create Zod Validation Schemas | 0.5d | Must | ⏳ TODO |
| US-005 | Seed Default Categories, Setup Vitest & Shared Components | 1d | Must | ⏳ TODO |

**Capacity:** 5d | **Committed:** 3.5d

---

### Sprint 2: Accounts & Categories
**Duration:** 1 week  
**Sprint Goal:** User can create, edit, archive, and delete accounts with live balances, and manage income/expense categories.

| ID | Title | Effort | Priority | Status |
|----|-------|--------|----------|--------|
| US-006 | Account List with Live Balances | 1d | Must | ⏳ TODO |
| US-007 | Add & Edit Account Form | 1d | Must | ⏳ TODO |
| US-008 | Archive & Soft-Delete Accounts | 0.5d | Must | ⏳ TODO |
| US-009 | Category List (Income / Expense Tree) | 1d | Must | ⏳ TODO |
| US-010 | Add, Edit & Delete Category | 0.5d | Must | ⏳ TODO |

**Capacity:** 5d | **Committed:** 4d

---

### Sprint 3: Transactions
**Duration:** 1 week  
**Sprint Goal:** User can add, view, filter, edit, delete expenses/income/transfers; list handles 10k+ records smoothly.

| ID | Title | Effort | Priority | Status |
|----|-------|--------|----------|--------|
| US-011 | Transaction List with Virtualization, Filters & Search | 2d | Must | ⏳ TODO |
| US-012 | Add Transaction Drawer (Expense & Income) | 1d | Must | ⏳ TODO |
| US-013 | Edit & Soft-Delete Transaction | 0.5d | Must | ⏳ TODO |
| US-014 | Transfer Transaction | 1d | Must | ⏳ TODO |

**Capacity:** 5d | **Committed:** 4.5d

---

### Sprint 4: Dashboard & Reports
**Duration:** 1 week  
**Sprint Goal:** Dashboard shows live account balances and trends; Reports deliver fiscal-year category breakdown and monthly trend with XLSX export.

| ID | Title | Effort | Priority | Status |
|----|-------|--------|----------|--------|
| US-015 | Dashboard — Balance Cards & Month Summary | 1d | Must | ⏳ TODO |
| US-016 | Dashboard — Recent Transactions & Trend Chart | 1.5d | Must | ⏳ TODO |
| US-017 | Shared DateRangePicker Component | 1d | Must | ⏳ TODO |
| US-018 | Reports — Period Selector, Category Breakdown & Account Filter | 1.5d | Must | ⏳ TODO |

**Capacity:** 5d | **Committed:** 5d

---

### Sprint 5: Settings, Sync & Data Portability
**Duration:** 1 week  
**Sprint Goal:** User can import all HK data, export to XLSX, configure Firebase sync, and have data sync automatically when online.

| ID | Title | Effort | Priority | Status |
|----|-------|--------|----------|--------|
| US-019 | Reports — Monthly Trend Chart & XLSX Export | 1d | Must | ⏳ TODO |
| US-020 | Settings — Preferences Form | 0.5d | Must | ⏳ TODO |
| US-021 | HK Import UI | 1d | Must | ⏳ TODO |
| US-022 | Excel Export UI | 0.5d | Must | ⏳ TODO |
| US-023 | Firebase Config Form & Sync Status UI | 1d | Must | ⏳ TODO |
| US-024 | Auto-Sync on Online Event & Sync Status Badge | 0.5d | Must | ⏳ TODO |

**Capacity:** 5d | **Committed:** 4.5d

---

### Sprint 6: Zakat Calculator & PWA Polish
**Duration:** 1 week  
**Sprint Goal:** Zakat calculator fully functional with live gold prices; app installable as PWA; E2E tests passing; production build clean.

| ID | Title | Effort | Priority | Status |
|----|-------|--------|----------|--------|
| US-025 | Gold Price Client | 1d | Should | ⏳ TODO |
| US-026 | Zakat Assessment Form & Calculation | 1.5d | Should | ⏳ TODO |
| US-027 | Zakat Export & Navigation | 0.5d | Should | ⏳ TODO |
| US-028 | Mobile Bottom Navigation & UX Polish | 0.5d | Should | ⏳ TODO |
| US-029 | PWA Audit & E2E Tests | 1d | Should | ⏳ TODO |

**Capacity:** 5d | **Committed:** 4.5d

---

## Dependencies & Risks

### Dependency Map

```
US-001 (auth fix)
  └── US-002 (stores) ──┐
  └── US-003 (hooks) ───┼── US-006 (accounts)
  └── US-004 (schemas)  │     └── US-007 (account form)
  └── US-005 (seed+DX)  │           └── US-008 (archive/delete)
                        │   US-009 (categories)
                        │     └── US-010 (category form)
                        │
                        └── US-011 (txn list) ──> US-012 (add txn)
                              └── US-013 (edit/delete)
                              └── US-014 (transfer)
                        
E2+E3 complete ──> US-015/016 (dashboard)
US-017 (date picker) ──> US-018/019 (reports) ──> US-022 (export UI)
US-020 (settings) ──> US-021 (import UI) ──> US-023 (firebase)
US-023 ──> US-024 (auto-sync)
US-025 (gold price) ──> US-026 (zakat calc) ──> US-027 (export+nav)
```

### Risks

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| Gold price API free tier requires per-user key | Medium | Medium | Add `goldApiKey` field to Settings (US-025); user supplies own key |
| `next-pwa` incompatible with Next.js 16 App Router | High | Low | PWA only in production build; Turbopack in dev (current config already handles this) |
| HK `.xlsx` format varies across HK app versions | Medium | Medium | Test with real backup file in `docs/`; extend parser if needed |
| iOS Safari IndexedDB storage limit (~60MB at 100k txns) | Medium | Low | Monitor; add usage indicator in Settings |
| `@tanstack/react-virtual` API changes | Low | Low | Pin version; test on install |

---

## Release Phases

- **Phase 1 (MVP) — Sprints 1–3:** Auth, accounts, categories, transactions. Fully functional offline finance tracker.
- **Phase 2 (Insights) — Sprint 4:** Dashboard and reports with fiscal-year support.
- **Phase 3 (Cloud) — Sprint 5:** HK import, export, Firebase sync — full data portability.
- **Phase 4 (Zakat) — Sprint 6:** Zakat calculator + PWA install quality.

Each phase delivers independently shippable value.

---

## PRD Requirements Traceability

| PRD ID | Requirement | Story |
|---|---|---|
| FR-AUTH-001–004 | Google OAuth, session, signout, userId scoping | US-001 |
| FR-ACC-001–002 | Create/edit account with currency | US-007 |
| FR-ACC-003–004 | Archive/soft-delete | US-008 |
| FR-ACC-005–006 | Live balance per account, per-currency display | US-006 |
| FR-CAT-001–002 | Category CRUD with hierarchy | US-009, US-010 |
| FR-CAT-003–004 | Soft-delete categories, default seed | US-010, US-005 |
| FR-TXN-001–004 | Expense/Income CRUD with metadata | US-012, US-013 |
| FR-TXN-002 | Transfer with toAccountId | US-014 |
| FR-TXN-006–007 | Filters + search | US-011 |
| FR-TXN-008–009 | Edit + soft-delete | US-013 |
| FR-TXN-010 | Virtualization for 10k+ | US-011 |
| FR-IMP-001–007 | HK xlsx import | US-021 |
| FR-EXP-001–003 | XLSX export with date range | US-022 |
| FR-SYN-001–008 | Firebase sync setup + auto-sync + status | US-023, US-024 |
| FR-DASH-001–004 | Dashboard widgets | US-015, US-016 |
| FR-RPT-001–006 | Reports with all periods + charts + export | US-017, US-018, US-019 |
| FR-ZAK-001–009 | Zakat calculator full | US-025, US-026, US-027 |
| FR-SET-001–006 | Settings all sections | US-020, US-021, US-022, US-023 |
| FR-PWA-001–004 | PWA install + offline + icons | US-001, US-029 |
