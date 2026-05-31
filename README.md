# MizanTrack — Personal Finance Tracker

A privacy-first, offline-capable personal finance tracker built with Next.js 16. Your data lives in **your own** Firebase project — no shared servers, no data mining.

---

## Features

- 🔐 **Google OAuth** — secure sign-in, no passwords
- 📱 **PWA + Offline-first** — works on mobile without internet via IndexedDB
- ☁️ **Your own Firebase** — each user connects their own free Firestore instance
- 🔄 **Auto sync** — local ↔ cloud sync when online, last-write-wins conflict resolution
- 💾 **Manual backup** — trigger sync on demand
- 📊 **Reports & Charts** — daily / weekly / monthly / quarterly / half-yearly / yearly / fiscal year / custom range
- 🌙 **Dark mode** — system-aware with manual toggle
- 📥 **Hysab Kytab import** — migrate your existing data from `.xlsx` backup
- 📤 **Excel export** — export transactions in Hysab Kytab-compatible format
- 💱 **Multi-currency** — AED default, per-account currency support

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Auth | NextAuth.js v5 + Google Provider |
| UI | shadcn/ui (Nova) + Tailwind CSS v4 |
| Local DB | Dexie.js (IndexedDB) |
| Cloud DB | Firebase Firestore (user-supplied) |
| Charts | Recharts |
| PWA | next-pwa |
| Export/Import | SheetJS (xlsx) |
| State | Zustand |
| Forms | React Hook Form + Zod |

---

## Getting Started

### Prerequisites

- Node.js 20+
- A Google Cloud project with OAuth 2.0 credentials
- (Optional) A Firebase project for cloud sync

### Installation
```bash
git clone https://github.com/salmanzahidlatif/mizantrack.git
cd mizantrack
npm install
```

### Environment Setup

Create `.env.local` in the project root:
```bash
NEXTAUTH_SECRET=<run: openssl rand -base64 32>
AUTH_GOOGLE_ID=<your Google OAuth client ID>
AUTH_GOOGLE_SECRET=<your Google OAuth client secret>
```

### Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a project → **APIs & Services** → **Credentials**
3. Create **OAuth 2.0 Client ID** → Web application
4. Add authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
5. Copy Client ID and Secret to `.env.local`

### Run
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Firebase Setup (Optional — for cloud sync)

MizanTrack works fully offline without Firebase. To enable cloud sync:

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create a new project
3. Enable **Firestore Database** → Start in production mode
4. Add Firestore security rules (see below)
5. Go to **Project Settings** → copy the Firebase config JSON
6. In MizanTrack → **Settings** → paste your Firebase config and enable sync

### Firestore Security Rules
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{document=**} {
      allow read, write: if true;
    }
  }
}
```

> MizanTrack accesses Firestore directly from the browser without Firebase Authentication. Use `allow read, write: if true` — your data is protected by the fact that it lives in **your own private Firebase project**, not a shared one. Nobody else has your project's credentials.

---

## Data Model
```
accounts      — bank accounts, cash, wallets (per currency)
categories    — income / expense categories (with hierarchy)
transactions  — expense, income, transfer between accounts
```

---

## Importing from Hysab Kytab

1. In Hysab Kytab → export your backup as `.xlsx`
2. In MizanTrack → **Settings** → **Import Data** → select your file
3. Accounts, categories, and transactions will be imported
4. Transfer pairs are auto-detected and merged

---

## Scripts
```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run start        # Start production server
npm run lint         # ESLint (zero warnings policy)
npm run lint:fix     # Auto-fix lint issues
npm run format       # Prettier format all files
npm run format:check # Check formatting without writing
npm run typecheck    # TypeScript type check
npm run validate     # typecheck + lint + format:check
```

---

## Project Structure
```
src/
├── app/
│   ├── (auth)/login/         # Public login page
│   ├── (app)/                # Protected routes
│   │   ├── dashboard/
│   │   ├── transactions/
│   │   ├── accounts/
│   │   ├── categories/
│   │   ├── reports/
│   │   └── settings/
│   └── api/auth/             # NextAuth route handler
├── components/
│   ├── ui/                   # shadcn/ui components
│   ├── layout/               # AppShell, ThemeToggle
│   ├── transactions/
│   ├── accounts/
│   ├── categories/
│   ├── charts/
│   └── settings/
├── lib/
│   ├── db/
│   │   ├── local.ts          # Dexie schema
│   │   ├── firebase.ts       # Per-user Firestore client
│   │   └── sync.ts           # Bidirectional sync engine
│   ├── actions/              # Next.js server actions
│   ├── import/               # Hysab Kytab importer
│   ├── export.ts             # Excel export
│   ├── dateRange.ts          # Filter period utilities
│   └── auth.ts               # NextAuth config
├── store/                    # Zustand slices
└── types/                    # TypeScript interfaces
```

---

## License

MIT — see [LICENSE](LICENSE)

---

## Acknowledgements

Inspired by [Hysab Kytab](https://hysabkytab.com) — a great app that motivated building something more customizable.
