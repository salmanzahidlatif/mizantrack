# Zakat requirements — single source of truth — 9 October 2026

This is the **single source of truth for the MizanTrack zakat feature** as of 9 October 2026. Start here in the next session. Older zakat documents are historical only and are superseded wherever they disagree with this file:

- `docs/zakat-enhancement-plan.md`
- `docs/ZAKAT-FEATURE-COMPLETE.md`
- `docs/ZAKAT-QUICK-START.md`

The source workbook is `docs/Zakat - All.xlsx`. Its `2020`–`2024` sheets are the owner's hand-calculated history and the trusted evidence for the model, though they may still contain mistakes the owner wants to find. The `2025` and `2026` sheets are known-wrong and must not be used as reference calculations.

Owner clarification: **"2025 and 2026 are never calculated properly and have wrong data tbh"**.

## 1. Product goal

The owner said the current zakat functionality is not what they need. The goal is to reproduce the owner's spreadsheet model from real MizanTrack account data so they can verify and correct past years, and compute 2025 and 2026 properly.

The app should become a user-friendly yearly zakat screen, mirroring the spreadsheet sub-sheets, not the current monthly-first calculator.

## 2. Explicit non-goal: nisab is dropped

The owner said to **"forget about the nisab etc."**

Therefore:

- no gold nisab;
- no silver nisab;
- no 85g threshold;
- no `isLiable` threshold gate;
- no "zakat due / not due" decision based on wealth crossing a threshold.

The calculation is simply the selected yearly basis plus gold, multiplied by the editable zakat percentage. Do not reintroduce nisab unless the owner explicitly asks later.

## 3. Spreadsheet year model

Each sheet is one zakat year running **Ramaḍān → Shaʿbān**, not January → December.

The Hijri year rolls over in the middle of the zakat year at **al-Muḥarram**. For example, the `2024` sheet shows 1444 for Ramaḍān through Zū al-Ḥijjah, then 1445 from al-Muḥarram onwards.

The 12 Islamic months, in spreadsheet order, are:

1. Ramaḍān
2. Shawwāl
3. Zū al-Qaʿdah
4. Zū al-Ḥijjah
5. al-Muḥarram
6. Ṣafar
7. Rabīʿ al-ʾAwwal
8. Rabīʿ ath-Thānī
9. Jumādā al-ʾAwwal
10. Jumādā ath-Thāniya
11. Rajab
12. Shaʿbān

Every year view must show each Islamic month's Gregorian date range. Wrong boundaries matter: a transaction placed in the wrong Islamic month changes month-end balances and can change zakat owed.

### Trusted historical month ranges

These ranges are copied from the trusted `2020`–`2024` sheets.

| Sheet | Hijri years | Ramaḍān | Shawwāl | Zū al-Qaʿdah | Zū al-Ḥijjah | al-Muḥarram | Ṣafar | Rabīʿ al-ʾAwwal | Rabīʿ ath-Thānī | Jumādā al-ʾAwwal | Jumādā ath-Thāniya | Rajab | Shaʿbān |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `2020` | 1440 → 1441 | 7th May - 4th Jun | 5th Jun - 4th Jul | 5th Jul - 2nd Aug | 3rd Aug - 31st Aug | 1st Sep - 30th Sep | 1st Oct - 29th Oct | 30th Oct - 28th Nov | 29th Nov - 27th Dec | 28th Dec - 26th Jan | 27th Jan - 25th Feb | 26th Feb - 25th Mar | 26th Mar - 24th Apr |
| `2021` | 1441 → 1442 | 25th Apr - 24th May | 25th May - 22nd Jun | 23rd Jun - 22nd Jul | 23rd Jul - 20th Aug | 21st Aug - 18th Sep | 19th Sep - 18th Oct | 19th Oct - 16th Nov | 17th Nov - 16th Dec | 17th Dec - 14th Jan | 15th Jan - 13th Feb | 14th Feb - 14th Mar | 15th Mar - 13th Apr |
| `2022` | 1442 → 1443 | 14th Apr - 13th May | 14th May - 11th Jun | 12th Jun - 11th Jul | 12th Jul - 9th Aug | 10th Aug - 8th Sep | 9th Sep - 7th Oct | 8th Oct - 6th Nov | 7th Nov - 5th Dec | 6th Dec - 4th Jan | 5th Jan - 2nd Feb | 3rd Feb - 4th Mar | 5th Mar - 2nd Apr |
| `2023` | 1443 → 1444 | 3rd Apr - 2nd May | 3rd May - 31th May | 1st Jun - 30th Jun | 1st Jul - 30th Jul | 31th Jul - 28th Aug | 29th Aug - 27th Sep | 28th Sep - 26th Oct | 27th Oct - 25th Nov | 26th Nov - 25th Dec | 26th Dec - 23rd Jan | 24th Jan - 21th Feb | 22nd Feb - 23rd Mar |
| `2024` | 1444 → 1445 | 24 Mar - 21 Apr | 22 Apr - 21 May | 22 May - 19 Jun | 20 Jun - 19 Jul | 20 Jul - 17 Aug | 18 Aug - 16 Sep | 17 Sep - 16 Oct | 17 Oct - 15 Nov | 16 Nov - 14 Dec | 15 Dec - 13 Jan | 14 Jan - 11 Feb | 12 Feb - 11 Mar |

