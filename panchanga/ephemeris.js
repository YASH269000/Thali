// Solar and lunar positions.
//
// Meeus, *Astronomical Algorithms* (2nd ed.): the Moon from chapter 47
// (ELP-2000/82 truncated to 60 periodic terms per coordinate), the Sun from
// chapter 25, nutation from chapter 22.
//
// WHY THIS IS ACCURATE ENOUGH, AND WHERE IT IS NOT
//
// A tithi is 12° of elongation (Moon − Sun). The elongation grows at about
// 12.19°/day, so one arcminute of error in the difference is roughly two
// minutes of clock time at a tithi boundary. What matters is therefore the
// error in the DIFFERENCE, not in either body alone.
//
// Two large error sources cancel exactly in that difference and are carried
// only because other outputs need them:
//
//   nutation  — shifts both longitudes by the same Δψ.
//   ayanamsa  — a constant offset applied to both.
//
// So tithi timing depends on the ephemeris alone. Measured against Meeus'
// independent chapter-49 phase series, this pair agrees to within a few
// seconds of time at new and full moon: see test/panchanga-ephemeris.test.js
// and docs/CALENDAR-VERIFICATION.md.
//
// Solar longitude here is chapter 25's moderate-precision form, stated by
// Meeus as 0.01° (36″). That is the weaker half of the pair and it is a real
// limit: 36″ of solar error is about 70 seconds of tithi-boundary time. It is
// well inside the margin that decides a date except when a boundary falls
// within a couple of minutes of sunrise, which is why the engine reports its
// margin for every date rather than asking anyone to trust this number.

import { centuries } from './julian.js'

const DEG = Math.PI / 180
const sin = (d) => Math.sin(d * DEG)
const cos = (d) => Math.cos(d * DEG)

/** Fold to [0, 360). */
export function norm360(x) {
  const r = x % 360
  return r < 0 ? r + 360 : r
}

/** Fold to (-180, 180]. */
export function norm180(x) {
  const r = norm360(x)
  return r > 180 ? r - 360 : r
}

/* ---- Moon: Meeus table 47.A (longitude, distance) ------------------ */
// Columns: D, M, M', F, coefficient of Σl (1e-6 deg), coefficient of Σr (1e-3 km)
const MOON_LR = [
  [0, 0, 1, 0, 6288774, -20905355], [2, 0, -1, 0, 1274027, -3699111],
  [2, 0, 0, 0, 658314, -2955968], [0, 0, 2, 0, 213618, -569925],
  [0, 1, 0, 0, -185116, 48888], [0, 0, 0, 2, -114332, -3149],
  [2, 0, -2, 0, 58793, 246158], [2, -1, -1, 0, 57066, -152138],
  [2, 0, 1, 0, 53322, -170733], [2, -1, 0, 0, 45758, -204586],
  [0, 1, -1, 0, -40923, -129620], [1, 0, 0, 0, -34720, 108743],
  [0, 1, 1, 0, -30383, 104755], [2, 0, 0, -2, 15327, 10321],
  [0, 0, 1, 2, -12528, 0], [0, 0, 1, -2, 10980, 79661],
  [4, 0, -1, 0, 10675, -34782], [0, 0, 3, 0, 10034, -23210],
  [4, 0, -2, 0, 8548, -21636], [2, 1, -1, 0, -7888, 24208],
  [2, 1, 0, 0, -6766, 30824], [1, 0, -1, 0, -5163, -8379],
  [1, 1, 0, 0, 4987, -16675], [2, -1, 1, 0, 4036, -12831],
  [2, 0, 2, 0, 3994, -10445], [4, 0, 0, 0, 3861, -11650],
  [2, 0, -3, 0, 3665, 14403], [0, 1, -2, 0, -2689, -7003],
  [2, 0, -1, 2, -2602, 0], [2, -1, -2, 0, 2390, 10056],
  [1, 0, 1, 0, -2348, 6322], [2, -2, 0, 0, 2236, -9884],
  [0, 1, 2, 0, -2120, 5751], [0, 2, 0, 0, -2069, 0],
  [2, -2, -1, 0, 2048, -4950], [2, 0, 1, -2, -1773, 4130],
  [2, 0, 0, 2, -1595, 0], [4, -1, -1, 0, 1215, -3958],
  [0, 0, 2, 2, -1110, 0], [3, 0, -1, 0, -892, 3258],
  [2, 1, 1, 0, -810, 2616], [4, -1, -2, 0, 759, -1897],
  [0, 2, -1, 0, -713, -2117], [2, 2, -1, 0, -700, 2354],
  [2, 1, -2, 0, 691, 0], [2, -1, 0, -2, 596, 0],
  [4, 0, 1, 0, 549, -1423], [0, 0, 4, 0, 537, -1117],
  [4, -1, 0, 0, 520, -1571], [1, 0, -2, 0, -487, -1739],
  [2, 1, 0, -2, -399, 0], [0, 0, 2, -2, -381, -4421],
  [1, 1, 1, 0, 351, 0], [3, 0, -2, 0, -340, 0],
  [4, 0, -3, 0, 330, 0], [2, -1, 2, 0, 327, 0],
  [0, 2, 1, 0, -323, 1165], [1, 1, -1, 0, 299, 0],
  [2, 0, 3, 0, 294, 0], [2, 0, -1, -2, 0, 8752],
]

