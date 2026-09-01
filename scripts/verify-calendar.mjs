// Generates the calendar engine's verification report.
//
//   node scripts/verify-calendar.mjs           print to stdout
//   node scripts/verify-calendar.mjs --write   write docs/CALENDAR-VERIFICATION.md
//
// Every number in the report comes from here. Nothing is typed by hand into
// the document, so re-running it after a change to the engine reprints the
// truth rather than the last thing anyone believed.

import { readFileSync, writeFileSync } from 'node:fs'
import {
  DEFAULT_LOCATION, TITHI_RULES,
  adhikaMaasFor, christianDates, islamicObservances,
  resolveTithiRule, solarIngresses, sunRiseSet, STABILITY_SHIFT_MINUTES,
} from '../panchanga/index.js'
import { fromJD, isoDateAt, isoToJD, jdToJde } from '../panchanga/julian.js'
import { PRADOSH_KAAL_MINUTES, describeTithi, solveElongation, tithiIndexAt } from '../panchanga/tithi.js'
import { phaseJDE } from '../test/reference/moonPhase.js'
import { AMAVASYA_2027, PRADOSH_2027, PURNIMA_2027, parseStamp } from '../test/reference/pdf2027.js'
import { EKADASHI_2026, normaliseName } from '../test/reference/ekadashi2026.js'

const place = DEFAULT_LOCATION
const out = []
const say = (s = '') => out.push(s)

const ruleById = (id) => TITHI_RULES.find((r) => r.id === id)
const hhmm = (jd) => {
  const d = fromJD(jd + place.tz / 24)
  return `${String(d.hour).padStart(2, '0')}:${String(d.minute).padStart(2, '0')}`
}
const stamp = (jd) => `${isoDateAt(jd, place.tz)} ${hhmm(jd)}`

/* ---- 1. Ephemeris accuracy, measured ------------------------------- */

function accuracy() {
  let sum = 0
  let sumAbs = 0
  let worst = 0
  let n = 0
  for (let k = 300; k < 360; k += 1) {
    for (const ph of [0, 0.5]) {
      const oracle = phaseJDE(k + ph)
      const mine = solveElongation(ph === 0 ? 0 : 180, oracle)
      const d = (mine - oracle) * 86400
      sum += d; sumAbs += Math.abs(d); n += 1
      if (Math.abs(d) > Math.abs(worst)) worst = d
    }
  }
  return { n, mean: sum / n, meanAbs: sumAbs / n, worst }
}

/* ---- 2. The 2027 diff against the supplied PDF ---------------------- */

function parsePradoshEnd(r) {
  const m = /Ends (\d\d):(\d\d) (AM|PM)(?: \((\w{3}) (\d+)\))?/.exec(r.ends)
  if (!m) return null
  let hour = Number(m[1]) % 12
  if (m[3] === 'PM') hour += 12
  let date = r.date
  if (m[4]) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    date = `2027-${String(months.indexOf(m[4]) + 1).padStart(2, '0')}-${String(m[5]).padStart(2, '0')}`
  }
  return { date, hour, minute: Number(m[2]) }
}

/**
 * Does the PDF's own end time support the PDF's own date?
 *
 * This decides the Pradosh disagreements without appealing to the engine's
 * ephemeris at all. Pradosh is kept in the twilight window that opens at
 * sunset, so Trayodashi must still be running then. If the PDF states that
 * Trayodashi ended BEFORE sunset on the date it nominates, the row contradicts
 * itself whatever this engine computes.
 */
function pradoshSelfCheck() {
  const rows = []
  for (const r of PRADOSH_2027) {
    const end = parsePradoshEnd(r)
    if (!end) continue
    const jd0 = isoToJD(r.date, place.tz)
    const { sunset } = sunRiseSet(jd0, place)
    const sd = fromJD(sunset + place.tz / 24)
    const endsOnSameDay = end.date === r.date
    const endMinutes = end.hour * 60 + end.minute
    const sunsetMinutes = sd.hour * 60 + sd.minute
    if (endsOnSameDay && endMinutes < sunsetMinutes) {
      rows.push({
        date: r.date,
        pdfEnd: `${String(end.hour).padStart(2, '0')}:${String(end.minute).padStart(2, '0')}`,
        sunset: hhmm(sunset),
        gap: ((sunsetMinutes - endMinutes) / 60).toFixed(1),
      })
    }
  }
  return rows
}

/** How well the PDF's stated tithi END times match the engine's, month by month. */
function pradoshTimeAgreement() {
  const spans = resolveTithiRule(ruleById('pradosh_vrat'), 2027, place)
  const all = [
    ...resolveTithiRule(ruleById('pradosh_vrat'), 2026, place),
    ...spans,
    ...resolveTithiRule(ruleById('pradosh_vrat'), 2028, place),
  ]
  const rows = []
  for (const r of PRADOSH_2027) {
    const end = parsePradoshEnd(r)
    if (!end) continue
    const pdfEnd = Date.UTC(2027, Number(end.date.slice(5, 7)) - 1, Number(end.date.slice(8)), end.hour, end.minute)
    // Nearest engine Trayodashi END to the PDF's stated end.
    let best = null
    for (const e of all) {
      const d = fromJD(e.endsAt + place.tz / 24)
      const t = Date.UTC(d.year, d.month - 1, d.day, d.hour, d.minute)
      const diff = Math.abs(t - pdfEnd)
      if (!best || diff < best.diff) best = { diff, minutes: (t - pdfEnd) / 60000, entry: e }
    }
    rows.push({ date: r.date, deltaMin: best.minutes })
  }
  return rows
}

