# Zakat Calculator - Quick Start Guide

> **Superseded note — October 2026:** The authoritative zakat requirements are now in [`zakat-requirements-2026-10.md`](zakat-requirements-2026-10.md). This quick-start remains useful only as a rough description of intended user-facing areas such as account selection, gold entry, yearly/monthly review, history, and payment recording. It is obsolete where it tells the user to choose a nisab standard, gates saving/calculation on being above nisab, uses pure-gold conversion as the main calculation model, or implies the existing screen matches the owner's spreadsheet. It also contradicts `zakat-enhancement-plan.md` about the Papa loan: this guide says "Papa owes you / you lent TO Papa", while the plan and the verified `2024` workbook sheet treat Papa as a negative liability. The Papa sign is an open question for the owner; do not guess from this guide.

## 🚀 What's New?

Your zakat calculator now matches the functionality of your Google Sheets tracker with these major improvements:

### ✨ New Features

1. **Gold Inventory** - Track all your gold items with different purities
2. **Islamic Calendar** - Automatic zakat year tracking (Ramadan → Sha'ban)
3. **Monthly Balances** - See your wealth progression across 12 Islamic months
4. **Liability Support** - Properly handle loans you owe vs loans given
5. **Calculation History** - Save and review past calculations
6. **Payment Tracking** - Record when and where you paid zakat

---

## 📱 Getting Started

### Step 1: Set Up Your Accounts

Go to **Accounts** page and review your accounts:

**For loans YOU owe** (like Papa):
- These REDUCE your zakatable wealth
- Mark as "Liability" type
- Example: "Loan from Papa" → Type: Liability

**For loans GIVEN to others** (like Basit):
- These ADD to your zakatable wealth
- Keep as "Asset" type (default)
- Example: "Loan to Basit" → Type: Asset

### Step 2: Add Your Gold (if any)

Go to **Zakat** page → **Calculator** tab:

1. Click "+ Add Gold Item"
2. Fill in:
   - **Title**: e.g., "Wedding Ring", "Necklace"
   - **Weight**: in grams
   - **Purity**: 21k, 22k, or 24k
   - **Purchase Date**: (optional)
   - **Purchase Price**: (optional)
3. Click "Save"

The app automatically calculates pure gold weight for zakat.

### Step 3: Calculate Zakat

On the **Calculator** tab:

1. **Set Assessment Date** - Usually end of Sha'ban
2. **Review Gold Items** - Already included automatically
3. **Select Zakatable Accounts** - Check the ones subject to zakat
4. **Enter Exchange Rates** - If you have foreign currency accounts
5. **Set Gold Price** - Click "Refresh" or enter manually
6. **Choose Nisab Standard** - Gold (85g) or Silver (595g)

The app shows:
- Total Assets
- Total Liabilities (if any)
- Net Zakatable Wealth
- Nisab Threshold
- **Zakat Obligation (2.5%)**

### Step 4: View Monthly Progression

Switch to **Monthly View** tab:

- See account balances at the end of each Islamic month
- Ramadan → Shawwal → ... → Sha'ban
- The MINIMUM total is highlighted (what zakat is based on)
- Liabilities are shown separately

This helps you verify that you maintained nisab throughout the year.

### Step 5: Save Your Calculation

Back on **Calculator** tab:

If you're liable (wealth ≥ nisab):
- Click "**Save This Calculation**"
- It's saved to History with the Islamic year

### Step 6: Record Payments

Switch to **Payments** tab:

When you pay zakat:
1. Click "+ Add Payment"
2. Fill in:
   - **Payment Date**
   - **Amount**
   - **Islamic Year** (auto-detected)
   - **Recipient** (optional)
   - **Link to Calculation** (optional)
3. Click "Save"

---

## 📊 Understanding the Interface

### Calculator Tab
Main calculation interface with:
- Gold inventory section
- Account selection (with liability badges)
- Exchange rates
- Results card with breakdown

### Monthly View Tab
Excel-like table showing:
- **Columns**: 12 Islamic months
- **Rows**: Your accounts
- **Last Row**: TOTAL (in reference currency)
- **Highlighted**: Minimum wealth month

### History Tab
Past calculations:
- Click to expand details
- Shows configuration, results, account breakdown
- Delete old calculations

### Payments Tab
Payment records:
- Total paid (all time)
- Individual payment cards
- Edit/delete functionality

---

## 💡 Tips & Best Practices

### When to Calculate Zakat

**Annually** at the end of Sha'ban:
- This is when your Islamic year completes
- Typically February each year
- Check the Islamic calendar for exact dates

### Account Types Matter

**Mark as Liability** only if:
- It's money YOU owe TO someone
- Examples: "Loan from Papa", "Credit Card Debt"

**Keep as Asset** (default) for:
- Regular accounts (savings, current, investment)
- Money OWED to you by others
- Examples: "Loan to Basit", "Meezan Savings"

### Gold Purity Conversion

The app automatically converts:
- **21k gold** → 87.5% pure (21/24)
- **22k gold** → 91.67% pure (22/24)
- **24k gold** → 100% pure

So if you have 100g of 22k gold, it counts as 91.67g of pure gold for zakat.

### Exchange Rates

For foreign currency accounts:
- Enter "1 USD = ? PKR" (or your reference currency)
- The app converts all accounts to reference currency
- Update rates at time of assessment

### Nisab Standard

**Gold nisab** (85 grams):
- Usually higher threshold
- Fewer people liable

**Silver nisab** (595 grams):
- Lower threshold
- More people liable
- Some scholars recommend silver to help more

Choose based on your school of thought.

---

## 🔄 Annual Workflow

### End of Islamic Year (Sha'ban)

1. **Update inventory**
   - Add/remove gold items if changed
   - Archive closed accounts

2. **Set assessment date**
   - Usually last day of Sha'ban
   - App shows current Islamic year

3. **Calculate zakat**
   - Review all settings
   - Save calculation

4. **View monthly progression**
   - Verify minimum ≥ nisab
   - Ensure you held it all year

5. **Pay zakat**
   - Distribute as per Islamic guidelines
   - Record in Payments tab

6. **Review history**
   - Compare to previous years
   - Track your wealth growth

---

## 🎯 Common Scenarios

### Scenario 1: You have gold and multiple accounts

1. Add all gold items (Calculator tab)
2. Select all zakatable accounts
3. Enter exchange rates if needed
4. Calculate → Shows total including gold value

### Scenario 2: You owe a loan AND gave a loan

**Papa owes you**: (You lent TO Papa)
- Type: Asset
- Include in zakatable accounts
- Adds to your wealth

**You owe Papa**: (You borrowed FROM Papa)
- Type: Liability
- Include in zakatable accounts
- Reduces your wealth

### Scenario 3: Foreign currency accounts

Example: You have USD and AED accounts, reference is PKR

1. Select USD and AED accounts as zakatable
2. App shows "Exchange Rates" section
3. Enter: 
   - 1 USD = 278 PKR
   - 1 AED = 75.7 PKR
4. All accounts converted to PKR for calculation

### Scenario 4: Monthly balances fluctuate

The **Monthly View** shows:
- Balance at END of each Islamic month
- Minimum is highlighted
- Zakat is on the MINIMUM held for full year

This ensures you don't pay zakat on temporary spikes.

---

## ❓ FAQ

**Q: Why is the Islamic year different from Gregorian year?**

A: Islamic calendar is lunar (354 days). Zakat year runs Ramadan → Sha'ban, not Jan → Dec.

**Q: When should I set assessment date?**

A: End of Sha'ban (last day before Ramadan starts). The app shows which Islamic year this belongs to.

**Q: My gold is mixed purities. How to handle?**

A: Add each piece separately with its purity. App calculates total pure gold automatically.

**Q: Should I include my emergency fund?**

A: Yes, if it's liquid and zakatable. Islam requires zakat on savings above nisab.

**Q: Can I see calculations from previous years?**

A: Yes! **History** tab shows all saved calculations. Click to expand details.

**Q: How do I export for my records?**

A: Click "Export" button on Calculator tab. Downloads Excel file with full breakdown.

---

## 🆘 Troubleshooting

**Problem**: Accounts not showing in list

**Solution**: Check they're not archived. Go to Accounts page.

---

**Problem**: Islamic year seems wrong

**Solution**: App uses approximate conversion. For exact dates, verify against Islamic calendar authority.

---

**Problem**: Monthly balances don't match my records

**Solution**: Check transaction import was complete. Monthly view calculates from transactions.

---

**Problem**: Can't save calculation

**Solution**: Ensure you're liable (wealth ≥ nisab) and all required fields are filled.

---

## 📚 Learn More

- Zakat rules: Consult your local Islamic scholar
- Islamic calendar: [islamicfinder.org](https://www.islamicfinder.org)
- Gold prices: [goldprice.org](https://goldprice.org)

---

**Need Help?**

Open an issue on GitHub or contact support.

**Happy Zakat Calculation! 🌙**
