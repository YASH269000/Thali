// Sunrise, sunset and moonrise for a location.
//
// The panchanga needs these for two different reasons. Sunrise decides which
// calendar day a tithi belongs to — the tithi running at sunrise is that day's
// tithi — and sunset and moonrise decide when several fasts actually end:
// Pradosh is a twilight window after sunset, Sankashti Chaturthi is broken at
// moonrise, and a Ramadan fast runs sunrise to sunset.
//
// Rather than Meeus' interpolation method (ch. 15), this searches directly for
// the moment the body's altitude crosses the horizon: scan in coarse steps to
// bracket the crossing, then bisect. It is a few hundred position evaluations
// per event instead of a dozen, which costs nothing at this scale, and it has
// no special cases to get wrong — the same code handles the Moon, whose
// motion breaks the interpolation method's assumptions, and it degrades
// honestly at high latitude by simply finding no crossing.

import { centuries, jdToJde } from './julian.js'
import { meanObliquity, moonPosition, norm360, nutation, sunPosition } from './ephemeris.js'

const DEG = Math.PI / 180
const sin = (d) => Math.sin(d * DEG)
const cos = (d) => Math.cos(d * DEG)
const asin = (x) => Math.asin(Math.max(-1, Math.min(1, x))) / DEG

/**
 * Standard altitude of the upper limb at rise and set.
 *
 * −0.8333° for the Sun: 16′ of semi-diameter plus 34′ of mean atmospheric
 * refraction. Refraction is the larger term and the less certain one — it
 * varies with temperature and pressure, so a sunrise from any almanac is
 * good to about a minute regardless of how well the Sun's position is known.
 * That uncertainty, not the ephemeris, is the floor on tithi-at-sunrise.
 */
const SUN_H0 = -0.8333

/** Apparent sidereal time at Greenwich, degrees. Meeus 12.4. */
function greenwichSiderealTime(jd) {
  const T = centuries(jd)
  const theta0 = 280.46061837 + 360.98564736629 * (jd - 2451545.0)
    + 0.000387933 * T * T - (T * T * T) / 38710000
  const jde = jdToJde(jd)
  const { dPsi, dEps } = nutation(jde)
  const eps = meanObliquity(jde) + dEps
  return norm360(theta0 + dPsi * cos(eps))
}

/** Ecliptic longitude/latitude to right ascension and declination. */
function toEquatorial(lambda, beta, eps) {
  const ra = Math.atan2(
    sin(lambda) * cos(eps) - Math.tan(beta * DEG) * sin(eps),
    cos(lambda),
  ) / DEG
  const dec = asin(sin(beta) * cos(eps) + cos(beta) * sin(eps) * sin(lambda))
  return { ra: norm360(ra), dec }
}

/** Altitude of the Sun, degrees, at a UT Julian Day. */
export function sunAltitude(jd, lat, lon) {
  const jde = jdToJde(jd)
  const { dEps } = nutation(jde)
  const eps = meanObliquity(jde) + dEps
  const { apparent } = sunPosition(jde)
  const { ra, dec } = toEquatorial(apparent, 0, eps)
  const H = norm360(greenwichSiderealTime(jd) + lon - ra)
  return asin(sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(H))
}

/**
 * Altitude of the Moon's centre, degrees, geocentric.
 *
 * Rise and set use a horizon lowered by the Moon's own horizontal parallax
 * (about 57′, and it varies by 6′ over a month) rather than a topocentric
 * position — Meeus' h0 = 0.7275π − 34′. That is worth a minute or two at
 * moonrise, which is the same order as the refraction uncertainty above.
 */
export function moonAltitude(jd, lat, lon) {
  const jde = jdToJde(jd)
  const { dEps } = nutation(jde)
  const eps = meanObliquity(jde) + dEps
  const { longitude, latitude, distance } = moonPosition(jde)
  const { ra, dec } = toEquatorial(longitude, latitude, eps)
  const H = norm360(greenwichSiderealTime(jd) + lon - ra)
  const alt = asin(sin(lat) * sin(dec) + cos(lat) * cos(dec) * cos(H))
  const parallax = asin(6378.14 / distance)
  return { altitude: alt, h0: 0.7275 * parallax - 0.5667 }
}