Keep spelling/formatting differences visible when reconciling; do not silently normalise historical sheet text.

## 4. Calculation model

### 4.1 Account month-end balances

Each account row holds that account's **balance at the end of each Islamic month**.

Rules:

- For each selected account and each Islamic month, calculate the account balance as of that Islamic month's end date.
- Do not use one assessment-date snapshot for the whole year.
- Liabilities are negative balances. The spreadsheet does not subtract liabilities separately; negative rows are included in the same `SUM` as assets.
- The yearly table has a `TOTAL` row per month. It is a plain sum of the included account rows for that month.

### 4.2 Minimum and maximum

For each year, calculate:

- `MINIMUM` = the minimum across the 12 monthly `TOTAL` values.
- `MAXIMUM` = the maximum across the 12 monthly `TOTAL` values.

The owner wants to see both values and choose which basis feeds the calculation. The trusted workbook formulas use the minimum as the zakat basis; maximum is mostly informational, but the app must support a selectable basis.

### 4.3 Gold

Gold price must be in the **currently selected currency**, not USD.

The owner needs to set a price per gram for each gold type / karat, effective on a specific date. Their sheet uses the price on **1st Ramaḍān** of that year.

Formula:

```text
gold value = sum of (grams for karat × price per gram for that karat on effective date)
```

The workbook uses 21k only for `2020`–`2024`. The known-wrong `2025` and `2026` layouts show started 21k and 22k rows; that is a useful layout clue only.

### 4.4 Zakat amount

The percentage must be editable and default to **2.5%**.

Formula:

```text
chosen basis = MINIMUM or MAXIMUM, selected by owner
TOTAL = chosen basis + gold value
ZAKAT = TOTAL × zakat percentage
Per Month = ZAKAT ÷ 12
```

In the workbook, the rate is hardcoded as `0.025` and `Per Month` always divides by `12`. The app must store the chosen percentage with each calculation.

### 4.5 Payments and carry-forward

Each year supports a payment list with:

- amount;
- person;
- location.

Formula:

```text
Past Remaining = carried balance from earlier years
Total To Pay = current ZAKAT + Past Remaining
Paid = sum of payments for this zakat year
Balance/Excess = Total To Pay - Paid
```

Interpretation:

- Positive `Balance/Excess` means still payable.
- Negative `Balance/Excess` means overpaid / excess carried forward.

The workbook carries past remaining manually; it does not reference the previous sheet. The app should make the annual run close to one action by carrying previous settings and unpaid/excess balance forward automatically, while making the carried value visible and editable.

## 5. Owner UI/UX requirements

The implementation must satisfy all of these requirements:

