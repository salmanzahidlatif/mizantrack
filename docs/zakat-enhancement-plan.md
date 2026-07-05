# Zakat Feature Enhancement Plan

## Overview
Enhance the zakat calculator to match the functionality of the Google Sheets tracker with:
- Islamic calendar integration
- Gold inventory tracking with multiple purities
- Monthly balance tracking (Ramadan → Sha'ban)
- Liability tracking (loans owed vs loans given)
- Zakat payment history
- Historical zakat calculations

## Data Model Changes

### 1. New Table: `goldItems`
```typescript
interface GoldItem {
  id: string;
  userId: string;
  title: string;              // e.g., "Wedding Ring", "Necklace"
  weight: number;             // in grams
  purity: '21k' | '22k' | '24k';
  purchaseDate?: number;      // Unix ms
  purchasePrice?: number;     // Original cost (reference only)
  notes?: string;
  updatedAt: number;
  deletedAt?: number;
}
```

### 2. New Table: `zakatCalculations`
```typescript
interface ZakatCalculation {
  id: string;
  userId: string;
  islamicYear: string;        // e.g., "1446-1447"
  assessmentDate: number;     // Unix ms - typically end of Sha'ban
  
  // Configuration used
  nisabStandard: 'gold' | 'silver';
  goldPricePerGram: number;
  silverPricePerGram?: number;
  referenceCurrency: string;
  
  // Gold holdings
  totalGoldWeightGrams: number;
  totalGoldValue: number;
  
  // Account balances snapshot
  accountBalances: {
    accountId: string;
    accountTitle: string;
    balance: number;
    currency: string;
    exchangeRate: number;
    zakatable: boolean;
  }[];
  
  // Results
  totalZakatable: number;
  nisabThreshold: number;
  zakatObligation: number;
  isLiable: boolean;
  
  // Monthly minimum tracking (for the 12 Islamic months)
  monthlyBalances?: {
    month: string;            // e.g., "Ramadan 1446"
    totalWealth: number;
  }[];
  
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}
```

### 3. New Table: `zakatPayments`
```typescript
interface ZakatPayment {
  id: string;
  userId: string;
  calculationId?: string;     // Link to ZakatCalculation
  islamicYear: string;        // e.g., "1446-1447"
  
  date: number;               // Unix ms - when paid
  amount: number;
  currency: string;
  recipient?: string;         // e.g., "Local Masjid", "Charity X"
  notes?: string;
  
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
}
```

### 4. Enhanced `Account` Type
Add optional fields to existing Account interface:
```typescript
interface Account {
  // ... existing fields
  accountType?: 'asset' | 'liability';  // Default: 'asset'
  // liability = loan you owe (Papa)
  // asset = money owed to you (Basit) or regular accounts
}
```

## Islamic Calendar Integration

### Hijri Date Utilities
- Use `date-fns` with hijri-converter or similar library
- Functions needed:
  - `getIslamicYear(date: Date): string` → "1446"
  - `getIslamicMonth(date: Date): string` → "Ramadan 1446"
  - `getZakatYear(date: Date): string` → "1446-1447"
  - `getIslamicMonthEndDate(month: string, year: number): Date`
  - `getZakatYearRange(islamicYear: string): { start: Date, end: Date }`

### Islamic Month Order
```typescript
const ISLAMIC_MONTHS = [
  'Ramaḍān',
  'Shawwāl',
  'Zū al-Qaʿdah',
  'Zū al-Ḥijjah',
  'al-Muḥarram',      // Year changes here
  'Ṣafar',
  'Rabīʿ al-ʾAwwal',
  'Rabīʿ ath-Thānī',
  'Jumādā al-ʾAwwal',
  'Jumādā ath-Thāniyah',
  'Rajab',
  'Shaʿbān'
] as const;
```

## UI Components

### 1. Gold Inventory Management (`GoldItemsManager.tsx`)
- List of gold items with add/edit/delete
- Form fields: Title, Weight, Purity, Purchase Date, Purchase Price, Notes
- Show total gold weight and value
- Calculate pure gold equivalent for zakat

### 2. Monthly Balance View (`ZakatMonthlyBalances.tsx`)
- Table with Islamic months as columns
- Accounts as rows
- Show balance at end of each month
- Highlight minimum balance (for nisab check)
- TOTAL row at bottom

### 3. Zakat History (`ZakatHistory.tsx`)
- List of past calculations by Islamic year
- Show: Year, Assessment Date, Total Zakatable, Zakat Owed, Paid, Remaining
- Click to view detailed calculation

### 4. Zakat Payments (`ZakatPayments.tsx`)
- List of payments made
- Add new payment with: Date, Amount, Recipient, Notes
- Link to specific zakat year

### 5. Enhanced Zakat Calculator (`ZakatPageClient.tsx` - updated)
- Islamic year selector
- Include gold items in calculation
- Show liabilities separately (deducted)
- Show loans given separately (added)
- Monthly balance progression
- Save calculation to history
- Track payments vs obligation

## Implementation Priority

1. ✅ Design data model (this document)
2. Add database schema for new tables
3. Implement Islamic calendar utilities
4. Build Gold Items UI and logic
5. Create Monthly Balance View
6. Enhance main Zakat Calculator
7. Add Zakat History view
8. Add Zakat Payments tracking
9. Add reports and charts

## Notes from Today's Analysis

### Key Insights:
1. **Basit bhai loan**: User GAVE loan to Basit (asset), so it should be POSITIVE and zakatable
2. **Papa loan**: User OWES Papa (liability), so it's NEGATIVE and reduces zakatable wealth
3. **Account balances**: Must be calculated at END of each Islamic month
4. **Zakat year**: Runs Ramadan → Sha'ban (not Jan→Dec)
5. **Islamic year transition**: Happens at al-Muḥarram (middle of zakat year)
6. **Minimum balance**: Zakat is on the MINIMUM wealth held for full lunar year

### Corrections Applied Today:
- Fixed Islamic year numbering (2025 sheet should be 1445-1446, not 1446-1447)
- Corrected Islamic month date ranges
- Recalculated balances based on proper month-end dates
- Added Basit bhai as zakatable asset

### Account Mappings (from HYSAB KYTAB):
- Meezan - Current → Meezan (Default)
- Meezan - Saving → Meezan (Savings)
- Al-Meezan Portfolio 233509 - 1 → Meezan (Investment)
- Papa → Loan <-- (Papa) [LIABILITY]
- Basit bhai → Loan <-- (Basit bhai) [ASSET]
- Cash → Cash
- Al Meezan MAICF → Al Meezan MAICF
- Kids (MCF) → Kids (MCF)