/**
 * The JD at which `altitudeOf` crosses `targetOf` in the given direction.
 *
 * @param {number} jdStart  search from here
 * @param {number} hours    how far to search
 * @param {function} alt    jd -> { altitude, h0 }
 * @param {number} rising   +1 for a rising crossing, -1 for setting
 * @returns {number|null}   null when the body does not cross at all
 */
function findCrossing(jdStart, hours, alt, rising) {
  const step = 10 / 1440 // ten minutes
  const n = Math.ceil((hours / 24) / step)
  let prev = alt(jdStart)
  let prevDiff = prev.altitude - prev.h0

  for (let i = 1; i <= n; i += 1) {
    const jd = jdStart + i * step
    const cur = alt(jd)
    const diff = cur.altitude - cur.h0
    if (prevDiff * diff < 0 && Math.sign(diff - prevDiff) === rising) {
      // Bracketed. Bisect to a second.
      let lo = jd - step
      let hi = jd
      for (let k = 0; k < 40; k += 1) {
        const mid = (lo + hi) / 2
        const m = alt(mid)
        const md = m.altitude - m.h0
        if (md * prevDiff < 0) hi = mid
        else { lo = mid; prevDiff = md }
        if (hi - lo < 1 / 86400) break
      }
      return (lo + hi) / 2
    }
    prevDiff = diff
  }
  return null
}

/**
 * Sunrise and sunset for a local calendar day.
 *
 * @param {number} jdLocalMidnight JD of 00:00 local time
 * @param {{lat, lon, tz}} place
 * @returns {{ sunrise: number|null, sunset: number|null }} JD (UT)
 */
export function sunRiseSet(jdLocalMidnight, place) {
  const alt = (jd) => ({ altitude: sunAltitude(jd, place.lat, place.lon), h0: SUN_H0 })
  return {
    sunrise: findCrossing(jdLocalMidnight, 24, alt, 1),
    sunset: findCrossing(jdLocalMidnight, 24, alt, -1),
  }
}

/** Moonrise for a local calendar day, or null if the Moon does not rise. */
export function moonRise(jdLocalMidnight, place) {
  const alt = (jd) => moonAltitude(jd, place.lat, place.lon)
  return findCrossing(jdLocalMidnight, 24, alt, 1)
}

/**
 * Fajr and Maghrib — the ends of a Ramadan fasting day.
 *
 * Maghrib IS sunset; there is no separate calculation and no convention to
 * choose. Fajr is the moment the Sun reaches a stated depression below the
 * horizon, and the stated angle is a convention rather than a fact:
 *
 *   18 deg    Umm al-Qura, Muslim World League, and the majority standard
 *   15 deg    ISNA, mostly North America
 *   19.5 deg  Egyptian General Authority
 *
 * Eighteen is the default because it is the most widely used, not because the
 * others are wrong — the spread is ten to fifteen minutes in Delhi in
 * February, which is enough to matter when it decides the end of suhoor. The
 * angle is a parameter and the app prints which one it used, the same way it
 * prints the city beside the time. See docs/DATA-ISSUES.md.
 *
 * The reuse is the point: this is `findCrossing` against a target altitude,
 * which is exactly what sunrise already is with a different number.
 *
 * @returns {{ fajr: number|null, maghrib: number|null, angle: number }}
 */
export const FAJR_ANGLE = 18

export function fajrMaghrib(jdLocalMidnight, place, angle = FAJR_ANGLE) {
  const dawn = (jd) => ({ altitude: sunAltitude(jd, place.lat, place.lon), h0: -angle })
  const day = (jd) => ({ altitude: sunAltitude(jd, place.lat, place.lon), h0: SUN_H0 })
  return {
    fajr: findCrossing(jdLocalMidnight, 24, dawn, 1),
    // Named separately from sunset because it is a different question with the
    // same answer, and a reader should not have to know that to find it.
    maghrib: findCrossing(jdLocalMidnight, 24, day, -1),
    angle,
  }
}

/** Moonset for a local calendar day, or null. */
export function moonSet(jdLocalMidnight, place) {
  const alt = (jd) => moonAltitude(jd, place.lat, place.lon)
  return findCrossing(jdLocalMidnight, 24, alt, -1)
}
