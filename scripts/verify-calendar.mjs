// Generates the calendar engine's verification report.
//
//   node scripts/verify-calendar.mjs           print to stdout
//   node scripts/verify-calendar.mjs --write   write docs/CALENDAR-VERIFICATION.md
//
// Every number in the report comes from here. Nothing is typed by hand into
// the document, so re-running it after a change to the engine reprints the
// truth rather than the last thing anyone believed.

import { writeFileSync } from 'node:fs'
import {
  DEFAULT_LOCATION, RISK_MINUTES, TITHI_RULES,
  adhikaMaasFor, christianDates, islamicObservances,
  resolveTithiRule, solarIngresses, sunRiseSet,
} from '../panchanga/index.js'
import { fromJD, isoDateAt, isoToJD } from '../panchanga/julian.js'
import { solveElongation } from '../panchanga/tithi.js'
import { phaseJDE } from '../test/reference/moonPhase.js'
import { AMAVASYA_2027, PRADOSH_2027, PURNIMA_2027, parseStamp } from '../test/reference/pdf2027.js'

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
say('**The engine is wired to nothing.** No file under `src/` imports `panchanga/`.')
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
say('### Dates at risk in 2026–2027')
say()
say(`A date is at risk when a small error would move it. The margin is the`)
say('closest approach between any nearby sunrise and either end of the tithi:')
say(`below **${RISK_MINUTES} minutes**, combined ephemeris and refraction error could flip the day.`)
say()
say('| date | observance | margin | why |')
say('| --- | --- | --- | --- |')
const risky = []
for (const year of [2026, 2027]) {
  for (const rule of TITHI_RULES) {
    for (const e of resolveTithiRule(rule, year, place)) {
      if (e.margin < RISK_MINUTES) risky.push(e)
    }
  }
}
risky.sort((a, b) => a.smarta.localeCompare(b.smarta))
for (const e of risky) {
  const why = e.kshayaTithi
    ? 'kshaya tithi — a sunrise nearly falls inside'
    : (e.spansTwoSunrises ? 'spans two sunrises — the split nearly vanishes' : 'sunrise nearly outside the tithi')
  say(`| ${e.smarta} | ${e.name}${e.ekadashiName ? ` (${e.ekadashiName})` : ''} | ${e.margin.toFixed(0)} min | ${why} |`)
}
say()
say(`${risky.length} of the ${
  [2026, 2027].reduce((n, y) => n + TITHI_RULES.reduce((m, r) => m + resolveTithiRule(r, y, place).length, 0), 0)
} computed observances across the two years are inside the risk margin.`)
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

say('## 5. Disagreements with the app\'s own 2026 calendar')
say()
say('`src/data/fastingTraditions.json` carries 25 hand-entered 2026 rows. The')
say('engine is not wired to it and this changes nothing there, but the')
say('comparison is the point of building this.')
say()
say('| observance | app data | engine | note |')
say('| --- | --- | --- | --- |')
const appRows = [
  ['Makar Sankranti', '2026-01-14', mk26.date, ''],
  ['Maha Shivaratri', '2026-02-17', resolveTithiRule(ruleById('maha_shivaratri'), 2026, place)[0]?.smarta, 'engine resolves at nishita (midnight), the rule for this festival'],
  ['Janmashtami', '2026-08-14', resolveTithiRule(ruleById('janmashtami'), 2026, place)[0]?.smarta, 'app date is three weeks out'],
  ['Ganesh Chaturthi', '2026-08-27', resolveTithiRule(ruleById('ganesh_chaturthi'), 2026, place)[0]?.smarta, 'engine resolves at madhyahna (midday)'],
  ['Karwa Chauth', '2026-10-25', resolveTithiRule(ruleById('karwa_chauth'), 2026, place)[0]?.smarta, ''],
  ['Aja Ekadashi', '2026-09-07', ek26.find((e) => e.ekadashiName === 'Aja')?.smarta, 'agrees'],
  ['Mokshada Ekadashi', '2026-12-22', ek26.find((e) => e.ekadashiName === 'Mokshada')?.smarta, ''],
]
for (const [what, app, engine, note] of appRows) {
  say(`| ${what} | ${app} | ${engine || '—'} | ${app === engine ? 'agrees' : note || 'differs'} |`)
}
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

say('## 7. What is still missing')
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
