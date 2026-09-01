// Tithi: the lunar day, and which calendar day it belongs to.
//
// A tithi is 12° of elongation between Moon and Sun. Thirty of them make a
// lunation. Because the Moon's speed varies by a fifth over a month, a tithi
// is not a fixed length: it runs from about 19 to about 26 hours. That is the
// whole source of difficulty. A unit that is usually a bit shorter than a day
// but sometimes longer cannot map one-to-one onto calendar days, so the
// calendar needs a rule, and the rule is sunrise.
//
// THE SUNRISE RULE. The tithi in progress at sunrise is that day's tithi. Three
// things follow, and all three occur in any given year:
//
//   one sunrise   the ordinary case; the tithi owns exactly one day.
//   two sunrises  the tithi is longer than the interval between sunrises, so
//                 two consecutive days both "are" that tithi. This is where
//                 Smarta and Vaishnava part company — see resolveObservance.
//   no sunrise    a kshaya tithi: it begins after one sunrise and ends before
//                 the next, so no day carries it. It is not skipped by
//                 observers; it is kept on the day it runs through.

import { elongation, norm180 } from './ephemeris.js'
import { jdToJde, jdeToJd, isoDateAt, isoToJD } from './julian.js'
import { moonRise, sunRiseSet } from './riseset.js'

export const TITHI_NAMES = [
  'Pratipada', 'Dwitiya', 'Tritiya', 'Chaturthi', 'Panchami', 'Shashthi',
  'Saptami', 'Ashtami', 'Navami', 'Dashami', 'Ekadashi', 'Dwadashi',
  'Trayodashi', 'Chaturdashi', 'Purnima',
]

/** 0-based tithi index, 0–29. 0 = Shukla Pratipada, 14 = Purnima, 29 = Amavasya. */
export function tithiIndexAt(jde) {
  return Math.floor(elongation(jde) / 12)
}

/** How a tithi index reads to a person. */
export function describeTithi(index) {
  const paksha = index < 15 ? 'shukla' : 'krishna'
  const n = (index % 15) + 1
  let name = TITHI_NAMES[n - 1]
  if (paksha === 'krishna' && n === 15) name = 'Amavasya'
  return { index, paksha, number: n, name }
}

/** The index for a named tithi in a named paksha. Ekadashi krishna -> 25. */
export function tithiIndexOf(number, paksha) {
  return (paksha === 'krishna' ? 15 : 0) + (number - 1)
}

/**
 * The instant elongation equals `target` degrees, nearest `jdeGuess`.
 *
 * Elongation increases monotonically — the Moon's apparent speed relative to
 * the Sun ranges over roughly 10.8°–14.4° per day and is never negative — so
 * Newton's method cannot fall off a turning point here.
 */
export function solveElongation(target, jdeGuess) {
  let t = jdeGuess
  for (let i = 0; i < 60; i += 1) {
    const f = norm180(elongation(t) - target)
    if (Math.abs(f) < 1e-9) break
    const h = 0.01
    const rate = norm180(elongation(t + h) - elongation(t - h)) / (2 * h)
    t -= f / rate
  }
  return t
}

/**
 * Every tithi that overlaps [jdStart, jdEnd], with exact boundaries.
 * @returns {Array<{ index, startJde, endJde, startJd, endJd }>}
 */
export function tithiSpans(jdStart, jdEnd) {
  const out = []
  const jdeStart = jdToJde(jdStart)
  const jdeEnd = jdToJde(jdEnd)

  let index = tithiIndexAt(jdeStart)
  // Walk back to this tithi's own start so the first span is complete.
  let start = solveElongation(index * 12, jdeStart)
  if (start > jdeStart) {
    index = (index + 29) % 30
    start = solveElongation(index * 12, jdeStart - 1)
  }

  while (start < jdeEnd) {
    const nextIndex = (index + 1) % 30
    const end = solveElongation(nextIndex * 12, start + 1)
    out.push({
      index,
      startJde: start,
      endJde: end,
      startJd: jdeToJd(start),
      endJd: jdeToJd(end),
    })
    start = end
    index = nextIndex
  }
  return out
}

