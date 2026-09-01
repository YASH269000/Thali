// The calendar engine's public surface.
//
// STATUS: standalone and wired to nothing. No file under src/ imports this,
// by design — it exists to be checked against independent sources before the
// planner is allowed to depend on it. See docs/CALENDAR-VERIFICATION.md.
//
// Three independent calculations live behind this one entry point, and they
// have genuinely different characters. It is worth keeping them straight:
//
//   Hindu / Jain / Buddhist  astronomical. Tithi from lunar and solar
//                            longitude, resolved to a date by local sunrise.
//                            Measured accuracy, stated per date.
//   Islamic                  arithmetic, and PROVISIONAL by nature. The real
//                            calendar is decided by sighting the crescent.
//   Christian                arithmetic and exact. Computus is closed form.

import { isoDateAt, isoToJD, jdToJde, jdeToJd } from './julian.js'
import { DEFAULT_LOCATION } from './locations.js'
import { lunarMonths, masaLabel, sankrantis, sunSidereal } from './masa.js'
import {
  boundaryMargin, describeTithi, resolveByKaal, resolveObservance, solveElongation, tithiIndexOf,
} from './tithi.js'
import { ekadashiName, TITHI_RULES } from './rules.js'
import { christianDates } from './computus.js'
import { islamicObservances } from './hijri.js'
import { moonRise, sunRiseSet } from './riseset.js'

export { LOCATIONS, DEFAULT_LOCATION } from './locations.js'
export { TITHI_RULES, EKADASHI_NAMES } from './rules.js'
export { lunarMonths, masaLabel } from './masa.js'
export { christianDates, easter } from './computus.js'
export { islamicObservances, hijriToJD, jdToHijri } from './hijri.js'
export { sunRiseSet, moonRise, moonSet } from './riseset.js'

/** A margin below this is reported as at risk of flipping to the other day. */
export const RISK_MINUTES = 15

/**
 * How far the whole tithi is shifted when testing whether a date is stable.
 *
 * Comfortably larger than everything that could be wrong at once: the measured
 * worst-case ephemeris error is about one minute, and refraction moves sunrise
 * by a minute or two. Fifteen minutes is not a plausible error, which is the
 * point — a date that survives it is not merely probably right.
 */
export const STABILITY_SHIFT_MINUTES = 15

/**
 * Does this date survive the ephemeris being wrong?
 *
 * A small margin says a boundary is CLOSE, which is not the same as saying the
 * date is in doubt. Padmini 2026 is the case that makes the distinction worth
 * drawing: its margin is 13 minutes, but both sides of that boundary lead to
 * 27 May — either the tithi touches two sunrises and the first is viddha, or
 * it touches only the second — so the date is not actually in question.
 *
 * So rather than reporting the margin and letting a reader guess, this shifts
 * the entire tithi by ±15 minutes and re-resolves. If the answer does not
 * move, the date is stable however tight the margin looks.
 */
function stabilityOf(span, place, rule, resolvedDate) {
  for (const shift of [-STABILITY_SHIFT_MINUTES, STABILITY_SHIFT_MINUTES]) {
    const d = shift / 1440
    const moved = {
      ...span,
      startJd: span.startJd + d,
      endJd: span.endJd + d,
      startJde: span.startJde + d,
      endJde: span.endJde + d,
    }
    const obs = resolveObservance(moved, place, rule.viddha)
    let date = obs.smarta
    if (rule.resolveAt) {
      const k = resolveByKaal(moved, place, rule.resolveAt)
      if (k.date) date = k.date
    }
    if (date !== resolvedDate) return { stable: false, breaksAt: shift }
  }
  return { stable: true, breaksAt: null }
}

/**
 * Every occurrence of one tithi rule in a Gregorian year.
 *
 * Within a lunation each tithi index occurs exactly once, so the month
 * boundaries give a clean place to look: tithi index k spans elongation
 * [12k, 12k+12) inside that month, whatever the month's length.
 */