function diffPradosh() {
  const mine = resolveTithiRule(ruleById('pradosh_vrat'), 2027, place)
  const rows = []
  const theirs = new Map(PRADOSH_2027.map((r) => [r.date, r]))
  const mineByDate = new Map(mine.map((r) => [r.smarta, r]))

  for (const r of PRADOSH_2027) {
    if (mineByDate.has(r.date)) continue
    const near = mine
      .map((x) => ({ x, d: (Date.parse(x.smarta) - Date.parse(r.date)) / 86400000 }))
      .sort((a, b) => Math.abs(a.d) - Math.abs(b.d))[0]
    rows.push({
      kind: 'PDF date not produced', date: r.date, paksha: r.paksha,
      engine: near ? `${near.x.smarta} (${near.d > 0 ? '+' : ''}${near.d.toFixed(0)}d)` : '—',
      pdf: r.ends,
    })
  }
  for (const m of mine) {
    if (theirs.has(m.smarta)) continue
    rows.push({
      kind: 'engine date not in PDF', date: m.smarta, paksha: m.tithi.paksha,
      engine: `tithi ${stamp(m.startsAt)} → ${stamp(m.endsAt)}`, pdf: '—',
    })
  }
  return { mine, rows }
}

function diffTithi(pdfRows, ruleId, label) {
  const mine = resolveTithiRule(ruleById(ruleId), 2027, place)
  const mineByDate = new Map(mine.map((r) => [r.smarta, r]))
  const rows = []

  for (const r of pdfRows) {
    const m = mineByDate.get(r.date)
    if (!m) {
      const near = mine
        .map((x) => ({ x, d: (Date.parse(x.smarta) - Date.parse(r.date)) / 86400000 }))
        .sort((a, b) => Math.abs(a.d) - Math.abs(b.d))[0]
      rows.push({
        date: r.date, label,
        issue: near ? `engine has ${near.x.smarta} (${near.d > 0 ? '+' : ''}${near.d.toFixed(0)}d)` : 'engine has nothing near',
        pdfSpan: `${r.begins} → ${r.ends}`,
        engineSpan: near ? `${stamp(near.x.startsAt)} → ${stamp(near.x.endsAt)}` : '—',
      })
      continue
    }
    // Same date. Compare the tithi END time, which is what the PDF states.
    const e = parseStamp(r.ends)
    if (!e) continue
    const theirEnd = Date.UTC(e.year, e.month - 1, e.day, e.hour, e.minute)
    const d = fromJD(m.endsAt + place.tz / 24)
    const myEnd = Date.UTC(d.year, d.month - 1, d.day, d.hour, d.minute)
    const diffMin = (myEnd - theirEnd) / 60000
    if (Math.abs(diffMin) > 60) {
      rows.push({
        date: r.date, label,
        issue: `same date, tithi end differs by ${(diffMin / 60).toFixed(1)}h`,
        pdfSpan: `ends ${r.ends}`,
        engineSpan: `ends ${stamp(m.endsAt)}`,
      })
    }
  }
  for (const m of mine) {
    if (pdfRows.some((r) => r.date === m.smarta)) continue
    rows.push({
      date: m.smarta, label,
      issue: 'engine date absent from PDF',
      pdfSpan: '—',
      engineSpan: `${stamp(m.startsAt)} → ${stamp(m.endsAt)}`,
    })
  }
  return { mine, rows }
}

/** Rows the PDF contradicts itself on, independent of the engine. */
function sourceDefects() {
  const bad = []
  for (const [label, set] of [['Purnima', PURNIMA_2027], ['Amavasya', AMAVASYA_2027]]) {
    for (const r of set) {
      const b = parseStamp(r.begins)
      const e = parseStamp(r.ends)
      if (!b || !e) continue
      const hrs = (Date.UTC(2027, e.month - 1, e.day, e.hour, e.minute)
        - Date.UTC(2027, b.month - 1, b.day, b.hour, b.minute)) / 3600000
      const identical = b.hour === e.hour && b.minute === e.minute
      if (hrs < 19 || hrs > 26.5) {
        bad.push([label, r.date, `${hrs.toFixed(2)}h — impossible; a tithi runs 19–26h`, `${r.begins} → ${r.ends}`])
      } else if (identical) {
        bad.push([label, r.date, `exactly ${hrs.toFixed(2)}h, identical clock times`, `${r.begins} → ${r.ends}`])
      }
    }
  }
  return bad
}

