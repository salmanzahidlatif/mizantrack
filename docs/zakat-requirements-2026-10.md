# Zakat requirements — October 2026

This is the authoritative zakat specification for MizanTrack as of October 2026. It records the owner's stated requirements and the model used in `docs/Zakat - All.xlsx`.

Older zakat documents are historical only where they disagree with this file.

## Source of truth

- Workbook: `docs/Zakat - All.xlsx`.
- The workbook has 7 sheets: `2020`, `2021`, `2022`, `2023`, `2024`, `2025`, `2026`.
- Each sheet is one zakat year running **Ramaḍān → Shaʿbān**, not January → December.
- The owner calculated `2020`–`2024` by hand. These are the trusted historical evidence for the model, although the owner may still want to find mistakes in them.
- **The `2025` and `2026` sheets are known to be wrong.** The owner said: **"2025 and 2026 are never calculated properly and have wrong data tbh"**. Do not reconcile against their figures, do not learn the calculation model from them, and do not change the engine to reproduce them.
- `2025` and `2026` may still be read for layout, sheet naming, started account rows, and started gold rows only. Their calculated figures are not a reference.
- The owner has said: **"Current zakat functionality is not what I need."**

## Non-goals and explicit exclusions

- **Nisab has been dropped at the owner's instruction.** The owner said to **"forget about the nisab etc."**
- The calculation must not be gated by a nisab threshold.
- Do not reintroduce gold nisab, silver nisab, `isLiable`, or any threshold-based "zakat due / not due" decision unless the owner explicitly asks for it later.
- Do not invent additional jurisprudential rules. Where the owner has not decided something, treat it as an open question.

## Year model

The UI must provide a **yearly view per Ramaḍān year**, mirroring the workbook sub-sheets. The current monthly-first view is not useful enough for the owner.

Each year view must show the 12 Islamic months in this order:

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

The Hijri year rolls over in the middle of this zakat year at **al-Muḥarram**. For example, the workbook's `2024` sheet shows 1444 for Ramaḍān → Zū al-Ḥijjah, then 1445 from al-Muḥarram onwards.

Each Islamic month must have its Gregorian date range recorded and visible, as in the spreadsheet. For the verified `2024` sheet:

| Month | Gregorian range |
| --- | --- |
| Ramaḍān | 24 Mar - 21 Apr |
| Shawwāl | 22 Apr - 21 May |
| Zū al-Qaʿdah | 22 May - 19 Jun |
| Zū al-Ḥijjah | 20 Jun - 19 Jul |
| al-Muḥarram | 20 Jul - 17 Aug |
| Ṣafar | 18 Aug - 16 Sep |
| Rabīʿ al-ʾAwwal | 17 Sep - 16 Oct |
| Rabīʿ ath-Thānī | 17 Oct - 15 Nov |
| Jumādā al-ʾAwwal | 16 Nov - 14 Dec |
| Jumādā ath-Thāniya | 15 Dec - 13 Jan |
| Rajab | 14 Jan - 11 Feb |
| Shaʿbān | 12 Feb - 11 Mar |

Islamic date boundaries matter. A wrong Gregorian boundary shifts transactions into the wrong month and can change the zakat owed. The existing app may use approximate Islamic dates; that is not sufficient for final reconciliation unless the dates can be verified or corrected.

## Account balances

Each account row holds that account's **balance at the end of each Islamic month**.

Rules:

- For each selected account and each Islamic month, calculate the balance as of that Islamic month's end date.
- Do not use a single assessment-date snapshot for the whole year.
- Do not include future-dated transactions when calculating today's balances for selection and sorting.
- Liabilities are represented as negative balances in the sheet. For example, the verified `2024` sheet includes `Loan <-- (Papa)` as `-1,504,362.12` in every month.
- The year view must show a `TOTAL` row for each month by summing the selected account rows, including negative liabilities.

## Minimum and maximum basis

For every zakat year, calculate both:

- **MINIMUM**: the minimum of the 12 monthly `TOTAL` values.
- **MAXIMUM**: the maximum of the 12 monthly `TOTAL` values.

The UI must show both values and provide a toggle to choose which basis feeds the calculation.

