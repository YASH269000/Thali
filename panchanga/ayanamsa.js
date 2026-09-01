// Lahiri (Chitrapaksha) ayanamsa — the tropical-to-sidereal offset.
//
// WHERE THIS IS AND IS NOT NEEDED. A tithi is a difference of two longitudes,
// so a constant offset applied to both cancels exactly: no tithi in this
// engine touches this file. What does need it is anything referred to the
// sidereal zodiac — Makar Sankranti, and the lunar month names (Bhadrapada,
// Jyeshtha) that decide Janmashtami and Adhik Maas.
//
// So the engine has two separate error budgets, not one. Tithi dates are
// limited by the ephemeris alone (measured: ~20 s). Sankranti and month naming
// carry this file's error on top.
//
// ACCURACY. Anchored at the Swiss Ephemeris value for Lahiri, 22.460148° at
// 1900 January 0.5, and accumulated with Meeus' general precession in
// longitude. Checked against the Calendar Reform Committee's defining point —
// 23°15′00″ on 21 March 1956 — this gives 23°14′43″, so about 17″ low. At the
// Sun's rate of 1° per day, 20-30″ of ayanamsa error is 8-12 minutes in the
// timing of a Sankranti. That is immaterial for a date unless the ingress
// falls within a few minutes of midnight, which the report checks explicitly.

import { centuries } from './julian.js'

const T_1900 = centuries(2415020.0)

/** General precession in longitude since J2000, arcseconds. Meeus ch. 21. */
function precession(T) {
  return 5029.0966 * T + 1.11113 * T * T - 0.000006 * T * T * T
}

/** Lahiri ayanamsa in degrees at a given JDE. */
export function ayanamsa(jde) {
  const T = centuries(jde)
  return 22.460148 + (precession(T) - precession(T_1900)) / 3600
}

/** Tropical longitude to sidereal (nirayana). */
export function toSidereal(tropicalDegrees, jde) {
  const v = (tropicalDegrees - ayanamsa(jde)) % 360
  return v < 0 ? v + 360 : v
}