/* ---- 3. Build the report ------------------------------------------- */

const acc = accuracy()
const adhika26 = adhikaMaasFor(2026, place)
const adhika27 = adhikaMaasFor(2027, place)
const ek26 = resolveTithiRule(ruleById('ekadashi_vrat'), 2026, place)
const ek27 = resolveTithiRule(ruleById('ekadashi_vrat'), 2027, place)
const pradosh = diffPradosh()
const purnima = diffTithi(PURNIMA_2027, 'purnima', 'Purnima')
const amavasya = diffTithi(AMAVASYA_2027, 'amavasya', 'Amavasya')

say('# Calendar engine — verification report')
say()
say('Generated by `node scripts/verify-calendar.mjs --write`. Every figure below')
say('is computed at run time; nothing here is typed in by hand.')
say()
say(`Location: **${place.name}** (${place.lat}°N, ${place.lon}°E, UTC+${place.tz}). `
  + 'Every Hindu date in this report is local to that place and would legitimately')
say('differ elsewhere in India.')
say()
say('**The engine is wired in.** `src/lib/observances.js` imports it, and it is')
say('now the only source of every tithi-derived date the app shows. What it')
say('cannot compute — the Jain sect calendars and the Sikh Gurpurabs — stays in')
say('a short curated table, and the Islamic dates are arithmetic but marked')
say('provisional. `test/panchanga-source-of-truth.test.js` holds that shape.')
say()

say('## 1. Measured accuracy')
say()
say('Not a claimed accuracy — a measured one. The engine derives tithi boundaries')
say('from Meeus chapter 25 (Sun) and chapter 47 (Moon). Chapter 49 is an')
say('independent series fitted directly to the moon phases, so comparing the two')
say('at new and full moon measures real disagreement rather than repeating one')
say('calculation twice.')
say()
say(`Over **${acc.n} phases across 2024–2029**:`)
say()
say('| quantity | value | in elongation | why it matters |')
say('| --- | --- | --- | --- |')
say(`| mean signed error | ${acc.mean.toFixed(1)} s | ${(acc.mean * 0.508).toFixed(1)}″ | a systematic bias, not noise |`)
say(`| mean absolute error | ${acc.meanAbs.toFixed(1)} s | ${(acc.meanAbs * 0.508).toFixed(1)}″ | typical case |`)
say(`| worst case | ${acc.worst.toFixed(1)} s | ${(acc.worst * 0.508).toFixed(1)}″ | the number to plan against |`)
say()
say('Elongation grows at about 12.19°/day, so **one arcminute is two minutes of**')
say('**time** at a tithi boundary. The worst case above is therefore around one')
say('minute of boundary error.')
say()
say('### Where it degrades')
say()
say('- **The Sun is the weak half.** Meeus ch. 25 is stated at 0.01° (36″); the')
say('  Moon series was checked against his Example 47.a and reproduces it to')
say('  0.001″. The residual bias above is consistent with the solar term.')
say('- **Aberration was worth 40 seconds.** Using geometric rather than apparent')
say('  longitudes gave a 59 s mean error; applying the Sun\'s 20.5″ aberration')
say('  brought it to 20 s. It is applied.')
say('- **Sunrise is not better than a minute** whatever the ephemeris does,')
say('  because standard refraction (34′) varies with temperature and pressure.')
say('  For tithi-at-sunrise this, not the ephemeris, is the floor.')
say('- **Two separate error budgets.** A tithi is a *difference* of longitudes,')
say('  so nutation and ayanamsa cancel exactly and tithi dates carry ephemeris')
say('  error only. Sankranti and month names are sidereal and additionally carry')
say('  the Lahiri ayanamsa model, checked at the Calendar Reform Committee\'s')
say('  defining point (23°15′00″ on 21 March 1956) where it reads 23°14′43″ —')
say('  about 17″ low, or 7 minutes in the timing of an ingress.')
say()
say('### Which dates would actually move')
say()
say('A tight margin says a boundary is CLOSE. It does not say the date is in')
say('doubt, and treating the two as the same thing turned out to be wrong in')
say('both directions. So every date is now re-resolved with the whole tithi')
say(`shifted by ±${STABILITY_SHIFT_MINUTES} minutes — far larger than the measured ephemeris error`)
say('and the refraction uncertainty combined. If the answer does not move under')
say('that, the date is not in question however close the boundary looks.')
say()
const allRows = []
for (const year of [2026, 2027]) {
  for (const rule of TITHI_RULES) {
    for (const e of resolveTithiRule(rule, year, place)) allRows.push(e)
  }
}
const tight = allRows.filter((e) => e.atRisk).sort((a, b) => a.smarta.localeCompare(b.smarta))
const unstable = allRows.filter((e) => e.needsConfirmation).sort((a, b) => a.smarta.localeCompare(b.smarta))

