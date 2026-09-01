// Generates src/data/observances.json from the calendar engine.
//
// The app does not run the engine. A full year costs a little over a second —
// the ephemeris is solved by Newton iteration per tithi, three times over for
// the stability check — which is too slow to block a calendar render on a
// phone and too slow to add to every plan request. So the dates are computed
// here, once, and committed.
//
// That would be a hand-typed table again if nothing enforced the link, which
// is exactly what this replaced. So test/panchanga-source-of-truth.test.js
// re-runs this generator and fails if the committed file differs by one
// character. The file is generated, never edited; the engine is the source.
//
//   node scripts/generate-observances.mjs           # print a summary
//   node scripts/generate-observances.mjs --write   # write the data file
//
// See docs/CALENDAR-VERIFICATION.md for what the engine was checked against.

import { writeFile } from 'node:fs/promises'
import {
  DEFAULT_LOCATION, hinduObservances, islamicObservances, RISK_MINUTES,
  solarIngresses, STABILITY_SHIFT_MINUTES,
} from '../panchanga/index.js'
import { isoDateAt } from '../panchanga/julian.js'

export const YEARS = [2026, 2027]

/** Six decimals of a Julian Day is a twelfth of a second — far past the noise. */
const round = (n) => (typeof n === 'number' ? Number(n.toFixed(6)) : n)

/**
 * The confidence scale, which spans both halves of the calendar.
 *
 *   computed            the engine resolved it, and the date does not move
 *                       when the whole tithi is shifted by ±15 minutes.
 *   computed_unstable   the engine resolved it, but that shift moves it. The
 *                       app asks the family to confirm these against their
 *                       own panchang rather than presenting a coin-flip as
 *                       a fact.
 *   curated             hand-maintained, because no rule the engine holds
 *                       decides it — the Jain sect calendars and the Sikh
 *                       Gurpurabs.
 *   provisional         arithmetic Hijri. The observed calendar is decided by
 *                       sighting the crescent and cannot be known in advance.
 */
export const CONFIDENCE = {
  computed: 'computed',
  unstable: 'computed_unstable',
  curated: 'curated',
  provisional: 'provisional',
}

/** One observance, reduced to what the app needs. Field order is the file's. */
function record(e) {
  const out = {
    id: e.id,
    name: e.id === 'ekadashi_vrat' && e.ekadashiName ? `${e.ekadashiName} Ekadashi` : e.name,
    religion: e.religion,
    date: e.smarta,
    confidence: e.needsConfirmation ? CONFIDENCE.unstable : CONFIDENCE.computed,
    resolvedBy: e.resolvedBy,
    tithi: `${e.tithi.paksha} ${e.tithi.name}`,
    masa: e.masa,
    marginMinutes: Math.round(e.margin),
  }
  // Both conventions, and only where they actually differ — a Vaishnava field
  // repeating the Smarta date on 22 of 24 Ekadashis is noise, and a reader
  // would stop looking at it.
  if (e.vaishnava && e.vaishnava !== e.smarta) out.vaishnavaDate = e.vaishnava
  if (e.ekadashiName) out.ekadashiName = e.ekadashiName
  if (e.adhikaMasa) out.adhikaMasa = true
  if (e.from) out.from = e.from
  if (e.through) out.through = e.through
  if (e.kshayaTithi) out.kshayaTithi = true
  if (e.spansTwoSunrises) out.spansTwoSunrises = true
  if (e.dashamiViddha) out.dashamiViddha = true
  if (e.kaalNote) out.kaalNote = e.kaalNote
  out.startsAt = round(e.startsAt)
  out.endsAt = round(e.endsAt)
  return out
}

/**
 * Sawan Somvar — the Mondays of Shravan — is not a tithi, but it is not a
 * hand-typed range either. Its month is PURNIMANTA Shravana, which runs from
 * Ashadha Purnima to Shravana Purnima, and the engine already resolves both
 * of those. So the four Mondays fall out of two computed dates.
 */