1. Use a **yearly view per Ramaḍān year**, labelled and mirroring the spreadsheet sub-sheets. Replace the current monthly-first view as the primary workflow.
2. Show all 12 Islamic months with their Gregorian date ranges.
3. Show each selected account's balance at the end of each Islamic month.
4. Show monthly `TOTAL` values, `MINIMUM`, and `MAXIMUM` across the year.
5. Provide a toggle/select control for which basis, minimum or maximum, feeds zakat.
6. Gold is priced in the selected currency, **not USD**.
7. Store per-karat price per gram effective on a date; default workflow should support pricing at 1st Ramaḍān.
8. Zakat percentage is editable, defaulting to 2.5%.
9. Nisab is dropped entirely.
10. Payment records include Person and Location.
11. Past Remaining, Total To Pay, Paid, and Balance/Excess are shown plainly.
12. Account picker shows all accounts sorted by current balance.
13. Account picker sorting uses **as-of-today balances**, not future-included balances.
14. Archived accounts are shown by default, with a toggle to hide them.
15. A selected account stays visible even when archived or hidden by the archived toggle.
16. Negative/liability accounts must be visibly negative; the app must not guess signs from names.
17. Export must produce the owner's `.xlsx` layout with real formulas, not only computed values.
18. The annual run should be near one action: start from previous year's settings, carry forward unpaid/excess balance, update date ranges/gold prices/accounts, then compute.
19. For `2025` and `2026`, compute fresh values from MizanTrack transaction data and state which account books/currencies have enough history. Do not output authoritative-looking partial figures if transactions do not go back far enough.

## 6. Workbook formulas extracted from `docs/Zakat - All.xlsx`

Formula cells were present in the workbook through the `xlsx` package's `.f` property; there was no need to unzip the workbook XML.

Only `2020`–`2024` are trusted as formula references. `2025` and `2026` are known-bad and intentionally excluded from reconciliation targets.

### 2020 formulas

Accounts included in monthly total: `Alfalah (Closed)`, `Meezan (Salary)`, `Meezan (Savings)`, `Meezan (Investment)`, `Cash`, `Piggy Bank (Savings)`, `Comety (Savings)`, `EasyPaisa`.

```text
B14:M14 = SUM(B5:B12) ... SUM(M5:M12)
O14 = MIN(B14:M14) -> 1,489,451.42
P14 = PRODUCT(P5,P6) -> 1,270,598.4
  P5 = 163.4 grams
  P6 = 7,776 per gram 21k
R14 = SUM(O14:Q14) -> 2,760,049.82
  Q14 is blank, so this is effectively MINIMUM + GOLD
S14 = PRODUCT(R14,0.025) -> 69,001.2455
T14 = S14/12 -> 5,750.103792
V14 = SUM(V2:V13) -> 69,000 paid
V16 = S14 - V14 -> 1.2455 remainder
```

Notes:

- No maximum formula exists in this sheet.
- Zakat basis used: minimum + gold.

### 2021 formulas

Accounts included in monthly total: `Meezan (Salary - F6)`, `Meezan (Savings - G11)`, `Meezan (Investment)`, `Loan (Huma Bajo)`, `Cash`, `Piggy Bank (Savings)`, `Comety (Savings)`, `EasyPaisa`, `5 Marla OS LSC`, `3.5 Marla Awami BWC`, `7 Marla OC BWC`.

```text
B16:M16 = SUM(B5:B15) ... SUM(M5:M15)
O16 = MIN(B16:M16) -> 2,262,020.98
P16 = MAX(B29:M29) -> 2,967,281.66
Q16 = PRODUCT(Q5,Q6) -> 1,436,972.04
  Q5 = 170.52 grams
  Q6 = 8,427 per gram 21k
S16 = SUM(O16,Q16) -> 3,698,993.02
T16 = PRODUCT(S16,0.025) -> 92,474.8255
U16 = T16/12 -> 7,706.235458
W16 = SUM(W2:W15) -> 87,965 paid
W17 = 1.25 manual last remaining
W18 = ROUNDUP((T16 - W16 + W17),0) -> 4,512 remainder
```

Notes:

- Zakat basis used: minimum + gold.
- `MAXIMUM` uses `B29:M29`, not `B16:M16`. Rows `25` and `29` add a separate properties/additions section, so minimum and maximum are not over identical ranges.