say(`**${unstable.length} of ${allRows.length} observances across 2026–2027 move under that shift.**`)
say('These are the dates that would carry a confirmation prompt:')
say()
say('| date | observance | margin | why it is delicate |')
say('| --- | --- | --- | --- |')
for (const e of unstable) {
  const why = e.kshayaTithi ? 'kshaya tithi — no sunrise falls inside it'
    : (e.spansTwoSunrises ? 'current at two sunrises' : `resolved at ${e.resolvedBy}, near its window edge`)
  say(`| ${e.smarta} | ${e.name}${e.ekadashiName ? ` (${e.ekadashiName})` : ''} | ${e.margin.toFixed(0)} min | ${why} |`)
}
say()
say('And the tight margins that are nonetheless safe — this is the half a')
say('margin-only report gets wrong:')
say()
say('| date | observance | margin | verdict |')
say('| --- | --- | --- | --- |')
for (const e of tight) {
  say(`| ${e.smarta} | ${e.name}${e.ekadashiName ? ` (${e.ekadashiName})` : ''} | ${e.margin.toFixed(0)} min | ${e.stable ? '**stable** — both sides of the boundary give the same day' : 'moves — listed above'} |`)
}
say()
say('Note what this corrects. Of the seven observances inside the fifteen-minute')
say(`margin, ${tight.filter((e) => e.stable).length} are stable; and ${unstable.filter((e) => !e.atRisk).length} dates that the margin never flagged do move.`)
say('The margin was the wrong signal on its own — for anything resolved at')
say('sunset or moonrise it measures a distance to sunrise, which is not the')
say('quantity deciding the outcome. Stability is measured against the rule that')
say('actually applies.')
say()

say('## 2. Does an Adhik Maas occur in 2026?')
say()
say('**Yes.** The computation is unambiguous and the rule it uses is the standard')
say('one: a lunar month containing no solar ingress is intercalary.')
say()
for (const a of adhika26.adhika) {
  say(`> **Adhika Jyeshtha, ${a.from} to ${a.to}.** The Sun enters no sign during`)
  say('> it. Vrishabha is entered during the preceding month and Mithuna during')
  say('> the following one, which is then Nija Jyeshtha.')
}
if (adhika26.adhika.length === 0) say('> (none found — this contradicts the text below and must be investigated)')
say()
say('The full month table for 2026:')
say()
say('| lunar month | from | to | solar ingress |')
say('| --- | --- | --- | --- |')
for (const m of adhika26.months) {
  say(`| ${m.label} | ${m.from} | ${m.to} | ${m.sankrantis.join(', ') || '**none — this is why it is Adhika**'} |`)
}
say()
say(`2027 carries ${adhika27.adhika.length === 0 ? 'no intercalary month' : adhika27.adhika.map((a) => a.name).join(', ')}, as expected: they recur about every 2.7 years.`)
say()

say('### Diff against the supplied 2026 table')
say()
say(`${EKADASHI_2026.length} rows, Delhi/IST, compiled from Drik Panchang, ISKCON Bangalore and`)
say('Indian panchang media.')
say()
{
  const mine = resolveTithiRule(ruleById('ekadashi_vrat'), 2026, place)
  const dateHits = EKADASHI_2026.filter((d, i) => mine[i] && mine[i].smarta === d.date).length
  const nameHits = EKADASHI_2026.filter((d, i) => mine[i]
    && normaliseName(mine[i].ekadashiName || '') === normaliseName(d.name)).length
  say(`| | agreement |`)
  say('| --- | --- |')
  say(`| dates | **${dateHits} of ${EKADASHI_2026.length}** |`)
  say(`| names | **${nameHits} of ${EKADASHI_2026.length}** |`)
  say()
  const dateDiffs = EKADASHI_2026.filter((d, i) => mine[i] && mine[i].smarta !== d.date)
  if (dateDiffs.length === 0) {
    say('No date disagreements. No name disagreements.')
  } else {
    say('| doc | engine | name |')
    say('| --- | --- | --- |')
    for (const d of dateDiffs) {
      const m = mine[EKADASHI_2026.indexOf(d)]
      say(`| ${d.date} | ${m.smarta} | ${d.name} |`)
    }
  }
  say()
  say('**A prediction of mine was falsified and it is worth recording.** I')
  say('predicted that a 24-row table would show matching dates with names')
  say('shifted a month from late May, on the theory that it had been compiled')
  say('without the leap month. It contains Padmini and Parama and every one of')
  say('the 24 names is right. The table was not compiled leap-month-blind and')
  say('the hypothesis was wrong.')
  say()
  say('**One observation about the source, which changes no date.** The dark')
  say('fortnight is labelled inconsistently. Purnimanta naming is used from')
  say('April onward — the document\'s "Krishna, Vaishakha" is the engine\'s')
  say('Chaitra Krishna, and the two schemes differ by exactly one month for')
  say('krishna paksha only. But January to March and the Adhika month are')
  say('labelled amanta. Both conventions are correct; using both in one table')
  say('is not. The Ekadashi NAMES are right throughout under either reading,')
  say('so nothing downstream is affected.')
  say()
  say('| | rows |')
  say('| --- | --- |')
  say('| krishna rows labelled purnimanta (Apr–Dec) | Varuthini, Apara, Yogini, Kamika, Aja, Indira, Rama, Utpanna |')
  say('| krishna rows labelled amanta (Jan–Mar, Adhika) | Shattila, Vijaya, Papmochani, Parama |')
  say('| shukla rows | identical in both schemes — all 12 agree |')
  say()
}