function sawanSomvar(hindu, year) {
  const purnimas = hindu.filter((e) => e.id === 'purnima')
  const open = purnimas.find((e) => e.masa === 'Ashadha')
  const close = purnimas.find((e) => e.masa === 'Shravana')
  if (!open || !close) return []

  const out = []
  const from = new Date(`${open.smarta}T00:00:00Z`)
  const to = new Date(`${close.smarta}T00:00:00Z`)
  for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() !== 1) continue
    const iso = d.toISOString().slice(0, 10)
    if (iso <= open.smarta || !iso.startsWith(String(year))) continue
    out.push({
      id: 'sawan_somvar',
      name: 'Sawan Somvar',
      religion: 'Hindu',
      date: iso,
      confidence: CONFIDENCE.computed,
      resolvedBy: 'weekday',
      tithi: null,
      masa: 'Shravana (purnimanta)',
      marginMinutes: null,
      from: open.smarta,
      through: close.smarta,
      derivedFrom: 'Mondays between Ashadha Purnima and Shravana Purnima',
    })
  }
  return out
}

/** Makar Sankranti is a solar ingress, not a tithi — the engine's other half. */
function makarSankranti(year) {
  const s = solarIngresses(year, DEFAULT_LOCATION).find((i) => i.rashi === 'Makara')
  if (!s) return []
  return [{
    id: 'makar_sankranti',
    name: 'Makar Sankranti',
    religion: 'Hindu',
    date: s.date,
    confidence: s.atRisk ? CONFIDENCE.unstable : CONFIDENCE.computed,
    resolvedBy: 'solar ingress',
    tithi: null,
    masa: null,
    marginMinutes: Math.round(s.minutesFromMidnight),
    note: 'The Sun’s sidereal entry into Makara. Sidereal quantities also '
      + 'carry the Lahiri ayanamsa model, so this has a wider error budget than '
      + 'a tithi date — about seven minutes in the instant, which moves no date here.',
  }]
}

/** The arithmetic Hijri dates, which are planning dates and nothing more. */
function islamic(year) {
  return islamicObservances(year)
    .map((e) => ({ ...e, date: isoDateAt(e.jd - 0.5 + DEFAULT_LOCATION.tz / 24, 0) }))
    .filter((e) => e.date.startsWith(String(year)))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({
      id: e.id,
      name: e.name,
      religion: 'Muslim',
      date: e.date,
      confidence: CONFIDENCE.provisional,
      resolvedBy: 'tabular Hijri',
      note: e.note || null,
    }))
}

export function buildObservances() {
  const observances = []
  for (const year of YEARS) {
    const hindu = hinduObservances(year, DEFAULT_LOCATION)
    observances.push(
      ...hindu.map(record),
      ...sawanSomvar(hindu, year),
      ...makarSankranti(year),
    )
  }
  observances.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))

  const provisional = []
  for (const year of YEARS) provisional.push(...islamic(year))

  return {
    $comment: 'GENERATED FILE — do not edit. Run: node scripts/generate-observances.mjs --write',
    $source: 'panchanga/ — see docs/CALENDAR-VERIFICATION.md',
    place: DEFAULT_LOCATION.name,
    timezone: DEFAULT_LOCATION.tz,
    years: YEARS,
    riskMinutes: RISK_MINUTES,
    stabilityShiftMinutes: STABILITY_SHIFT_MINUTES,
    observances,
    provisional,
  }
}

export function serialise(data) {
  return `${JSON.stringify(data, null, 2)}\n`
}

const OUT = new URL('../src/data/observances.json', import.meta.url)

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const data = buildObservances()
  const counts = {}
  for (const o of data.observances) counts[o.id] = (counts[o.id] || 0) + 1
  const unstable = data.observances.filter((o) => o.confidence === CONFIDENCE.unstable)

  if (process.argv.includes('--write')) {
    await writeFile(OUT, serialise(data))
    console.log(`wrote ${OUT.pathname}`)
  }
  console.log(`${data.observances.length} computed observances across ${YEARS.join('–')}`)
  console.log(`${data.provisional.length} provisional Islamic dates`)
  console.log(`${unstable.length} need confirmation: ${unstable
    .map((o) => `${o.date} ${o.name}`).join(', ')}`)
  console.table(counts)
}