### 2022 formulas

Accounts included in monthly total: `Meezan (Salary - F6)`, `Meezan (Savings - G11)`, `Meezan (Investment)`, `SCB (PackageX - Salary)`, `SCB (Credit Card)`, `Loan <-- (Umer)`, `Loan <-- (Papa)`, `Loan --> (Others)`, `Cash`, `EasyPaisa`, `5 Marla OS LSC`, `3.5 Marla Awami BWC`, `7 Marla OC BWC`.

```text
Property rolling rows:
C15 = SUM(B15,C23), D15 = SUM(C15,D23), ...
C16 = SUM(B16,C24), D16 = SUM(C16,D24), ...
C17 = SUM(B17,C25), D17 = SUM(C17,D25), ...

B18:M18 = SUM(B5:B17) ... SUM(M5:M17)
O18 = MIN(B18:M18) -> 2,517,349.32
P18 = MAX(B30:M30) -> 4,441,044.84
Q18 = PRODUCT(Q5,Q6) -> 1,828,827
  Q5 = 170.52 grams
  Q6 = 10,725 per gram 21k
S18 = SUM(O18,Q18) -> 4,346,176.32
T18 = PRODUCT(S18,0.025) -> 108,654.408
U18 = T18/12 -> 9,054.534
W18 = SUM(W2:W17) -> 108,656 paid
W19 = 4,512 manual last remaining
W20 = ROUNDUP(((T18 - W18) + W19),0) -> 4,511 remainder
```

Notes:

- Zakat basis used: minimum + gold.
- `MAXIMUM` uses `B30:M30`, not `B18:M18`, again mixing in a separate additions section for maximum only.
- Rows `15`–`17` include rolling property balances that are also part of the monthly total.

### 2023 formulas

Accounts included in monthly total: `Meezan (Default)`, `Meezan (Savings)`, `Meezan (Investment)`, `Loan <-- (Papa)`, `Cash`, `Other Misc.`.

```text
B11:M11 = SUM(B5:B10) ... SUM(M5:M10)
O11 = MIN(B11:M11) -> 3,120,855.86
P11 = MAX(B11:M11) -> 5,347,793.46
Q11 = PRODUCT(Q5,Q6) -> 2,861,005.022
  Q5 = 170.52 grams
  Q6 = 16,778.12 per gram 21k
S11 = SUM(O11,Q11) -> 5,981,860.882
T11 = PRODUCT(S11,0.025) -> 149,546.5221
U11 = T11/12 -> 12,462.21017
W11 = SUM(W2:W9) -> 66,000 paid
W12 = 4,511 manual last remaining
W13 = ROUNDUP((T11 - W11 + W12),0) -> 88,058 remainder
```

Notes:

- Zakat basis used: minimum + gold.

### 2024 formulas

Accounts included in monthly total: `Meezan (Default)`, `Meezan (Savings)`, `Meezan (Investment)`, `Loan <-- (Papa)`, `Cash`.

```text
B10:M10 = SUM(B5:B9) ... SUM(M5:M9)
O10 = MIN(A10:M10) -> 2,628,184.68
  A10 contains text "TOTAL", so spreadsheet MIN ignores it; effectively MIN(B10:M10)
P10 = MAX(B10:M10) -> 3,370,369.84
Q10 = PRODUCT(Q5,Q6) -> 3,213,671.076
  Q5 = 170.52 grams
  Q6 = 18,846.3 per gram 21k
S10 = SUM(O10,Q10) -> 5,841,855.756
T10 = PRODUCT(S10,0.025) -> 146,046.3939
U10 = T10/12 -> 12,170.53283
W9 = 88,058 manual past remaining
W10 = SUM(W9,T10) -> 234,104.3939 total to pay
W11 = SUM(W2:W8) -> 285,500 paid
W12 = W10 - W11 -> -51,395.6061 balance/excess
```

Notes:

- Zakat basis used: minimum + gold.
- `MIN(A10:M10)` looks like a harmless range typo because `A10` is text and ignored by `MIN`.