The workbook's completed sheets use the minimum basis for the verified reconciliation example. The selected basis must be visible and saved with the calculation so later reviews can see whether the owner used minimum or maximum.

## Gold valuation

Gold must be valued in the **currently selected currency**, not USD.

The owner needs to enter a **price per gram for each gold type / karat** such as 21k, 22k, and so on. Each price must be effective on a specific date. The workbook uses the gold price on **1st Ramaḍān** of that year.

Rules:

- Store gold weight by karat.
- Store price per gram by karat and effective date.
- Calculate gold as `grams × price per gram` for each karat, then sum the karat totals.
- Use the price in the selected currency.
- Do not convert everything through USD unless the owner explicitly asks for that.

For the verified `2024` sheet:

```text
GOLD = 170.52 g x 18,846.3 per gram 21k
     = 3,213,671.076
```

## Zakat calculation

The percentage must be editable and default to **2.5%**.

Formula:

```text
chosen basis = MINIMUM or MAXIMUM, selected by the owner
TOTAL = chosen basis + GOLD
ZAKAT = TOTAL × zakat percentage
Per Month = ZAKAT ÷ 12
```

The formula is not gated by nisab.

## Workbook formulas are authoritative

The workbook was inspected for actual Excel formulas, not only cached values. Formula cells were present in `docs/Zakat - All.xlsx`; there was no need to unzip the workbook XML.

The implementation must reproduce the semantics of the trusted `2020`–`2024` formulas. Reconciliation tests must cover **2020–2024 only** and should state in their names/comments that `2025` and `2026` are excluded because the owner says those spreadsheet years are known-bad.

The app is expected to compute `2025` and `2026` correctly from MizanTrack transaction data, replacing the bad spreadsheet figures. Reports should state plainly when `2025`/`2026` values are computed fresh and supersede the spreadsheet. The computation must also state which account books and currencies actually have transaction coverage for each year. The owner's AED book begins part-way through the history, while the PKR book is older; if the underlying transactions do not go back far enough for a year, the app must say the year cannot be fully computed rather than silently showing zero or an authoritative-looking partial figure.

### Trusted formula summary by sheet: 2020–2024 only

| Sheet | Monthly `TOTAL` row | `MINIMUM` | `MAXIMUM` | `GOLD` | Zakat base `TOTAL` | `ZAKAT` | `Per Month` | Payment / carry-forward formula |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `2020` | `B14:M14 = SUM(B5:B12)` | `O14 = MIN(B14:M14)` | No maximum formula in this sheet | `P14 = PRODUCT(P5,P6)` where `P5 = 163.4 grams`, `P6 = 7,776 per gram 21k` | `R14 = SUM(O14:Q14)`, effectively `MINIMUM + GOLD` because `Q14` is blank | `S14 = PRODUCT(R14,0.025)` | `T14 = S14/12` | `V14 = SUM(V2:V13)` paid; `V16 = S14 - V14` remainder |
| `2021` | `B16:M16 = SUM(B5:B15)` | `O16 = MIN(B16:M16)` | `P16 = MAX(B29:M29)` | `Q16 = PRODUCT(Q5,Q6)` where `Q5 = 170.52 grams`, `Q6 = 8,427 per gram 21k` | `S16 = SUM(O16,Q16)`, so zakat uses `MINIMUM + GOLD`, not `MAXIMUM` | `T16 = PRODUCT(S16,0.025)` | `U16 = T16/12` | `W16 = SUM(W2:W15)` paid; `W17 = 1.25` manual last remaining; `W18 = ROUNDUP((T16 - W16 + W17),0)` |
| `2022` | `B18:M18 = SUM(B5:B17)` | `O18 = MIN(B18:M18)` | `P18 = MAX(B30:M30)` | `Q18 = PRODUCT(Q5,Q6)` where `Q5 = 170.52 grams`, `Q6 = 10,725 per gram 21k` | `S18 = SUM(O18,Q18)`, so zakat uses `MINIMUM + GOLD`, not `MAXIMUM` | `T18 = PRODUCT(S18,0.025)` | `U18 = T18/12` | `W18 = SUM(W2:W17)` paid; `W19 = 4,512` manual last remaining; `W20 = ROUNDUP(((T18 - W18) + W19),0)` |
| `2023` | `B11:M11 = SUM(B5:B10)` | `O11 = MIN(B11:M11)` | `P11 = MAX(B11:M11)` | `Q11 = PRODUCT(Q5,Q6)` where `Q5 = 170.52 grams`, `Q6 = 16,778.12 per gram 21k` | `S11 = SUM(O11,Q11)`, so zakat uses `MINIMUM + GOLD`, not `MAXIMUM` | `T11 = PRODUCT(S11,0.025)` | `U11 = T11/12` | `W11 = SUM(W2:W9)` paid; `W12 = 4,511` manual last remaining; `W13 = ROUNDUP((T11 - W11 + W12),0)` |
| `2024` | `B10:M10 = SUM(B5:B9)` | `O10 = MIN(A10:M10)`; `A10` is text, so this behaves like `MIN(B10:M10)` | `P10 = MAX(B10:M10)` | `Q10 = PRODUCT(Q5,Q6)` where `Q5 = 170.52 grams`, `Q6 = 18,846.3 per gram 21k` | `S10 = SUM(O10,Q10)`, so zakat uses `MINIMUM + GOLD`, not `MAXIMUM` | `T10 = PRODUCT(S10,0.025)` | `U10 = T10/12` | `W9 = 88,058` manual past remaining; `W10 = SUM(W9,T10)` total to pay; `W11 = SUM(W2:W8)` paid; `W12 = W10 - W11` |

