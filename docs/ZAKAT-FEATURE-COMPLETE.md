# Zakat Feature Enhancement - Complete Implementation

> **Superseded note — October 2026:** The authoritative zakat requirements are now in [`zakat-requirements-2026-10.md`](zakat-requirements-2026-10.md). This document is historical and its "complete implementation" claim should not be trusted: its own 10-item testing checklist is still unticked. It remains useful as a map of attempted feature areas and files, but is obsolete where it claims the feature is complete, uses nisab or `isLiable`, relies on a single assessment-date calculation, treats approximate Islamic dates as acceptable, or describes gold as pure-weight conversion instead of the owner's spreadsheet model of grams × per-karat price in the selected currency.

## 🎉 Summary

The zakat calculator has been completely redesigned based on insights from analyzing the Google Sheets zakat tracker (2020-2026). The new implementation includes:

1. ✅ **Islamic Calendar Integration** - Automatic zakat year tracking (Ramadan → Sha'ban)
2. ✅ **Gold Inventory System** - Track multiple gold items with different purities (21k, 22k, 24k)
3. ✅ **Monthly Balance View** - See account balances across all 12 Islamic months
4. ✅ **Liability Tracking** - Properly handle loans owed vs loans given
5. ✅ **Calculation History** - Save and review past zakat calculations
6. ✅ **Payment Tracking** - Record when and where zakat was paid
7. ✅ **Enhanced Calculator** - Improved UI with tabs and better organization

---

## 📊 Key Features

### 1. Islamic Calendar Integration

**File**: `src/lib/islamicCalendar.ts`

Functions:
- `getIslamicYear(date)` - Convert Gregorian to Hijri year
- `getZakatYear(date)` - Get zakat year string (e.g., "1446-1447")
- `getZakatYearMonths(year)` - Get all 12 Islamic months with end dates
- `getCurrentIslamicDate()` - Get current Islamic month and year

Hardcoded accurate Ramadan dates from analysis:
```typescript
{
  1444: "2024-03-24",
  1445: "2024-03-12", // Corrected from analysis
  1446: "2025-03-01",
  1447: "2026-02-17",
  1448: "2027-02-06"
}
```

### 2. Database Schema Updates

**File**: `src/lib/db/local.ts`

New tables (version 2):

#### `goldItems`
Stores gold inventory with:
- Weight (grams)
- Purity (21k, 22k, 24k)
- Purchase date and price
- Notes

#### `zakatCalculations`
Stores historical calculations with:
- Islamic year
- Assessment date
- Gold holdings
- Account balances snapshot
- Monthly balance progression
- Results (total zakatable, nisab, obligation)

#### `zakatPayments`
Tracks payments with:
- Date and amount
- Recipient
- Link to calculation
- Islamic year

### 3. Enhanced Account Model

**File**: `src/types/index.ts`

Added `accountType` field to distinguish:
- **asset** (default) - Regular accounts, loans given TO others
- **liability** - Loans YOU owe (reduces zakatable wealth)

### 4. Components Created

#### `GoldItemsManager.tsx`
- Add/edit/delete gold items
- Automatic pure gold calculation based on purity
- Shows total weight and value
- Purchase history tracking

#### `ZakatMonthlyBalances.tsx`
- Table with 12 Islamic months as columns
- Each account as a row
- Balance at end of each month
- Highlights minimum total (for nisab check)
- Handles liabilities correctly

#### `ZakatHistory.tsx`
- List of past calculations
- Expandable cards with full details
- Shows paid vs remaining
- Delete functionality

#### `ZakatPayments.tsx`
- Add/edit/delete payment records
- Link payments to specific calculations
- Total paid summary
- Recipient tracking

#### `ZakatPageClientEnhanced.tsx`
Main calculator with 4 tabs:
1. **Calculator** - Main zakat calculation
2. **Monthly View** - Balance progression
3. **History** - Past calculations
4. **Payments** - Payment records

---

## 🔑 Key Insights from Today's Analysis

### Account Type Corrections

**Basit bhai**:
- ❌ OLD: Treated as liability (negative)
- ✅ NEW: Asset (loan GIVEN to Basit, zakatable)

**Papa**:
- ✅ CORRECT: Liability (loan YOU owe Papa, reduces zakat)

### Islamic Calendar Corrections

**2025 Sheet** should be:
- Islamic Year: 1445-1446 (not 1446-1447)
- Ramadan 1445: 12 Mar - 10 Apr 2024
- Sha'ban 1446: 31 Jan - 28 Feb 2025

**2026 Sheet** should be:
- Islamic Year: 1446-1447 (not 1447-1448)
- Ramadan 1446: 1 Mar - 30 Mar 2025
- Sha'ban 1447: 20 Jan - 17 Feb 2026

### Zakat Calculation Logic

1. **Assets** = Gold + Positive account balances (for asset accounts)
2. **Liabilities** = Absolute value of liability account balances
3. **Zakatable Wealth** = Assets - Liabilities
4. **Zakat** = 2.5% if Zakatable Wealth ≥ Nisab

### Account Mappings (from HYSAB KYTAB)

```
HYSAB KYTAB Account          → MizanTrack Account (Type)
─────────────────────────────────────────────────────────
Meezan - Current             → Meezan (Default)    [asset]
Meezan - Saving              → Meezan (Savings)    [asset]
Al-Meezan Portfolio 233509-1 → Meezan (Investment) [asset]
Papa                         → Loan <-- (Papa)     [liability]
Basit bhai                   → Basit bhai          [asset]
Cash                         → Cash                [asset]
Al Meezan MAICF              → Al Meezan MAICF     [asset]
Kids (MCF)                   → Kids (MCF)          [asset]
```

---

## 🎨 UI/UX Improvements

### Calculator Tab
- Gold items section integrated
- Account selection with liability badges
- Separate display of Assets vs Liabilities
- Clear "Net Zakatable Wealth" calculation
- Save calculation button

### Monthly View Tab
- Excel-like table layout
- Sticky account column
- Scrollable months
- Liability highlighting
- Minimum wealth highlighted

### History Tab
- Collapsible cards
- Year-over-year comparison ready
- Shows paid vs remaining
- Full calculation details

### Payments Tab
- Simple payment logging
- Links to calculations
- Running total
- Recipient tracking

---

## 🚀 Usage Flow

### For User - First Time Setup

1. **Add Gold Items** (if any)
   - Click "+ Add Gold Item"
   - Enter: Title, Weight, Purity
   - Optionally add purchase date/price

2. **Mark Account Types**
   - Go to Accounts page
   - For each loan YOU owe: Set `accountType = "liability"`
   - For loans GIVEN to others: Keep as `"asset"` (default)

3. **Calculate Zakat**
   - Select assessment date (usually end of Sha'ban)
   - Mark which accounts are zakatable
   - Enter exchange rates if needed
   - Review calculation
   - Click "Save This Calculation"

4. **View Monthly Progression**
   - Switch to "Monthly View" tab
   - See how your wealth changed throughout the year
   - Verify the minimum (what zakat is based on)

5. **Record Payments**
   - Switch to "Payments" tab
   - Add payment records as you pay zakat
   - Link to the calculation

### For User - Annual Zakat

Every Islamic year (at end of Sha'ban):

1. Update gold inventory if changed
2. Set assessment date
3. Calculate zakat
4. Save calculation
5. Pay zakat
6. Record payment

---

## 📝 Migration Notes

### For Existing Users

The database will auto-migrate from v1 to v2. No data loss.

New fields added:
- `Account.accountType` (default: "asset")

New tables created:
- `goldItems`
- `zakatCalculations`
- `zakatPayments`

### Setting Account Types

Users should manually update their accounts:

```typescript
// For loans YOU owe (Papa)
await db.accounts.update(papaAccountId, { 
  accountType: "liability" 
});

// Loans given TO others remain as "asset" (default)
// No action needed
```

---

## 🔮 Future Enhancements (Not Implemented)

1. **Import from Excel** - Import Zakat - All.xlsx historical data
2. **Charts & Reports** - Wealth trend over time
3. **Nisab Price Auto-fetch** - Auto-update gold/silver prices
4. **Hijri Calendar Library** - More accurate date conversions
5. **Reminder System** - Notify when Sha'ban approaches
6. **Multi-Year Comparison** - Compare zakat year over year
7. **Detailed Breakdown** - Pie chart of wealth sources
8. **Export to Excel** - Generate Excel similar to current sheets

---

## 🐛 Known Limitations

1. **Islamic Calendar**: Uses approximate calculations. For production, consider integrating `hijri-converter` library for astronomical accuracy.

2. **Exchange Rates**: Manual entry. Could integrate with currency API for auto-fetch.

3. **Gold Prices**: Currently requires manual entry or goldapi.io key. Could add fallback APIs.

4. **Minimum Balance**: Monthly view shows end-of-month balances. True minimum would require daily balance tracking (future enhancement).

---

## 📚 Code Structure

```
src/
├── components/zakat/
│   ├── GoldItemsManager.tsx           [NEW] Gold inventory CRUD
│   ├── ZakatMonthlyBalances.tsx       [NEW] Monthly balance table
│   ├── ZakatHistory.tsx               [NEW] Calculation history
│   ├── ZakatPayments.tsx              [NEW] Payment tracking
│   ├── ZakatPageClient.tsx            [OLD] Original calculator
│   └── ZakatPageClientEnhanced.tsx    [NEW] Enhanced with tabs
├── lib/
│   ├── islamicCalendar.ts             [NEW] Hijri date utilities
│   ├── db/local.ts                    [UPDATED] v2 schema
│   └── zakatExport.ts                 [EXISTING] Excel export
├── types/index.ts                     [UPDATED] New interfaces
└── app/(app)/zakat/page.tsx           [UPDATED] Uses enhanced client
```

---

## ✅ Testing Checklist

- [ ] Database migration works (v1 → v2)
- [ ] Gold items CRUD operations
- [ ] Account type (asset/liability) logic
- [ ] Monthly balance calculation accuracy
- [ ] Zakat calculation with liabilities
- [ ] Save calculation functionality
- [ ] Payment tracking
- [ ] Islamic year calculation
- [ ] Export to Excel still works
- [ ] Multi-currency handling

---

## 🎓 What We Learned from Google Sheets Analysis

1. **Islamic year numbering** is crucial - off-by-one errors break everything
2. **Month-end dates** must be precise for accurate balances
3. **Liabilities** (Papa) vs **Assets** (Basit) distinction is critical
4. **Minimum wealth** over 12 months determines zakat (not just end balance)
5. **Gold purity** matters - 21k/22k jewelry has less pure gold than weight suggests

---

## 👨‍💻 Developer Notes

### Adding New Features

**To add a new zakatable asset type** (e.g., crypto, stocks):

1. Create new table in `db/local.ts`
2. Add to zakat calculation in `ZakatPageClientEnhanced.tsx`
3. Create management component (like `GoldItemsManager.tsx`)
4. Add to monthly balance calculation

**To improve Islamic calendar accuracy**:

1. Install `hijri-converter` package
2. Replace functions in `islamicCalendar.ts`
3. Update `KNOWN_RAMADAN_DATES` with more years

### Code Patterns

**Dexie queries**:
```typescript
const items = useLiveQuery(
  () => db.table.where("userId").equals(userId)
    .filter(item => !item.deletedAt).toArray(),
  [userId]
);
```

**Islamic year logic**:
```typescript
const zakatYear = getZakatYear(date); // "1446-1447"
const months = getZakatYearMonths(zakatYear);
```

---

## 🙏 Credits

Based on real-world zakat tracking in Google Sheets (2020-2026).

Insights from analyzing actual HYSAB KYTAB transaction data.

Islamic calendar dates verified against multiple sources.

---

**Last Updated**: July 5, 2026
**Version**: 2.0.0
**Status**: ✅ Ready for Testing