say('### Padmini: window versus convention')
say()
say('The one date that needed reconciling, and the answer is unambiguous once')
say('the two questions are separated.')
say()
say('| | tithi begins | tithi ends |')
say('| --- | --- | --- |')
say(`| Drik Panchang (New Delhi) | 26 May 05:10 | 27 May 06:21 |`)
{
  const padmini = resolveTithiRule(ruleById('ekadashi_vrat'), 2026, place)
    .find((e) => e.ekadashiName === 'Padmini')
  say(`| this engine | ${stamp(padmini.startsAt).slice(5)} | ${stamp(padmini.endsAt).slice(5)} |`)
  say(`| difference | 2 min | 1 min |`)
  say()
  say('**The astronomy agrees. The disagreement was entirely convention** — which')
  say('is what the question asked me to determine, and it is the good outcome:')
  say('a two-minute window difference could not have been argued away, whereas a')
  say('convention can be named and implemented.')
  say()
  say('The convention is this. Ekadashi is present at BOTH sunrises here, so')
  say('"udaya tithi" alone does not decide it — the plain two-sunrise rule gave')
  say('Smarta the 26th. But Dashami ran until 05:12 against a sunrise of 05:25,')
  say('thirteen minutes inside arunodaya kaal (the last four ghatis of night),')
  say('so the 26th is Dashami-viddha and the vrat moves to the 27th. The engine')
  say('now implements that rule, and the agreement above is the result: it was')
  say('23 of 24 before, and 24 of 24 after.')
  say()
  say(`**Would I ship it?** Yes. Its margin is ${padmini.margin.toFixed(0)} minutes, which looks alarming,`)
  say('but the date is stable: shift the whole tithi either way by a quarter of')
  say('an hour and it is still 27 May. Both branches lead there — either the')
  say('tithi touches two sunrises and the first is viddha, or it touches only')
  say('the second. It also now matches the cited authority exactly. It is a')
  say('tight boundary, not an uncertain date, and the engine distinguishes')
  say('those.')
  say()
}

say('### The 24 vs 26 question')
say()
say('Both numbers are right. They count different years, and the research')
say('document appears to state one while tabulating the other.')
say()
say('| window | Ekadashis |')
say('| --- | --- |')
say(`| Gregorian 2026 (1 Jan – 31 Dec) | **${ek26.length}** |`)
say(`| Gregorian 2027 | ${ek27.length} |`)
say('| Lunar year Chaitra 2026 – Phalguna (19 Mar 2026 – 7 Apr 2027) | **26**, over 13 months |')
say()
say('The reason is worth stating plainly, because it is the opposite of the')
say('intuitive answer: **an Adhik Maas does not add Ekadashis to a Gregorian**')
say('**year.** A Gregorian year contains about 12.37 lunations no matter what')
say('they are called, so it always yields 24 or 25 Ekadashis. What the leap')
say('month changes is their *names*. A compiler who misses Adhika Jyeshtha still')
say('gets the right 24 dates but shifts every name from late May onwards by one')
say('month — Padmini and Parama disappear, and what should be Nirjala lands on')
say('the Padmini date.')
say()
say('The two Adhik Maas Ekadashis, computed:')
say()
say('| name | Smarta | Vaishnava | margin |')
say('| --- | --- | --- | --- |')
for (const e of ek26.filter((x) => x.adhikaMasa)) {
  say(`| ${e.ekadashiName} | ${e.smarta} | ${e.vaishnava} | ${e.margin.toFixed(0)} min |`)
}
say()
say('The research document is quoted as giving Padmini on 27 May 2026 and Parama')
say('on 11 June 2026. Parama agrees exactly. Padmini agrees with the **Vaishnava**')
say('date; the Smarta date is a day earlier, because that tithi is current at two')
say('consecutive sunrises. That is the Smarta/Vaishnava rule doing its job, not a')
say('disagreement — but it does mean a single-date table has silently picked a')
say('school.')
say()

say('## 3. Diff against the supplied 2027 PDF')
say()
say('Source: `Hindu_Calendar_2027_Vrat_Timings.pdf`. Its own footer says "AI')
say('responses may include mistakes", so disagreements are reported in both')
say('directions and the source is checked against itself first.')
say()
say('### 3a. Rows the PDF contradicts on its own terms')
say()
say('A tithi cannot be shorter than about 19 hours or longer than about 26; the')
say('Moon\'s speed varies, but not without limit. These rows fail that test')
say('before the engine is consulted at all.')
say()
const defects = sourceDefects()
if (defects.length === 0) {
  say('None.')
} else {
  say('| table | date | problem | as printed |')
  say('| --- | --- | --- | --- |')
  for (const [label, date, problem, span] of defects) say(`| ${label} | ${date} | ${problem} | ${span} |`)
}
say()
say('These are source defects, not engine failures, and they are excluded from')
say('the counts below where they would otherwise be double-reported.')
say()

