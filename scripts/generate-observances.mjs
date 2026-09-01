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
  DEFAULT_LOCATION, hinduObservances, islamicObservances, LOCATIONS, RISK_MINUTES,
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
  // A rule can declare itself provisional whatever the ephemeris says. That is
  // the Theravada case: the astronomy is exact and the calendar it belongs to
  // is not modelled here, so a confident-looking date would be claiming
  // evidence that does not exist.
  const out = {
    id: e.id,
    name: e.id === 'ekadashi_vrat' && e.ekadashiName ? `${e.ekadashiName} Ekadashi` : e.name,
    religion: e.religion,
    date: e.smarta,
    confidence: e.provisional
      ? CONFIDENCE.provisional
      : (e.needsConfirmation ? CONFIDENCE.unstable : CONFIDENCE.computed),
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
  if (e.provisional) out.provisionalReason = e.provisional
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

/**
 * Vassa — the three-month rains retreat.
 *
 * Derived rather than ruled, for the same reason Sawan Somvar is: it spans
 * lunar months, and a tithi rule resolves one tithi inside one of them. It
 * begins the day after Asalha Puja and ends on the Ashwin full moon, which the
 * engine already computes — three lunar months, and the span comes out at 89
 * days in both years, which is the arithmetic checking itself.
 *
 * Provisional for the same reason as the other three: the astronomy is exact
 * and the calendar it belongs to is not modelled here.
 */
function vassa(hindu, year, reason) {
  const purnimas = hindu.filter((e) => e.id === 'purnima')
  const asalha = purnimas.find((e) => e.masa === 'Ashadha')
  const close = purnimas.find((e) => e.masa === 'Ashwin')
  if (!asalha || !close) return []

  const begins = new Date(`${asalha.smarta}T00:00:00Z`)
  begins.setUTCDate(begins.getUTCDate() + 1)
  const from = begins.toISOString().slice(0, 10)
  if (!from.startsWith(String(year))) return []

  return [{
    id: 'vassa',
    name: 'Vassa (rains retreat)',
    religion: 'Buddhist',
    date: from,
    confidence: CONFIDENCE.provisional,
    resolvedBy: 'the day after Asalha Puja, to the Ashwin full moon',
    tithi: null,
    masa: 'Ashadha to Ashwin',
    marginMinutes: null,
    from,
    through: close.smarta,
    derivedFrom: 'Ashadha Purnima + 1 day, through Ashwin Purnima',
    provisionalReason: reason,
  }]
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

/**
 * Where a date lands on a different day than it does in Delhi.
 *
 * A tithi is the same instant everywhere; only the sunrise it is measured
 * against is local, and Kolkata's is about fifty minutes earlier than Delhi's.
 * That is enough to move 14 of 352 observances across 2026 and 2027 — most of
 * them in Kolkata, the easternmost of the eight, and two of them WEST in
 * Mumbai and Ahmedabad.
 *
 * The dates themselves stay Delhi's: the app ships one precomputed table and a
 * live per-city recompute would cost a second a year in the browser. What
 * travels instead is the knowledge that a date moves and where to, so a family
 * outside Delhi is ASKED rather than silently given the wrong day. That is the
 * confirmation-prompt path the five unstable dates already use, and it is the
 * same slot in the same store.
 *
 * Keyed on the tithi's start instant rather than on its date, because the
 * question is whether one occurrence lands elsewhere and an identity keyed on
 * the date could not survive the move.
 */
// One year for one city is about a second of Newton iteration, and this pass
// wants sixteen of them. Memoised so the Delhi year is not solved twice.
const yearCache = new Map()
function observancesAt(year, place) {
  const key = `${year}|${place.name}`
  if (!yearCache.has(key)) yearCache.set(key, hinduObservances(year, place))
  return yearCache.get(key)
}

function variantDates(year) {
  const key = (e) => `${e.id}|${e.startsAt.toFixed(3)}`
  const home = new Map(observancesAt(year, DEFAULT_LOCATION).map((e) => [key(e), e.smarta]))
  const varies = new Map()

  for (const [city, place] of Object.entries(LOCATIONS)) {
    if (place === DEFAULT_LOCATION) continue
    for (const e of observancesAt(year, place)) {
      const here = home.get(key(e))
      if (!here || here === e.smarta) continue
      if (!varies.has(key(e))) varies.set(key(e), {})
      varies.get(key(e))[city] = e.smarta
    }
  }
  return { key, varies }
}

export function buildObservances() {
  const observances = []
  for (const year of YEARS) {
    const hindu = observancesAt(year, DEFAULT_LOCATION)
    const { key, varies } = variantDates(year)
    observances.push(
      ...hindu.map((e) => {
        const row = record(e)
        const elsewhere = varies.get(key(e))
        if (elsewhere) row.variesByCity = elsewhere
        return row
      }),
      ...sawanSomvar(hindu, year),
      ...vassa(hindu, year, hindu.find((e) => e.provisional)?.provisional || null),
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
    cities: Object.fromEntries(
      Object.entries(LOCATIONS).map(([k, p]) => [k, p.name]),
    ),
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
  const varying = data.observances.filter((o) => o.variesByCity)
  console.log(`${varying.length} land on a different day in at least one of the eight cities`)
  console.table(counts)
}