export function resolveTithiRule(rule, year, place = DEFAULT_LOCATION) {
  const yearStart = isoToJD(`${year}-01-01`, place.tz)
  const yearEnd = isoToJD(`${year + 1}-01-01`, place.tz)
  // Reach a month either side: a December tithi can belong to a lunar month
  // that started in November, and the same at the other end.
  const months = lunarMonths(jdToJde(yearStart) - 35, jdToJde(yearEnd) + 35)

  const out = []
  for (const month of months) {
    if (rule.masa && month.name !== rule.masa) continue
    if (rule.masa && month.adhika) continue

    const pakshas = rule.paksha === 'both' ? ['shukla', 'krishna'] : [rule.paksha]
    for (const paksha of pakshas) {
      const index = tithiIndexOf(rule.tithi, paksha)
      const startJde = solveElongation(index * 12, month.start + index * 0.98)
      // Guard against a solve that wandered into a neighbouring lunation.
      if (startJde < month.start - 0.5 || startJde > month.end + 0.5) continue
      const endJde = solveElongation(((index + 1) % 30) * 12, startJde + 1)

      const span = {
        index,
        startJde,
        endJde,
        startJd: jdeToJd(startJde),
        endJd: jdeToJd(endJde),
      }
      const obs = resolveObservance(span, place, rule.viddha)
      const margin = boundaryMargin(span, place)

      // A festival fixed at nishita or madhyahna is resolved by that moment,
      // not by sunrise. When no day qualifies — which happens when the tithi
      // starts just after one midnight and ends just before the next — the
      // answer is genuinely contested, so it falls back to sunrise and says
      // so rather than inventing certainty.
      let resolved = obs.smarta
      let kaalNote = null
      if (rule.resolveAt) {
        const k = resolveByKaal(span, place, rule.resolveAt)
        if (k.date) {
          resolved = k.date
        } else {
          kaalNote = `No ${rule.resolveAt} falls inside this tithi; `
            + 'traditions legitimately differ here. Sunrise rule used instead.'
        }
      }

      const entry = {
        id: rule.id,
        name: rule.name,
        religion: rule.religion,
        tithi: describeTithi(index),
        masa: masaLabel(month),
        adhikaMasa: Boolean(month.adhika),
        smarta: resolved,
        vaishnava: rule.resolveAt ? resolved : obs.vaishnava,
        resolvedBy: rule.resolveAt || 'sunrise',
        kaalNote,
        spansTwoSunrises: obs.kind === 'two',
        dashamiViddha: Boolean(obs.viddha),
        kshayaTithi: obs.kind === 'none',
        startsAt: span.startJd,
        endsAt: span.endJd,
        margin,
        observedAt: rule.observedAt || 'sunrise',
      }
      entry.atRisk = entry.margin < RISK_MINUTES
      // A tight margin is a reason to check, not a reason to doubt. This is
      // what decides whether a date needs a confirmation prompt in the app.
      const stability = stabilityOf(span, place, rule, resolved)
      entry.stable = stability.stable
      entry.needsConfirmation = !stability.stable
      if (rule.id === 'ekadashi_vrat') entry.ekadashiName = ekadashiName(month, paksha)

      // Fasts that end at sunset or moonrise need that time, not just a date.
      if (rule.observedAt === 'sunset' || rule.observedAt === 'moonrise') {
        const jd0 = isoToJD(entry.smarta, place.tz)
        const { sunset } = sunRiseSet(jd0, place)
        entry.sunset = sunset
        if (rule.observedAt === 'moonrise') entry.moonrise = moonRise(jd0, place)
      }

      if (entry.smarta >= `${year}-01-01` && entry.smarta <= `${year}-12-31`) out.push(entry)
    }
  }
  return out.sort((a, b) => a.smarta.localeCompare(b.smarta))
}

/** Every tithi-based observance in a year, sorted. */
export function hinduObservances(year, place = DEFAULT_LOCATION) {
  return TITHI_RULES.flatMap((r) => resolveTithiRule(r, year, place))
    .sort((a, b) => a.smarta.localeCompare(b.smarta) || a.id.localeCompare(b.id))
}

/** The twelve solar ingresses of a year. Makar Sankranti is the Makara one. */
export function solarIngresses(year, place = DEFAULT_LOCATION) {
  const start = jdToJde(isoToJD(`${year}-01-01`, place.tz))
  const end = jdToJde(isoToJD(`${year + 1}-01-01`, place.tz))
  return sankrantis(start, end).map((s) => {
    const jd = jdeToJd(s.jde)
    const date = isoDateAt(jd, place.tz)
    // How close the ingress is to local midnight, which is what would move
    // the civil date. Sankranti observance rules vary by region on top of
    // this; only the astronomical instant is claimed here.
    const midnightGap = Math.min(
      (jd + place.tz / 24) % 1,
      1 - ((jd + place.tz / 24) % 1),
    ) * 1440
    return {
      rashi: s.name,
      name: s.name === 'Makara' ? 'Makar Sankranti' : `${s.name} Sankranti`,
      date,
      jd,
      minutesFromMidnight: midnightGap,
      atRisk: midnightGap < RISK_MINUTES,
    }
  })
}

/** Whether a year carries an intercalary month, and which. */
export function adhikaMaasFor(year, place = DEFAULT_LOCATION) {
  const start = jdToJde(isoToJD(`${year}-01-01`, place.tz))
  const end = jdToJde(isoToJD(`${year + 1}-01-01`, place.tz))
  const months = lunarMonths(start, end)
  return {
    adhika: months.filter((m) => m.adhika).map((m) => ({
      name: masaLabel(m),
      from: isoDateAt(jdeToJd(m.start), place.tz),
      to: isoDateAt(jdeToJd(m.end), place.tz),
    })),
    kshaya: months.filter((m) => m.kshaya).map((m) => ({
      name: masaLabel(m),
      from: isoDateAt(jdeToJd(m.start), place.tz),
      to: isoDateAt(jdeToJd(m.end), place.tz),
    })),
    months: months.map((m) => ({
      label: masaLabel(m),
      from: isoDateAt(jdeToJd(m.start), place.tz),
      to: isoDateAt(jdeToJd(m.end), place.tz),
      sankrantis: m.sankrantis.map((s) => s.name),
    })),
  }
}

/** Everything the engine knows about a Gregorian year, in one call. */
export function calendarYear(year, place = DEFAULT_LOCATION) {
  const islamic = islamicObservances(year)
    .map((e) => ({ ...e, date: isoDateAt(e.jd - 0.5 + place.tz / 24, 0) }))
    .filter((e) => e.date.startsWith(String(year)))
    .sort((a, b) => a.date.localeCompare(b.date))

  return {
    year,
    place: place.name,
    hindu: hinduObservances(year, place),
    ingresses: solarIngresses(year, place),
    adhikaMaas: adhikaMaasFor(year, place),
    islamic,
    christian: christianDates(year),
  }
}

/** Sun's sidereal longitude, exported for callers checking a rashi directly. */
export { sunSidereal }