## 7. Owner history summary, 2020–2024

| Sheet | Accounts included | Basis used by workbook | Minimum | Maximum | Gold input | Gold value | Rate | Zakat | Paid / balance |
| --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | --- |
| `2020` | Alfalah closed, Meezan salary/savings/investment, Cash, Piggy Bank, Comety, EasyPaisa | Minimum | 1,489,451.42 | not calculated | 163.4g × 7,776, 21k | 1,270,598.40 | 2.5% | 69,001.2455 | Paid 69,000; remainder 1.2455 |
| `2021` | Meezan salary/savings/investment, Huma Bajo loan, Cash, Piggy Bank, Comety, EasyPaisa, three property rows | Minimum | 2,262,020.98 | 2,967,281.66 | 170.52g × 8,427, 21k | 1,436,972.04 | 2.5% | 92,474.8255 | Paid 87,965; last remaining 1.25; remainder 4,512 |
| `2022` | Meezan salary/savings/investment, SCB salary/credit card, Umer loan, Papa loan, Others loan, Cash, EasyPaisa, three property rows | Minimum | 2,517,349.32 | 4,441,044.84 | 170.52g × 10,725, 21k | 1,828,827.00 | 2.5% | 108,654.408 | Paid 108,656; last remaining 4,512; remainder 4,511 |
| `2023` | Meezan default/savings/investment, Papa loan, Cash, Other Misc. | Minimum | 3,120,855.86 | 5,347,793.46 | 170.52g × 16,778.12, 21k | 2,861,005.022 | 2.5% | 149,546.5221 | Paid 66,000; last remaining 4,511; remainder 88,058 |
| `2024` | Meezan default/savings/investment, Papa loan, Cash | Minimum | 2,628,184.68 | 3,370,369.84 | 170.52g × 18,846.3, 21k | 3,213,671.076 | 2.5% | 146,046.3939 | Past remaining 88,058; paid 285,500; excess -51,395.6061 |

## 8. 2024 worked reconciliation target

Use this as the clearest regression example for implementation.

```text
MINIMUM 2,628,184.68 + GOLD 3,213,671.076 = TOTAL 5,841,855.756
GOLD = 170.52 g x 18,846.3 (21k, priced at 1st Ramaḍān)
ZAKAT = 5,841,855.756 x 2.5% = 146,046.3939   -> per month 12,170.53283
TOTAL TO PAY = 146,046.3939 + 88,058 past remaining = 234,104.3939
PAID 285,500 -> BALANCE/EXCESS = -51,395.6061 (overpaid)
```

Monthly totals for `2024`:

| Month | Total |
| --- | ---: |
| Ramaḍān | 2,896,066.15 |
| Shawwāl | 2,825,829.58 |
| Zū al-Qaʿdah | 2,628,184.68 |
| Zū al-Ḥijjah | 3,088,959.26 |
| al-Muḥarram | 3,370,369.84 |
| Ṣafar | 3,313,488.09 |
| Rabīʿ al-ʾAwwal | 3,308,746.12 |
| Rabīʿ ath-Thānī | 3,017,848.84 |
| Jumādā al-ʾAwwal | 3,042,484.54 |
| Jumādā ath-Thāniya | 3,048,899.44 |
| Rajab | 2,957,655.34 |
| Shaʿbān | 2,788,758.33 |

## 9. 2025 and 2026 are not references

Do not reconcile against the spreadsheet's `2025` or `2026` figures.

Allowed uses:

- observe sheet naming/layout convention;
- observe started account rows such as `Al Meezan MAICF`, `Kids (MCF)`, and `Loan <-- (Basit bhai)`;
- observe that the owner began adding 21k and 22k gold rows.

Forbidden uses:

- do not assert engine output against `2025` or `2026` spreadsheet figures;
- do not adjust code to match those figures;
- do not treat discrepancies in those years as bugs.

The implementation must compute `2025` and `2026` fresh from MizanTrack transaction data. The report should say these computed values supersede the spreadsheet.

