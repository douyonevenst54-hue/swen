# Clinical safety

Swen is a **decision-support and record-keeping tool**. It does not diagnose
and does not replace clinical judgment. Before any pilot with real patients,
the facility's clinical lead must review and sign off on the points below.

## 1. The score

Default rules: the Modified Early Warning Score from Subbe et al., *QJM* 2001;
94:521–526.

| | 3 | 2 | 1 | 0 | 1 | 2 | 3 |
|---|---|---|---|---|---|---|---|
| Systolic BP (mmHg) | ≤70 | 71–80 | 81–100 | 101–199 | | ≥200 | |
| Heart rate (bpm) | | ≤40 | 41–50 | 51–100 | 101–110 | 111–129 | ≥130 |
| Resp. rate (/min) | | <9 | | 9–14 | 15–20 | 21–29 | ≥30 |
| Temperature (°C) | | <35 | | 35–38.4 | | ≥38.5 | |
| AVPU | | | | Alert | Voice | Pain | Unresponsive |

Default response levels (all configurable per facility):

| Level | When | Default re-check | Shown to the nurse |
|---|---|---|---|
| Low | total 0–2 | 4 h | Routine monitoring |
| Medium | total 3–4 | 1 h | Increase monitoring |
| High | total ≥ 5, **or any single parameter scoring 3** | 15 min | URGENT: call the doctor now |

Decimals fall on the correct side of each limit (34.95 °C counts as "below 35").

Also shown, without changing the score:

- **SpO₂ below 90%** (configurable) — oxygen per protocol and inform the doctor.
  It is not part of classic MEWS, so it does not add points, but it **raises
  the level to at least medium**: it never reads as "routine".
- **Incomplete set** — missing signs score 0, so an incomplete low score is
  shown as "Not all signs recorded — score may be too low", never as routine.
- **Patients under 16 or pregnant** — MEWS is not validated; the app says to
  use a pediatric (PEWS) or obstetric (MEOWS) score instead.

**To review:** whether these thresholds and response times match your
protocol and your staffing. Change them in the dashboard
(**Administration → MEWS score rules**). Every device picks up the change on
its next sync. The server always recomputes the score with the current rules;
the score a device showed is kept alongside for audit.

## 2. Safeguards in data entry

- **Impossible values are blocked** (e.g. HR 1200, temperature 98.6 entered as
  °C, diastolic ≥ systolic).
- **Extreme but possible values** (e.g. HR 210, SpO₂ 65) need a tick-box:
  "I measured again and the values are correct".
- Commas and dots are both accepted as decimal separators.
- Values from Bluetooth devices are marked as such.
- Corrections never overwrite: a correction is a new record that replaces the
  old one on screen; the original stays in the audit trail.

## 3. Escalation loop

Any medium or high score opens a screen asking **what the nurse did**
(informed nurse in charge, called the doctor, doctor reviewed, …). It can be
postponed but not hidden: the ward list and the dashboard flag every medium or
high score with no recorded action, and every patient overdue for a re-check.

## 4. Traceability

Every reading records **who** took it (staff), **on which tablet**, **with which
instrument**, and whether the nurse **scanned the patient's wristband**.

- **Wristbands** (Dashboard → QR labels → patient wristbands): before saving
  vitals the app asks to scan the wristband. A wristband belonging to another
  patient shows *SE PA BON PASYAN AN* with that patient's name and blocks saving.
  Scanning is encouraged, not forced, so a missing printer never stops care; the
  dashboard shows what share of readings were scanned.
- **Instruments** (Administration → Measuring equipment): give each oximeter,
  BP monitor and thermometer an asset tag. When a device is found faulty, open
  **Traceability**, pick the instrument, and see every patient it measured.
- **Staff badges** let a nurse pick their name by scanning; the PIN is still required.

## 5. Language

All clinical wording exists in Haitian Creole, French and English
(`packages/core/src/i18n`). **Have Haitian nurses review the Kreyòl
wording** before the pilot, especially the AVPU descriptions and the alert
messages. An automated test checks that every message exists in all three
languages with the same placeholders.

## 6. What the system cannot do

- It cannot know about a patient whose vitals were never entered.
- A device that is offline cannot alert anyone else; the alert is on that
  device only until it syncs.
- The tablet clock is corrected from the server on every sync, but a device
  that has never synced uses its own clock.
- MEWS is a population tool: a normal score does not mean a patient is safe.

## 7. Before the pilot — checklist

- [ ] Clinical lead has reviewed the thresholds and response times.
- [ ] Nurses have reviewed the Kreyòl and French wording.
- [ ] Escalation actions match the facility's real call chain.
- [ ] Staff trained: entering vitals, corrections, escalation, what to do
      when the tablet is dead (paper fallback).
- [ ] Wristbands printed for admitted patients and asset tags on every instrument.
- [ ] A paper chart remains the legal record until the facility decides otherwise.
- [ ] Ethics / institutional approval if outcomes will be studied or published.
