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

### How month ranges are produced now

The hardcoded year table is gone. `src/lib/zakatCalendar.ts` generates every zakat year from two independent inputs:

- **Month shapes** come from the Umm al-Qura calendar through the built-in `Intl.DateTimeFormat("en-u-ca-islamic-umalqura")`. No dependency was added. These lengths reproduce the trusted `2020`–`2024` sheets month for month.
- **Anchors** — the first day of Ramaḍān — cannot be computed. Pakistan's Ruet-e-Hilal committee announces them after an actual sighting. Pakistan usually falls one day after the Umm al-Qura date, but not always: AH1443 ran two days later and AH1444 landed on the same day. Resolution order is therefore **manual override → announced Pakistan date → umalqura + 1 day** for years not yet announced.

Announced Pakistan 1 Ramaḍān dates currently in use (`PAKISTAN_RAMADAN_STARTS`):

| Hijri year | 1 Ramaḍān (Pakistan) |
| --- | --- |
| 1440 | 2019-05-07 |
| 1441 | 2020-04-25 |
| 1442 | 2021-04-14 |
| 1443 | 2022-04-04 |
| 1444 | 2023-03-23 |
| 1445 | 2024-03-12 |
| 1446 | 2025-03-02 |

Only the anchor and its provenance (`announced`, `manual`, or `computed`) are persisted, in the `zakatYears` table added at schema v12. The twelve months are always recomputed from the anchor, so a stored year can never hold stale boundaries.

The generated window runs from **AH1440**, the owner's earliest records, to five years ahead of the current zakat year.

**AH1445 and AH1446 month boundaries changed deliberately.** Their previously stored months were a placeholder 30/29 alternation rather than real lunar months, which is consistent with this document already treating the `2025` and `2026` sheets as untrusted. AH1440–1444 are pinned by `src/test/zakatCalendar.test.ts` to their exact previous boundaries, so the trusted years cannot move.

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

### 4.3b Silver

Added at the owner's request, October 2026: *"a simple section for silver, just its value and weight, simple values per zakat year, included in the total zakatable value to calculate the final rate."*

Silver is **one weight at one price per gram, per zakat year**. It is deliberately NOT itemised the way gold is — no pieces, no purity, no lineage, no sold tracking — because the owner keeps it as a single line he retypes each year. Both figures live on the same per-year record as that year's gold prices (`ZakatGoldYear`), and are priced on that year's existing `priceDate`; there is no second date.

The weight is always required: a price with no weight contributes nothing, and the screen says so rather than silently assessing zero.

Formula:

```text
silver value = silver grams × silver price per gram
```

A year that recorded no silver contributes **exactly zero**, so every year settled before silver existed reproduces its figures unchanged.

### 4.4 Zakat amount

The percentage must be editable and default to **2.5%**.

Formula:

```text
chosen basis = MINIMUM or MAXIMUM, selected by owner
TOTAL = chosen basis + gold value + silver value
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
- ~~`goldItems`, `zakatCalculations`, and `zakatPayments` are not covered by Firebase sync, so zakat data has no cloud backup.~~ **Fixed.** All three are registered in `CORE_SYNC_TABLES` in `src/lib/db/sync.ts`, alongside `zakatYears` (the calendar anchor table added at schema v12). Zakat data now pushes and pulls like every other table, and `src/test/zakatYearSync.test.ts` covers push, pull and tombstone propagation for the anchors.
- ~~Islamic dates in the app may be approximate.~~ **Fixed.** Month boundaries are generated from the Umm al-Qura calendar and anchored on the announced Pakistan 1 Ramaḍān; see "How month ranges are produced now" in section 3. The trusted AH1440–1444 boundaries are pinned by regression tests.

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

## 12. Owner decisions (previously open questions)

All nine questions below have been answered by the owner. They are decisions now, not questions; implement to them.

1. **Papa loan sign — the owner OWES Papa.** `Loan <-- (Papa)` is a **liability**: a negative balance that reduces zakatable wealth, exactly as the trusted `2024` sheet treats it. `ZAKAT-QUICK-START.md` previously implied the owner had lent *to* Papa; that guide has been corrected. `zakat-enhancement-plan.md` was already right. The same shape applies to `Loan <-- (Basit bhai)` in reverse: that one is money lent out, so it stays an asset.
2. **Basis default — always MINIMUM.** A new year opens on the minimum basis. The maximum is shown for comparison only and is never the default; the owner may still switch a year to it deliberately. Do not remember or restore a previous year's basis selection.
3. **Payment date — optional.** No date is preselected, and past dates must be accepted. The owner records payments after the fact, so forcing today's date falsifies the record.
4. **Islamic month ranges — generated, anchored, overridable.** See "How month ranges are produced now" in section 3: Umm al-Qura month lengths, announced Pakistan 1 Ramaḍān anchors, and a manual override that wins over both. Only the anchor is stored; the months are always recomputed.
5. **Multi-currency — AED and PKR stay completely separate.** One zakat result per currency, never combined. No FX rate is stored and none is applied. A currency's zakat is computed from that currency's accounts and gold only.
6. **Gold inventory — itemised pieces that roll up to per-karat totals, PER YEAR.** The owner enters individual pieces; grams are summed per karat. Value is `grams × price per gram for that karat` in the selected currency, priced on an effective date (typically 1 Ramaḍān). No pure-gold conversion in the calculation model. Holdings drift piece by piece — "I did not sell all 168.4 g of 21k, instead I sold an item of 10 g from it and bought 14 g of 22k instead" — so each zakat year owns its own list: a year opened for the first time inherits the previous year's, after which editing one year never reaches another, and a piece keeps one identity across every year it was held in.
7. **Properties/investments — historical spreadsheet rows only.** The `2021` and `2022` property and addition sections stay as history. They are not modelled as accounts and no new asset type is introduced for them.
8. **Fresh 2025/2026 — computed, then reviewed.** Both years are computed fresh from MizanTrack data and then reviewed by the owner before being finalised. No manual corrections are pre-applied to the source data.
9. **Carry-forward editing — auto-carry, overridable.** The previous year's balance/excess carries forward automatically into `Past Remaining`, stays visible, and can be overridden by the owner before the year is finalised.

## 13. Current status

Verified against the code at commit `839d243`. Another agent is actively working on the zakat screen, so the UI gaps below may close sooner than this file is updated; the engine, export and calendar facts are test-backed.

### Settled

- This file is the single zakat starting point.
- `2020`–`2024` are the trusted history and reconciliation target; `2025` and `2026` spreadsheet figures remain known-bad.
- Nisab is out of scope.
- The nine decisions in section 12 are no longer open.

### Built and covered by tests

1. **Generated zakat calendar** — `src/lib/zakatCalendar.ts` derives all twelve months from Umm al-Qura lengths and an announced or overridden Ramaḍān anchor. `src/lib/islamicCalendar.ts` is now a thin re-export over it and holds no dates of its own. AH1440–1444 boundaries are pinned verbatim in `src/test/zakatCalendar.test.ts`.
2. **Anchor persistence and sync** — `zakatYears` (schema v12) stores the anchor and its provenance; `src/lib/zakatYearRepository.ts` saves, lists and resets overrides, and `src/test/zakatYearSync.test.ts` covers push, pull and tombstones. `goldItems`, `zakatCalculations` and `zakatPayments` are synced too.
3. **Yearly grid engine** — `computeZakatYearGrid` in `src/lib/zakatEngine.ts` produces per-account month-end balances, monthly `TOTAL`s, `MINIMUM`, `MAXIMUM`, gold at grams × per-karat price, the editable rate, `Per Month`, `Past Remaining`, `Total To Pay`, `Paid` and `Balance/Excess`. Liabilities enter the same sum as negatives rather than being excluded.
4. **Reconciliation against the owner's own numbers** — `src/test/zakatReconciliation.test.ts` reproduces the `2024` worked example in section 8 end to end, including the overpayment, and checks that switching to the maximum basis actually changes the result.
5. **`.xlsx` export with live formulas** — `src/lib/zakatExport.ts` writes one sheet per Ramaḍān year with real `SUM`/`MIN`/`MAX`/`PRODUCT` formulas chaining TOTAL → MINIMUM/MAXIMUM → GOLD/SILVER → ZAKAT → Total To Pay → Balance/Excess, payments with Person and Location, and no currency conversion anywhere. Covered by `src/test/zakatExport.test.ts`, including a write/read round trip that proves the formulas survive.
6. **Year selection and calendar control in the UI** — `ZakatYearCalendarControl.tsx` shows the anchor, its source, and lets the owner override or reset it; the monthly view renders the twelve months with their Gregorian ranges and month-end balances.

### Still outstanding

The gap is concentrated in the screen, not the engine. The calculator tab has not yet been moved onto the yearly grid, so several decisions above are implemented in `zakatEngine`/`zakatExport` but not yet reachable from the UI:

1. **Nisab is still live in the calculator tab.** `ZakatPageClientEnhanced.tsx` still computes a gold/silver nisab threshold and an `isLiable` flag, and refuses to save a calculation below it. Section 2 says nisab is dropped; this is the largest remaining contradiction.
2. **Basis is not selectable on screen.** The export call hardcodes `basis: "minimum"` and the monthly view surfaces only the minimum. The engine and workbook already support both.
3. **Carry-forward is not wired.** The export passes `pastRemaining: 0`; nothing carries the previous year's balance/excess forward or offers it for editing (decision 9).
4. **Gold pricing is still pure-weight.** The screen derives each karat's price by scaling one gold price through a purity factor, instead of letting the owner enter an editable price per gram per karat as decision 6 and section 4.3 require.
5. **The zakat rate is not editable in the UI.** It is a `2.5` constant, and the calculator tab multiplies by a hardcoded `0.025`.
6. **The monthly view still converts currencies and drops signs.** `ZakatMonthlyBalances.tsx` applies an exchange rate and skips negative asset balances and positive liability balances. Decision 5 forbids conversion, and section 4.1 requires negative rows to stay inside the same sum.
7. **Payment dates are still mandatory and preselected to today**, against decision 3.
8. **`2025` and `2026` have not been computed fresh**, and the per-currency data-coverage statement required by section 9 has not been produced.
9. **Legacy tests still assert nisab behaviour** (`src/test/zakat.test.ts`), so removing nisab will need that coverage retired alongside it.