The owner has both AED and PKR books. The AED book begins part-way through the history and the PKR book is older. For each year, state which books/currencies have data coverage. If data does not go back far enough, say the year cannot be fully computed; do not silently output zero or partial figures that look authoritative.

## 10. Known issues in the old implementation

- It used a single assessment-date snapshot and had no hawl / Islamic-year logic.
- It did not calculate the minimum wealth held across the full lunar year.
- Accounts were manually ticked as zakatable.
- Negative asset balances were silently excluded.
- Liabilities were deducted only when explicitly typed and selected.
- AED and PKR obligations were separate, with no FX model.
- Payments did not reduce any obligation and did not create transactions.
- The code embedded unstated jurisprudential choices: nisab, 85g gold standard, positive balances zakatable, and pure-gold valuation.
- `goldItems`, `zakatCalculations`, and `zakatPayments` are not covered by Firebase sync, so zakat data has no cloud backup.
- Islamic dates in the app may be approximate. The spreadsheet records exact Gregorian ranges; a wrong boundary shifts balances and changes zakat owed.

## 11. Export requirement

The export must produce the owner's exact `.xlsx` style layout, with real formulas in cells, not only cached numbers.

Minimum export requirements:

- one sheet per Ramaḍān year;
- accounts as rows;
- Islamic months as columns `B:M`;
- Gregorian ranges in the header;
- `TOTAL`, `MINIMUM`, `MAXIMUM`, `GOLD`, `TOTAL`, `ZAKAT`, `Per Month`, payment, `Past Remaining`, `Total To Pay`, `Paid`, and `Balance/Excess` fields;
- formulas equivalent to the owner's trusted workbook semantics;
- payments with Person and Location;
- enough visible inputs that the owner can audit or edit the workbook by hand.

## 12. Open questions for the owner

1. Papa loan sign: `ZAKAT-QUICK-START.md:218-229` says the owner **lent to Papa**; `zakat-enhancement-plan.md:185-186` says the owner **owes Papa**. These are opposite signs. The trusted `2024` sheet treats `Loan <-- (Papa)` as a negative liability. Confirm the intended sign and label for each year.
2. Basis default: should new years default to minimum, with maximum only as comparison, or remember the owner's last selected basis?
3. Payment date: the workbook records amount/person/location; should the app also require payment date?
4. Islamic month ranges: who is the authority for future exact Gregorian ranges, and should the owner be able to edit them manually?
5. Multi-currency: how should AED and PKR be combined for zakat if both are selected? Which FX date/rate should be used?
6. Gold inventory: should 21k/22k entries be entered as aggregate grams per karat, or itemised jewellery pieces that roll up to per-karat totals?
7. Properties/investments: `2021` and `2022` include property/addition sections with special formulas. Should those be modelled as normal accounts, a separate asset type, or left as historical spreadsheet-only rows?
8. Fresh 2025/2026 computation: are there any owner-approved manual corrections to apply before using MizanTrack transaction data as the source?
9. Carry-forward editing: should the app auto-carry the prior balance/excess but let the owner override it before finalising the year?

## 13. Start here tomorrow

Current state:

- This file is the single zakat starting point.
- `2020`–`2024` are the trusted history and test/reconciliation target.
- `2025` and `2026` spreadsheet figures are known-bad and must be computed fresh.
- Nisab is removed from scope.
- Old zakat data tables are not synced to Firebase.

What the implementation agent is building:

1. A yearly Ramaḍān → Shaʿbān zakat screen.
2. Exact Islamic month ranges and account month-end balances.
3. Minimum/maximum yearly totals with selectable basis.
4. Per-karat gold valuation in selected currency on an effective date.
5. Editable zakat percentage defaulting to 2.5%.
6. Payments and carry-forward that affect Total To Pay / Balance-Excess.
7. Fresh computed 2025 and 2026 results from real MizanTrack data.
8. `.xlsx` export matching the owner's workbook layout and formulas.

First decisions needed from the owner:

1. Confirm Papa loan sign and label.
2. Confirm minimum/default basis behaviour.
3. Confirm multi-currency FX rule.
4. Confirm source/editing process for Islamic date ranges.
5. Confirm whether payments need dates.