/** Meeus table 47.B (latitude). Columns: D, M, M', F, coefficient of Σb. */
const MOON_B = [
  [0, 0, 0, 1, 5128122], [0, 0, 1, 1, 280602], [0, 0, 1, -1, 277693],
  [2, 0, 0, -1, 173237], [2, 0, -1, 1, 55413], [2, 0, -1, -1, 46271],
  [2, 0, 0, 1, 32573], [0, 0, 2, 1, 17198], [2, 0, 1, -1, 9266],
  [0, 0, 2, -1, 8822], [2, -1, 0, -1, 8216], [2, 0, -2, -1, 4324],
  [2, 0, 1, 1, 4200], [2, 1, 0, -1, -3359], [2, -1, -1, 1, 2463],
  [2, -1, 0, 1, 2211], [2, -1, -1, -1, 2065], [0, 1, -1, -1, -1870],
  [4, 0, -1, -1, 1828], [0, 1, 0, 1, -1794], [0, 0, 0, 3, -1749],
  [0, 1, -1, 1, -1565], [1, 0, 0, 1, -1491], [0, 1, 1, 1, -1475],
  [0, 1, 1, -1, -1410], [0, 1, 0, -1, -1344], [1, 0, 0, -1, -1335],
  [0, 0, 3, 1, 1107], [4, 0, 0, -1, 1021], [4, 0, -1, 1, 833],
  [0, 0, 1, -3, 777], [4, 0, -2, 1, 671], [2, 0, 0, -3, 607],
  [2, 0, 2, -1, 596], [2, -1, 1, -1, 491], [2, 0, -2, 1, -451],
  [0, 0, 3, -1, 439], [2, 0, 2, 1, 422], [2, 0, -3, -1, 421],
  [2, 1, -1, 1, -366], [2, 1, 0, 1, -351], [4, 0, 0, 1, 331],
  [2, -1, 1, 1, 315], [2, -2, 0, -1, 302], [0, 0, 1, 3, -283],
  [2, 1, 1, -1, -229], [1, 1, 0, -1, 223], [1, 1, 0, 1, 223],
  [0, 1, -2, -1, -220], [2, 1, -1, -1, -220], [1, 0, 1, 1, -185],
  [2, -1, -2, -1, 181], [0, 1, 2, 1, -177], [4, 0, -2, -1, 176],
  [4, -1, -1, -1, 166], [1, 0, 1, -1, -164], [4, 0, 1, -1, 132],
  [1, 0, -1, -1, -119], [4, -1, 0, -1, 115], [2, -2, 0, 1, 107],
]

/**
 * Geocentric position of the Moon, mean equinox of date.
 * @param {number} jde Julian Ephemeris Day (TT)
 * @returns {{ longitude, latitude, distance }} degrees, degrees, km
 */