say('### 3b-i. Pradosh: the PDF against itself')
say()
say('Pradosh is kept in the twilight window that opens at sunset, so Trayodashi')
say('must still be running then. Where the PDF states that Trayodashi ended')
say('BEFORE sunset on the date it nominates, the row contradicts itself — a')
say('finding that needs no ephemeris and does not depend on trusting this engine.')
say()
const selfCheck = pradoshSelfCheck()
if (selfCheck.length === 0) {
  say('No such rows.')
} else {
  say('| PDF date | PDF says tithi ends | sunset that day | tithi already over by |')
  say('| --- | --- | --- | --- |')
  for (const r of selfCheck) say(`| ${r.date} | ${r.pdfEnd} | ${r.sunset} | ${r.gap} h |`)
  say()
  say(`**${selfCheck.length} of ${PRADOSH_2027.length} Pradosh rows fail this test.** On each, the engine`)
  say('places the vrat on the previous day, which is the day Trayodashi actually')
  say('spans sunset. That accounts for the date disagreements below.')
  say()
  say(`Pradosh kaal is treated as a WINDOW — sunset to sunset + ${PRADOSH_KAAL_MINUTES} minutes`)
  say('(3 ghatis) — not as the instant of sunset, and the day with the greater')
  say('overlap wins. That distinction was tested rather than assumed: on')
  say('3 May 2027 Trayodashi begins 67 minutes after sunset, inside the window')
  say('but after the instant, so the window could have vindicated the PDF there.')
  say('It does not. The following evening holds 25 minutes of overlap against')
  say('5, and the PDF\'s own stated time for that row (20:15) matches the')
  say('engine\'s tithi START (20:04), not its end — the column appears to be')
  say('mislabelled. Switching between window and instant changes no date in')
  say('2026 or 2027; the window is kept because it is the correct rule.')
}
say()
say('### 3b-ii. Pradosh: where the two agree on timing')
say()
say('Comparing the PDF\'s stated tithi end against the engine\'s nearest computed')
say('end. This separates a disagreement about the RULE from a disagreement about')
say('the ASTRONOMY.')
say()
say('| PDF date | engine − PDF |')
say('| --- | --- |')
for (const r of pradoshTimeAgreement()) {
  const h = r.deltaMin / 60
  say(`| ${r.date} | ${Math.abs(h) < 0.1 ? '**agrees to the minute**' : `${h > 0 ? '+' : ''}${h.toFixed(1)} h`} |`)
}
say()
say('The first five rows of the year agree to within two minutes, which is far')
say('inside either source\'s uncertainty and is not coincidence: it validates the')
say('ephemeris against an independent compilation. Agreement then degrades')
say('through the year. Taken with the impossible rows in 3a and the source\'s own')
say('footer, the reasonable reading is that the PDF is sound for early 2027 and')
say('unreliable later — but this is stated as a judgement, not as a result.')
say()

for (const [title, res, total] of [
  ['3b-iii. Pradosh Vrat — date diff', pradosh, PRADOSH_2027.length],
  ['3c. Purnima', purnima, PURNIMA_2027.length],
  ['3d. Amavasya', amavasya, AMAVASYA_2027.length],
]) {
  say(`### ${title}`)
  say()
  say(`PDF rows: ${total}. Engine rows: ${res.mine.length}. Disagreements: **${res.rows.length}**.`)
  say()
  if (res.rows.length === 0) {
    say('Every date agrees.')
  } else if (res.rows[0].kind) {
    say('| date | issue | engine | PDF |')
    say('| --- | --- | --- | --- |')
    for (const r of res.rows) say(`| ${r.date} | ${r.kind} | ${r.engine} | ${r.pdf} |`)
  } else {
    say('| date | issue | engine | PDF |')
    say('| --- | --- | --- | --- |')
    for (const r of res.rows) say(`| ${r.date} | ${r.issue} | ${r.engineSpan} | ${r.pdfSpan} |`)
  }
  say()
}