/**
 * Which local dates a tithi span covers, by the sunrise rule.
 *
 * @returns {{ sunrises: string[], kind: 'one'|'two'|'none', runsThrough: string }}
 *   `sunrises` are the ISO dates whose sunrise falls inside the span;
 *   `runsThrough` is the date the tithi is current on when it claims no
 *   sunrise at all, which is the day a kshaya tithi is kept.
 */
export function datesForSpan(span, place) {
  const sunrises = []
  // A tithi never exceeds ~26 hours, so a two-day window either side is ample.
  const firstDay = Math.floor(span.startJd + place.tz / 24 - 1.5)
  for (let d = 0; d <= 3; d += 1) {
    const iso = isoDateAt(firstDay + d + 0.5, place.tz)
    const { sunrise } = sunRiseSet(isoToJD(iso, place.tz), place)
    if (sunrise === null) continue
    if (sunrise >= span.startJd && sunrise < span.endJd) sunrises.push(iso)
  }
  const kind = sunrises.length === 0 ? 'none' : (sunrises.length === 1 ? 'one' : 'two')
  return { sunrises, kind, runsThrough: isoDateAt(span.startJd, place.tz) }
}

/** The last four ghatis before sunrise — 96 minutes — the arunodaya kaal. */
export const ARUNODAYA_MINUTES = 96

/**
 * Is the first of two candidate days contaminated by the preceding tithi?
 *
 * The Ekadashi rule is stricter than the plain sunrise rule and this is where
 * the difference bites. An Ekadashi that begins during arunodaya kaal — the
 * last four ghatis of night — leaves Dashami running into the dawn, and that
 * day is Dashami-viddha: the vrat moves to the following day.
 *
 * This is exactly the case of Padmini Ekadashi 2026. The tithi runs 26 May
 * 05:12 to 27 May 06:22 and is present at both sunrises, so the plain rule
 * would give Smarta the 26th. But Dashami ran until 05:12 against a sunrise of
 * 05:25, thirteen minutes inside arunodaya, so the 26th is viddha and the vrat
 * is kept on the 27th — which is what Drik Panchang, ISKCON and the panchang
 * media all publish.
 */
export function isDashamiViddha(span, place, iso) {
  const { sunrise } = sunRiseSet(isoToJD(iso, place.tz), place)
  if (sunrise === null) return false
  const arunodaya = sunrise - ARUNODAYA_MINUTES / 1440
  return span.startJd > arunodaya && span.startJd <= sunrise
}

/**
 * Smarta and Vaishnava dates for one occurrence of a tithi.
 *
 * The rule, as a rule and not as two lists: where a tithi is current at two
 * consecutive sunrises, Smarta observance takes the first day and Vaishnava
 * the second. Where it is current at one, both keep that day. Where it is
 * current at none — a kshaya tithi — both keep the day it runs through.
 *
 * With `viddha` set, one refinement applies on top: if the first day is
 * Dashami-viddha the Smarta date moves to the second day as well, and the two
 * schools converge. The split therefore appears only when the tithi began
 * before arunodaya — cleanly, with the whole of the dawn to itself.
 *
 * This is the operational form of a longer argument. It is stated here as the
 * engine's rule so that a disagreement with a published calendar can be
 * attributed rather than argued about.
 */
export function resolveObservance(span, place, viddha = null) {
  const { sunrises, kind, runsThrough } = datesForSpan(span, place)
  if (kind === 'two') {
    const contaminated = viddha === 'arunodaya' && isDashamiViddha(span, place, sunrises[0])
    return {
      smarta: contaminated ? sunrises[1] : sunrises[0],
      vaishnava: sunrises[1],
      kind,
      sunrises,
      viddha: contaminated,
    }
  }
  if (kind === 'one') {
    return { smarta: sunrises[0], vaishnava: sunrises[0], kind, sunrises, viddha: false }
  }
  return { smarta: runsThrough, vaishnava: runsThrough, kind, sunrises, viddha: false }
}

/**
 * How much error would change this date.
 *
 * One definition covering all three cases: the smallest gap between any nearby
 * sunrise and either end of the tithi. That is precisely the quantity that
 * decides the outcome, whichever case applies —
 *
 *   ordinary    the sunrise sits well inside the tithi; a large margin.
 *   two sunrises the second sunrise is close to the end, and if it crossed,
 *               the Smarta/Vaishnava split would vanish.
 *   kshaya      no sunrise is inside, but one is close to a boundary, and if
 *               it crossed, the tithi would stop being kshaya.
 *
 * Always non-negative: it is a distance, not a signed position. A margin of
 * ten minutes means ten minutes of combined ephemeris and sunrise error would
 * have produced a different date — which is the honest way to say that a
 * computed date and a published one may legitimately differ.
 */