export function moonPosition(jde) {
  const T = centuries(jde)
  const T2 = T * T
  const T3 = T2 * T
  const T4 = T3 * T

  const Lp = norm360(218.3164477 + 481267.88123421 * T - 0.0015786 * T2
    + T3 / 538841 - T4 / 65194000)
  const D = norm360(297.8501921 + 445267.1114034 * T - 0.0018819 * T2
    + T3 / 545868 - T4 / 113065000)
  const M = norm360(357.5291092 + 35999.0502909 * T - 0.0001536 * T2 + T3 / 24490000)
  const Mp = norm360(134.9633964 + 477198.8675055 * T + 0.0087414 * T2
    + T3 / 69699 - T4 / 14712000)
  const F = norm360(93.2720950 + 483202.0175233 * T - 0.0036539 * T2
    - T3 / 3526000 + T4 / 863310000)

  const A1 = norm360(119.75 + 131.849 * T)
  const A2 = norm360(53.09 + 479264.290 * T)
  const A3 = norm360(313.45 + 481266.484 * T)

  // The Sun's eccentricity changes slowly; terms in M are scaled by it.
  const E = 1 - 0.002516 * T - 0.0000074 * T2

  let sumL = 0
  let sumR = 0
  for (const [d, m, mp, f, cl, cr] of MOON_LR) {
    const arg = d * D + m * M + mp * Mp + f * F
    const e = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E * E)
    sumL += cl * e * sin(arg)
    sumR += cr * e * cos(arg)
  }
  let sumB = 0
  for (const [d, m, mp, f, cb] of MOON_B) {
    const arg = d * D + m * M + mp * Mp + f * F
    const e = m === 0 ? 1 : (Math.abs(m) === 1 ? E : E * E)
    sumB += cb * e * sin(arg)
  }

  sumL += 3958 * sin(A1) + 1962 * sin(Lp - F) + 318 * sin(A2)
  sumB += -2235 * sin(Lp) + 382 * sin(A3) + 175 * sin(A1 - F) + 175 * sin(A1 + F)
    + 127 * sin(Lp - Mp) - 115 * sin(Lp + Mp)

  return {
    longitude: norm360(Lp + sumL / 1000000),
    latitude: sumB / 1000000,
    distance: 385000.56 + sumR / 1000,
  }
}

/**
 * Nutation in longitude and obliquity, in degrees. Meeus ch. 22, short form
 * (about 0.5″). Carried for Sankranti and rise/set; it cancels in a tithi.
 */
export function nutation(jde) {
  const T = centuries(jde)
  const omega = norm360(125.04452 - 1934.136261 * T)
  const L = norm360(280.4665 + 36000.7698 * T)
  const Lp = norm360(218.3165 + 481267.8813 * T)
  const dPsi = (-17.20 * sin(omega) - 1.32 * sin(2 * L)
    - 0.23 * sin(2 * Lp) + 0.21 * sin(2 * omega)) / 3600
  const dEps = (9.20 * cos(omega) + 0.57 * cos(2 * L)
    + 0.10 * cos(2 * Lp) - 0.09 * cos(2 * omega)) / 3600
  return { dPsi, dEps }
}

/** Mean obliquity of the ecliptic, degrees. Meeus 22.2. */
export function meanObliquity(jde) {
  const T = centuries(jde)
  return 23 + 26 / 60 + 21.448 / 3600
    - (46.8150 * T + 0.00059 * T * T - 0.001813 * T * T * T) / 3600
}

/**
 * Geometric and apparent position of the Sun. Meeus ch. 25, moderate accuracy.
 *
 * The radius vector is deliberately not returned: nothing here needs it, and
 * it is the one quantity in this file not checked against a worked example.
 *
 * @returns {{ longitude, apparent, meanAnomaly }} degrees
 */
export function sunPosition(jde) {
  const T = centuries(jde)
  const T2 = T * T

  const L0 = norm360(280.46646 + 36000.76983 * T + 0.0003032 * T2)
  const M = norm360(357.52911 + 35999.05029 * T - 0.0001537 * T2)
  const C = (1.914602 - 0.004817 * T - 0.000014 * T2) * sin(M)
    + (0.019993 - 0.000101 * T) * sin(2 * M)
    + 0.000289 * sin(3 * M)

  const trueLong = L0 + C

  // Apparent longitude: referred to the true equinox, and corrected for
  // aberration, which is what an observer actually sees.
  const omega = norm360(125.04 - 1934.136 * T)
  const apparent = trueLong - 0.00569 - 0.00478 * sin(omega)

  return {
    longitude: norm360(trueLong),
    apparent: norm360(apparent),
    meanAnomaly: M,
  }
}

/**
 * Elongation of the Moon from the Sun, 0–360°. This is the quantity the whole
 * Hindu calendar rests on: tithi = floor(elongation / 12).
 *
 * APPARENT, not geometric, and the difference is not academic. The Sun's
 * light reaches us from where it was 8.3 minutes ago, which displaces its
 * apparent longitude by 20.5″ of aberration. On a quantity growing at 12.19°
 * per day that is 40 seconds of time at every tithi boundary — and measured
 * against Meeus' independent chapter-49 phase series, applying it moves the
 * mean error from 59 s to 20 s. It is the single largest correction in this
 * file.
 *
 * Nutation is applied to both bodies and therefore cancels; it is written out
 * rather than dropped so that the cancellation is visible instead of implied.
 * Ayanamsa cancels the same way, which is why a tithi needs no sidereal
 * conversion while a Sankranti does.
 */
export function elongation(jde) {
  const { dPsi } = nutation(jde)
  const moon = moonPosition(jde).longitude + dPsi
  const sun = sunPosition(jde).apparent
  return norm360(moon - sun)
}
