# Zakat requirements — October 2026

This is the authoritative zakat specification for MizanTrack as of October 2026. It records the owner's stated requirements and the model used in `docs/Zakat - All.xlsx`.

Older zakat documents are historical only where they disagree with this file.

## Source of truth

- Workbook: `docs/Zakat - All.xlsx`.
- The workbook has 7 sheets: `2020`, `2021`, `2022`, `2023`, `2024`, `2025`, `2026`.
- Each sheet is one zakat year running **Ramaḍān → Shaʿbān**, not January → December.
- The owner calculated `2020`–`2024` by hand. `2025` and `2026` are not yet final and may contain errors that MizanTrack should help find.
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

For example, the `2025` sheet carries the `2024` overpayment as `Past Remaining = -51,395.61`.

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
6. Confirm whether 2025 and 2026 should be treated as draft sheets to reconcile against MizanTrack, not as final expected results.