export function boundaryMargin(span, place) {
  let best = Infinity
  for (let d = -1; d <= 2; d += 1) {
    const iso = isoDateAt(span.startJd + d, place.tz)
    const { sunrise } = sunRiseSet(isoToJD(iso, place.tz), place)
    if (sunrise === null) continue
    best = Math.min(
      best,
      Math.abs(sunrise - span.startJd) * 1440,
      Math.abs(sunrise - span.endJd) * 1440,
    )
  }
  return best
}

/**
 * Not every observance is decided at sunrise.
 *
 * The sunrise rule governs the vrats — Ekadashi, Pradosh, Sankashti — but
 * several major festivals are fixed by a different moment of the day, and
 * applying sunrise to them is simply the wrong rule rather than an
 * approximation of it. Two matter here:
 *
 *   pradosh    a WINDOW, not an instant: sunset to sunset + 3 ghatis (72
 *              minutes). Trayodashi need only overlap it, and the day with the
 *              greater overlap wins. Using the instant of sunset instead gets
 *              3 May 2027 wrong — Trayodashi begins 67 minutes after sunset
 *              that evening, which is inside the window but after the instant.
 *              Authorities differ on the length; 3 ghatis is the classical
 *              figure and the supplied PDF says "1.5 to 2 hours", so this is a
 *              choice, and PRADOSH_KAAL_MINUTES names it rather than burying
 *              it.
 *   moonrise   Sankashti Chaturthi and Karwa Chauth are broken on sighting the
 *              Moon, so the tithi at moonrise decides them.
 *   nishita    the middle of the night, midway between sunset and the next
 *              sunrise. Maha Shivaratri and Janmashtami are night observances;
 *              the night belongs to the day it began on.
 *   madhyahna  the middle of the day, midway between sunrise and sunset.
 *              Ganesh Chaturthi is kept then.
 *
 * Measured on 2026-2027 this is worth a full day on 21 of 234 observances:
 * Shivaratri moves from 16 to 15 February, Ganesh Chaturthi from 15 to
 * 14 September, and nine Pradosh dates onto the published date.
 *
 * @returns {{ date: string|null, moment: number|null }}
 */
export const PRADOSH_KAAL_MINUTES = 72

export function resolveByKaal(span, place, mode) {
  // The window modes score every candidate day and take the best overlap,
  // rather than returning the first day that qualifies at all.
  if (mode === 'pradosh') {
    let best = null
    for (let d = -2; d <= 2; d += 1) {
      const iso = isoDateAt(span.startJd + d, place.tz)
      const { sunset } = sunRiseSet(isoToJD(iso, place.tz), place)
      if (sunset === null) continue
      const windowEnd = sunset + PRADOSH_KAAL_MINUTES / 1440
      const overlap = Math.min(span.endJd, windowEnd) - Math.max(span.startJd, sunset)
      if (overlap > 0 && (!best || overlap > best.overlap)) {
        best = { date: iso, moment: Math.max(span.startJd, sunset), overlap }
      }
    }
    return best ? { date: best.date, moment: best.moment } : { date: null, moment: null }
  }

  for (let d = -2; d <= 2; d += 1) {
    const iso = isoDateAt(span.startJd + d, place.tz)
    const jd0 = isoToJD(iso, place.tz)
    const { sunrise, sunset } = sunRiseSet(jd0, place)
    if (sunrise === null || sunset === null) continue

    let moment
    if (mode === 'sunset') {
      moment = sunset
    } else if (mode === 'moonrise') {
      moment = moonRise(jd0, place)
      if (moment === null) continue
    } else if (mode === 'madhyahna') {
      moment = (sunrise + sunset) / 2
    } else {
      const next = sunRiseSet(jd0 + 1, place)
      if (next.sunrise === null) continue
      moment = (sunset + next.sunrise) / 2
    }
    if (moment >= span.startJd && moment < span.endJd) return { date: iso, moment }
  }
  return { date: null, moment: null }
}
