// The times a fast actually turns on, computed for where the family is.
//
// This is the first thing in src/ to import the ephemeris, and it is worth
// saying why the earlier refusals do not apply. A YEAR of tithi dates costs
// about a second — Newton iteration on the moon per tithi, three times over
// for the stability check — so those are precomputed and shipped. A single
// day's sunrise, sunset and moonrise is a bounded scan and costs about a
// millisecond. Precomputing THOSE would mean shipping Delhi's times to a
// family in Mumbai, and the moon rises 74 minutes apart between Kolkata and
// Mumbai on Karva Chauth. A nirjala fast ends at moonrise. That is not a
// rounding difference, it is ending a fast three quarters of an hour early.
//
// So: dates precomputed for Delhi and confirmed with the family where they
// differ; times computed live for the family's own city, every time.
//
// What crosses into the bundle is riseset.js and the two position series it
// needs. The tithi solver, the lunar-month machinery, the ayanamsa model, the
// Hijri arithmetic and the computus all stay out — test/times.test.js asserts
// that src/ imports nothing else from panchanga/.

import { FAJR_ANGLE, fajrMaghrib, moonRise, moonSet, sunRiseSet } from '../../panchanga/riseset.js'
import { fromJD, isoToJD } from '../../panchanga/julian.js'
import { DEFAULT_LOCATION, placeFor } from './location.js'

export { FAJR_ANGLE }

/**
 * "8:56 PM", or an em dash when the event does not happen.
 *
 * The Moon genuinely does not rise on some days — it rises later each day and
 * occasionally skips a civil date entirely — so null is an answer, not a
 * failure, and it has to render as one.
 */
export function formatTime(jd, place) {
  if (jd == null) return null
  const d = fromJD(jd + place.tz / 24)
  let hour = Math.floor((d.hour || 0) + (d.minute || 0) / 60)
  let minute = Math.round((((d.hour || 0) + (d.minute || 0) / 60) % 1) * 60)
  if (minute === 60) { minute = 0; hour += 1 }
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}:${String(minute).padStart(2, '0')} ${suffix}`
}

/** "Moonrise in Mumbai, 8:56 PM" — the assumption never travels separately. */
export function describeTime(label, jd, place) {
  const time = formatTime(jd, place)
  return time ? `${label} in ${place.name}, ${time}` : `${label} in ${place.name}: does not occur today`
}

/**
 * Every moment a timing fast can turn on, for one date and one place.
 *
 * Returned as raw JD alongside the formatted string, because the slot table
 * orders slots by time and comparing "8:56 PM" as text would sort 10:00 AM
 * after 8:56 PM.
 */
export function dayTimes(isoDate, locationKey, { fajrAngle = FAJR_ANGLE } = {}) {
  const place = typeof locationKey === 'string' ? placeFor(locationKey) : (locationKey || DEFAULT_LOCATION)
  const jd0 = isoToJD(isoDate, place.tz)
  const { sunrise, sunset } = sunRiseSet(jd0, place)
  const { fajr, maghrib, angle } = fajrMaghrib(jd0, place, fajrAngle)

  const at = (jd) => ({ jd, text: formatTime(jd, place) })
  return {
    date: isoDate,
    place,
    city: place.name,
    fajrAngle: angle,
    sunrise: at(sunrise),
    sunset: at(sunset),
    moonrise: at(moonRise(jd0, place)),
    moonset: at(moonSet(jd0, place)),
    // Named apart from sunset because they answer a different question with
    // the same instant, and a reader looking for iftar should find it.
    fajr: at(fajr),
    maghrib: at(maghrib),
  }
}

/**
 * Sargi is taken before dawn, not at it.
 *
 * Forty-five minutes before sunrise is the common practice rather than a rule
 * — the meal is eaten and finished before the fast begins at sunrise, and
 * households differ on how long before. Stated on screen rather than presented
 * as computed, the same way the two-meals assumption is.
 */
export const SARGI_MINUTES_BEFORE_SUNRISE = 45

export function sargiTime(times) {
  if (times.sunrise.jd == null) return { jd: null, text: null }
  const jd = times.sunrise.jd - SARGI_MINUTES_BEFORE_SUNRISE / 1440
  return { jd, text: formatTime(jd, times.place) }
}