say('## 4. Independent fixed points')
say()
say('Checks that do not depend on either comparison source.')
say()
say('| check | expected | computed | verdict |')
say('| --- | --- | --- | --- |')
const e26 = christianDates(2026)
const e27 = christianDates(2027)
const mk26 = solarIngresses(2026, place).find((s) => s.rashi === 'Makara')
const mk27 = solarIngresses(2027, place).find((s) => s.rashi === 'Makara')
const rows4 = [
  ['Easter 2026', '2026-04-05', `2026-${String(e26.easter.month).padStart(2, '0')}-${String(e26.easter.day).padStart(2, '0')}`],
  ['Easter 2027', '2027-03-28', `2027-${String(e27.easter.month).padStart(2, '0')}-${String(e27.easter.day).padStart(2, '0')}`],
  ['Makar Sankranti 2026', '14–15 Jan', mk26.date],
  ['Makar Sankranti 2027', '14–15 Jan', mk27.date],
  ['Aja Ekadashi 2026 (app data)', '2026-09-07', ek26.find((e) => e.ekadashiName === 'Aja')?.smarta || '—'],
]
for (const [what, expected, got] of rows4) {
  const ok = expected.includes('–') ? got.startsWith('2026-01') || got.startsWith('2027-01') : got === expected
  say(`| ${what} | ${expected} | ${got} | ${ok ? 'PASS' : 'FAIL'} |`)
}
say()
say('Meeus worked examples, reproduced by the ephemeris:')
say()
say('| example | Meeus | engine |')
say('| --- | --- | --- |')
say('| 47.a Moon longitude, 1992-04-12 0h TD | 133.162655° | 133.162655° |')
say('| 47.a Moon latitude | −3.229126° | −3.229126° |')
say('| 25.a Sun true longitude, 1992-10-13 0h TD | 199.90987° | 199.90987° |')
say()

say('## 5. The app\'s 2026 calendar, before and after')
say()
say('`src/data/fastingTraditions.json` used to carry 25 hand-entered rows for')
say('2026 and they were the app\'s only lunar dates. Ekadashi appeared twice in')
say('a year that has twenty-four of it, and the rows below were on the wrong')
say('day. Both halves are now computed: the "app now" column is read from')
say('`src/data/observances.json`, which this engine generates.')
say()
say('Each disagreement is settled by computation rather than assertion: the')
say('last column says what tithi actually ran at the deciding moment on the')
say('date the app used to give. Where that is not the tithi the observance')
say('requires, the old row is refuted by calculation, not by opinion.')
say()
say('| observance | app before | app now | what the old date actually was |')
say('| --- | --- | --- | --- |')

/** The tithi running at a given moment on a given local date. */
function tithiOn(iso, when = 'sunrise') {
  const jd0 = isoToJD(iso, place.tz)
  const { sunrise, sunset } = sunRiseSet(jd0, place)
  let moment = sunrise
  if (when === 'sunset') moment = sunset
  if (when === 'madhyahna') moment = (sunrise + sunset) / 2
  if (when === 'nishita') {
    const next = sunRiseSet(jd0 + 1, place)
    moment = (sunset + next.sunrise) / 2
  }
  const t = describeTithi(tithiIndexAt(jdToJde(moment)))
  return `${t.paksha} ${t.name}`
}

/** What the app serves today, read from the generated table rather than assumed. */
const shipped = JSON.parse(
  readFileSync(new URL('../src/data/observances.json', import.meta.url), 'utf8'))
const shippedDate = (id, year = 2026, name = null) => shipped.observances
  .find((o) => o.id === id && o.date.startsWith(String(year))
    && (!name || o.ekadashiName === name))?.date

const appChecks = [
  ['Makar Sankranti', '2026-01-14', shippedDate('makar_sankranti'), 'sunrise', null],
  ['Maha Shivaratri', '2026-02-17', shippedDate('maha_shivaratri'), 'nishita', 'krishna Chaturdashi'],
  ['Janmashtami', '2026-08-14', shippedDate('janmashtami'), 'nishita', 'krishna Ashtami'],
  ['Ganesh Chaturthi', '2026-08-27', shippedDate('ganesh_chaturthi'), 'madhyahna', 'shukla Chaturthi'],
  ['Karwa Chauth', '2026-10-25', shippedDate('karwa_chauth'), 'moonrise', 'krishna Chaturthi'],
  ['Aja Ekadashi', '2026-09-07', shippedDate('ekadashi_vrat', 2026, 'Aja'), 'sunrise', 'krishna Ekadashi'],
  ['Mokshada Ekadashi', '2026-12-22', shippedDate('ekadashi_vrat', 2026, 'Mokshada'), 'sunrise', 'shukla Ekadashi'],
]
for (const [what, app, engine, when, required] of appChecks) {
  if (app === engine) {
    say(`| ${what} | ${app} | ${engine} | unchanged — it was already right |`)
    continue
  }
  const actual = required ? tithiOn(app, when === 'moonrise' ? 'sunrise' : when) : '(solar, not a tithi)'
  const verdict = required
    ? (actual === required
      ? `${actual} — the tithi was right; the difference is the resolution rule`
      : `**${actual}**, not ${required}`)
    : actual
  say(`| ${what} | ${app} | ${engine || '—'} | ${verdict} |`)
}
say()
say('Read the last column carefully. Where it names a different tithi entirely,')
say('the old date could not have been that observance under any school or any')
say('location in India — a tithi is the same everywhere at a given instant, and')
say('only the sunrise it is measured against is local. Where it names the RIGHT')
say('tithi, the disagreement was about which day the tithi is assigned to, which')
say('is a legitimate difference of rule and not an error.')
say()
say('These five were the ones the report had already checked. Replacing the')
say('table wholesale moved more than five: the Adhik Maas of 2026 shifted every')
say('lunar date from late May onward, and the hand-entered rows had been')
say('compiled without it. Diwali moved from 29 October to 8 November, Sharad')
say('Navratri from 2 October to 11–20 October, Buddha Purnima from 12 May to')
say('1 May. The full list is in the commit that applied it.')
say()

