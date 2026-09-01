// Lunar months, and the leap month that makes 2026 contested.
//
// THE RULE. A lunar month here is amanta: new moon to new moon. Each is named
// after the solar sign the Sun enters during it — the Sun entering Mesha names
// that month Chaitra, Kanya names Bhadrapada, and so on. Because twelve lunar
// months are about eleven days shorter than the solar year, the two drift, and
// roughly every 32.5 months a lunar month contains NO sankranti at all.
//
// That month is Adhika Maasa: an intercalary month inserted to bring the lunar
// year back into step. It takes the name of the month that follows it, with
// the prefix Adhika, and the following month is then called Nija ("proper").
// The rarer opposite — a lunar month containing TWO sankrantis — is Kshaya,
// and is reported here rather than silently absorbed.
//
// This is why an Adhik Maas year has 26 Ekadashis instead of 24: the extra
// month carries its own pair, named Padmini (shukla) and Parama (krishna).

import { moonPosition, nutation, sunPosition } from './ephemeris.js'
import { solveElongation } from './tithi.js'
import { toSidereal } from './ayanamsa.js'

export const MASA_NAMES = [
  'Chaitra', 'Vaishakha', 'Jyeshtha', 'Ashadha', 'Shravana', 'Bhadrapada',
  'Ashwin', 'Kartika', 'Margashirsha', 'Pausha', 'Magha', 'Phalguna',
]

export const RASHI_NAMES = [
  'Mesha', 'Vrishabha', 'Mithuna', 'Karka', 'Simha', 'Kanya',
  'Tula', 'Vrischika', 'Dhanu', 'Makara', 'Kumbha', 'Meena',
]

/** Sun's apparent sidereal longitude, degrees. */
export function sunSidereal(jde) {
  return toSidereal(sunPosition(jde).apparent, jde)
}

/** Moon's apparent sidereal longitude, degrees. */
export function moonSidereal(jde) {
  const { dPsi } = nutation(jde)
  return toSidereal(moonPosition(jde).longitude + dPsi, jde)
}

/**
 * The instant the Sun's sidereal longitude reaches `target` degrees.
 * The Sun moves about 1°/day, so this converges in a handful of steps.
 */
export function solveSunSidereal(target, jdeGuess) {
  let t = jdeGuess
  for (let i = 0; i < 60; i += 1) {
    let f = (sunSidereal(t) - target) % 360
    if (f > 180) f -= 360
    if (f < -180) f += 360
    if (Math.abs(f) < 1e-9) break
    const h = 0.05
    let r = (sunSidereal(t + h) - sunSidereal(t - h)) % 360
    if (r > 180) r -= 360
    if (r < -180) r += 360
    t -= f / (r / (2 * h))
  }
  return t
}

/** Every sankranti (solar ingress) in a JDE range. */
export function sankrantis(jdeStart, jdeEnd) {
  const out = []
  const startRashi = Math.floor(sunSidereal(jdeStart) / 30)
  for (let i = 0; i < 40; i += 1) {
    const rashi = (startRashi + i + 1) % 12
    // The Sun takes ~30 days per sign; guess forward from the previous find.
    const guess = (out.length ? out[out.length - 1].jde : jdeStart) + 30
    const jde = solveSunSidereal(rashi * 30, guess)
    if (jde > jdeEnd) break
    if (jde >= jdeStart) out.push({ rashi, name: RASHI_NAMES[rashi], jde })
  }
  return out
}

/** Every new moon (elongation 0) in a JDE range. */
export function newMoons(jdeStart, jdeEnd) {
  const out = []
  let guess = jdeStart
  // Step back one lunation so the first month is complete.
  let jde = solveElongation(0, guess - 29.53)
  while (jde < jdeEnd + 29.53) {
    if (jde >= jdeStart - 29.53) out.push(jde)
    guess = jde + 29.53
    jde = solveElongation(0, guess)
  }
  return out
}

/**
 * The lunar months covering a range, each named and marked.
 *
 * @returns {Array<{ start, end, name, adhika, nija, kshaya, sankrantis }>}
 */
export function lunarMonths(jdeStart, jdeEnd) {
  const moons = newMoons(jdeStart - 40, jdeEnd + 40)
  const ingresses = sankrantis(jdeStart - 70, jdeEnd + 70)

  const months = []
  for (let i = 0; i < moons.length - 1; i += 1) {
    const start = moons[i]
    const end = moons[i + 1]
    const inside = ingresses.filter((s) => s.jde >= start && s.jde < end)
    months.push({ start, end, sankrantis: inside })
  }

  // Name them. A month with one sankranti is named by it; a month with none
  // borrows the NEXT named month's name, which is why naming has to run after
  // every month's sankranti count is known.
  for (let i = 0; i < months.length; i += 1) {
    const m = months[i]
    m.kshaya = m.sankrantis.length > 1
    if (m.sankrantis.length >= 1) {
      // Sun entering Mesha (rashi 0) names the month Chaitra (index 0).
      m.name = MASA_NAMES[m.sankrantis[0].rashi]
      m.adhika = false
    } else {
      m.adhika = true
      m.name = null
    }
  }
  for (let i = 0; i < months.length; i += 1) {
    if (!months[i].adhika) continue
    const next = months.slice(i + 1).find((m) => !m.adhika)
    months[i].name = next ? next.name : null
    if (next) next.nija = true
  }
  return months.filter((m) => m.end > jdeStart && m.start < jdeEnd)
}

/** "Adhika Jyeshtha" / "Nija Jyeshtha" / "Bhadrapada". */
export function masaLabel(month) {
  if (!month.name) return 'unnamed'
  if (month.adhika) return `Adhika ${month.name}`
  if (month.nija) return `Nija ${month.name}`
  return month.name
}