### Formula findings

1. **The monthly `TOTAL` row is a plain `SUM` over contiguous account rows.** The sheets do not subtract liabilities in a separate formula. Negative balances, such as `Loan <-- (Papa)`, are included in the same `SUM` and therefore reduce the total by their sign.
2. **The zakat base uses `MINIMUM + GOLD` in every sheet that has a full calculation.** `MAXIMUM` is present from `2021` onwards but does not feed zakat in the workbook formulas.
3. **The rate is hardcoded as `0.025` in every yearly formula.** There is no editable rate cell in the workbook. MizanTrack must make the rate editable, defaulting to 2.5%, and store the chosen rate with each calculation.
4. **`Per Month` always divides by `12`.**
5. **Past remaining values are manual numbers, not cross-sheet references.** The workbook carries balances forward by typing the prior result into the next sheet, sometimes rounded.
6. **Payment totals are plain sums of the paid-amount column.** Person and location are descriptive fields and do not affect arithmetic.

### Formula inconsistencies and likely review points

These are part of the owner's workbook as found and must be preserved for reconciliation/audit rather than silently corrected:

- `2020` has no `MAXIMUM` formula.
- `2020` uses `R14 = SUM(O14:Q14)` for the zakat base. Because `Q14` is blank, this is effectively `MINIMUM + GOLD`, but the range is broader than necessary.
- `2021` calculates `MINIMUM` from `B16:M16`, but `MAXIMUM` from `B29:M29`. Rows `25` and `29` add a separate property/additions section, so the minimum and maximum are not calculated over the same base.
- `2022` similarly calculates `MINIMUM` from `B18:M18`, but `MAXIMUM` from `B30:M30`. This again mixes in a separate property/additions section for maximum only.
- In `2022`, property rows `15`–`17` contain rolling formulas such as `C15 = SUM(B15,C23)`, then the main `TOTAL` row includes those property balances. Rows `27` and `30` separately total/add property additions again for the maximum-only range.
- `2024` uses `O10 = MIN(A10:M10)`. `A10` contains the text label `TOTAL`, so spreadsheet `MIN` ignores it and the result matches `MIN(B10:M10)`. This looks like a harmless range typo but should be noted.
- `2025` and `2026` are intentionally excluded from the trusted formula list. They have known-bad data and must not be used as reconciliation targets.

### Untrusted layout observations from 2025 and 2026

These observations are useful only for UI/layout and for understanding what the owner had started to enter. They are not reference calculations:

- `2025` and `2026` keep the same broad sheet layout: Islamic months in `B:M`, summary fields in `O:U`, and payments in `W:Y`.
- They show two started gold karats, combining 21k and 22k rows by summing two `grams × price-per-gram` products.
- They include started account rows such as `Al Meezan MAICF`, `Kids (MCF)`, and in `2026` `Loan <-- (Basit bhai)`.
- Do not treat any mismatch against `2025` or `2026` as an engine bug. Those years must be computed afresh from MizanTrack data.

## Payments and carry-forward

Each zakat year must support a payment list with:

- amount
- person
- location

The workbook then calculates:

```text
Past Remaining = carried balance from earlier years
Total To Pay = current ZAKAT + Past Remaining
Paid = sum of payments for this zakat year
Balance/Excess = Total To Pay - Paid
```

Interpretation:

- Positive `Balance/Excess` means still payable.
- Negative `Balance/Excess` means overpaid / excess carried forward.

For example, the untrusted `2025` sheet appears to carry the `2024` overpayment as `Past Remaining = -51,395.61`. This is a layout/carry-forward clue only; the `2025` calculation itself is not a reference.

## Account picker requirements

The zakatable account picker must:

- show **all accounts**, sorted by current balance;
- use **as-of-today balances**, not future-included balances;
- show archived accounts by default;
- provide a toggle to hide archived accounts;
- keep a selected account visible even when it is archived or hidden by the archived toggle;
- make negative/liability accounts clear, without guessing the owner's intended sign.

The primary purpose is to reproduce the spreadsheet model from MizanTrack account data so the owner can verify and correct past years. Being slightly off is acceptable if the difference is visible and useful for finding mistakes.

## 2024 reconciliation example

The `2024` workbook sheet has been verified and should be used as a regression example for future implementation.

```text
MINIMUM 2,628,184.68 + GOLD 3,213,671.076 = TOTAL 5,841,855.756
GOLD = 170.52 g x 18,846.3 (21k, priced at 1st Ramaḍān)
ZAKAT = 5,841,855.756 x 2.5% = 146,046.3939   -> per month 12,170.53283
TOTAL TO PAY = 146,046.3939 + 88,058 past remaining = 234,104.3939
PAID 285,500 -> BALANCE/EXCESS = -51,395.6061 (overpaid)
```

The `2024` monthly account totals are:

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

Therefore:

- `MINIMUM = 2,628,184.68`
- `MAXIMUM = 3,370,369.84`

## Known implementation and documentation issues found in the October 2026 audit

These must not be lost:

1. The implemented calculation used a single assessment-date snapshot and had **no hawl / Islamic-year logic**. That contradicts the owner's own documented rule that zakat is due on the **minimum wealth held across the full lunar year**.
2. `docs/ZAKAT-QUICK-START.md` around lines 218-229 contradicts `docs/zakat-enhancement-plan.md` around lines 185-186 on the Papa loan. The enhancement plan says the owner **owes Papa** and treats it as a liability. The quick-start says **Papa owes you / you lent to Papa** and treats it as an asset. These are opposite signs. This is an open question for the owner; do not guess from the old docs.
3. `goldItems`, `zakatCalculations`, and `zakatPayments` are **not covered by Firebase sync**, so zakat data has no cloud backup.
4. Islamic dates in the app may be approximate. The spreadsheet records exact Gregorian ranges per Islamic month; a wrong boundary shifts balances and changes the zakat owed.

## Open questions for the owner

1. Confirm the intended sign and wording for the Papa loan in all years. The verified `2024` sheet treats `Loan <-- (Papa)` as a negative liability, but older docs contradict each other.
2. Confirm whether the minimum basis should be the default for every new year, with maximum only as an optional comparison, or whether the app should remember the last selected basis.
3. Confirm whether payment records need a payment date in addition to amount, person, and location. The workbook records amount/person/location; the app may still benefit from dates.
4. Confirm how manually corrected Islamic month date ranges should be sourced and stored for future years.
5. Confirm how multi-currency account balances should be converted into the selected currency for zakat years, if accounts exist in more than one currency.
6. Confirm whether there are any owner-approved manual corrections to apply before computing fresh `2025` and `2026` figures from MizanTrack transaction data.