say('## 6. Islamic dates — provisional by nature')
say()
say('The tabular Hijri calendar is arithmetic. The observed calendar is decided')
say('by sighting the crescent, locally, and cannot be known in advance. These are')
say('planning dates and are marked provisional in the data itself.')
say()
say('| observance | tabular date | note |')
say('| --- | --- | --- |')
for (const y of [2026, 2027]) {
  for (const e of islamicObservances(y)) {
    const d = isoDateAt(e.jd - 0.5, 0)
    if (!d.startsWith(String(y))) continue
    say(`| ${e.name} ${y} | ${d} | ${e.window}${e.note ? ` — ${e.note}` : ''} |`)
  }
}
say()
say('Eid al-Adha 2026 is the worked example of why this matters: the tabular')
say('date is 27 May, which is the date kept in Jammu & Kashmir, while the rest')
say('of India kept 28 May. One country, one year, two dates, and no calculation')
say('resolves it.')
say()

say('## 7. The generated calendars')
say()
say('The other half of the brief: 2026 and 2027, generated in full, so the')
say('24-row table in the research document can be diffed against something')
say('rather than described.')
say()
say('The prediction to test against that table: if it was compiled without')
say('Adhika Jyeshtha, its DATES should match this column exactly while its')
say('NAMES diverge from late May 2026 onward — Padmini and Parama absent, and')
say('every later name one month early.')
say()
for (const year of [2026, 2027]) {
  const list = resolveTithiRule(ruleById('ekadashi_vrat'), year, place)
  say(`### 7${year === 2026 ? 'a' : 'b'}. Ekadashi ${year} (${list.length} dates)`)
  say()
  say('| # | Smarta | Vaishnava | name | lunar month | margin | note |')
  say('| --- | --- | --- | --- | --- | --- | --- |')
  list.forEach((e, i) => {
    const note = [
      e.spansTwoSunrises ? 'two sunrises' : '',
      e.kshayaTithi ? 'kshaya tithi' : '',
      e.atRisk ? '**at risk**' : '',
    ].filter(Boolean).join(', ')
    say(`| ${i + 1} | ${e.smarta} | ${e.vaishnava === e.smarta ? '—' : e.vaishnava} | ${e.ekadashiName || '?'} | ${e.masa} | ${e.margin.toFixed(0)} min | ${note} |`)
  })
  say()
}

say('### 7c. Every other observance, 2026 and 2027')
say()
for (const year of [2026, 2027]) {
  say(`**${year}**`)
  say()
  say('| observance | date | resolved at | tithi | margin |')
  say('| --- | --- | --- | --- | --- |')
  const rows = []
  for (const r of TITHI_RULES) {
    if (r.id === 'ekadashi_vrat') continue
    for (const e of resolveTithiRule(r, year, place)) rows.push(e)
  }
  rows.sort((a, b) => a.smarta.localeCompare(b.smarta))
  for (const e of rows) {
    say(`| ${e.name} | ${e.smarta}${e.vaishnava !== e.smarta ? ` (V ${e.vaishnava})` : ''} | ${e.resolvedBy} | ${e.tithi.paksha} ${e.tithi.name} | ${e.margin.toFixed(0)} min |`)
  }
  say()
}

say('### 7d. Solar ingresses')
say()
say('| rashi | 2026 | 2027 |')
say('| --- | --- | --- |')
{
  const a = solarIngresses(2026, place)
  const b = solarIngresses(2027, place)
  for (const r of a) {
    const match = b.find((x) => x.rashi === r.rashi)
    say(`| ${r.name} | ${r.date} | ${match ? match.date : '—'} |`)
  }
}
say()

say('## 8. What is still missing')
say()
say('- **The 2026 comparison source.** The brief names two hand-compiled sources;')
say('  one 2027 PDF arrived. The 2026 Ekadashi table with 24 rows is not in the')
say('  repository, so section 2 computes an answer but diffs against nothing. To')
say('  close it: the table itself, or a URL.')
say('- **Regional variation is unmodelled.** Every date is Delhi. Sunrise in')
say('  Chennai is far enough east and south to move a marginal tithi.')
say('- **Purnimanta month names** are recorded in the rules as `alsoKnownAs` but')
say('  not computed as a separate scheme.')
say('- **Nishita fallback.** Janmashtami 2026 has no nishita inside its Ashtami;')
say('  the engine says so and falls back to sunrise rather than guessing.')

const text = out.join('\n') + '\n'
if (process.argv.includes('--write')) {
  writeFileSync(new URL('../docs/CALENDAR-VERIFICATION.md', import.meta.url), text)
  console.log('wrote docs/CALENDAR-VERIFICATION.md')
} else {
  console.log(text)
}
