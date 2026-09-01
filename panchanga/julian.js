// Julian Day conversions and the TT/UT offset.
//
// Everything else in this module speaks Julian Day. Two flavours matter and
// conflating them is the classic panchanga bug:
//
//   JD (UT)  — what clocks and sunrise tables use.
//   JDE (TT) — what ephemeris series are expressed in.
//
// They differ by ΔT, about 69 seconds in 2026. That is small but not nothing:
// the Moon moves 0.55 arcsec per second of time, so 69 s is 38 arcsec of lunar
// longitude — larger than the ephemeris error itself.

/** Gregorian calendar date (UTC) to Julian Day. Meeus, ch. 7. */
export function toJD(year, month, day, hour = 0, minute = 0, second = 0) {
  let y = year
  let m = month
  if (m <= 2) { y -= 1; m += 12 }
  const a = Math.floor(y / 100)
  const b = 2 - a + Math.floor(a / 4)
  const dayFraction = (hour + minute / 60 + second / 3600) / 24
  return Math.floor(365.25 * (y + 4716))
    + Math.floor(30.6001 * (m + 1))
    + day + dayFraction + b - 1524.5
}

/** Julian Day to a Gregorian date, as { year, month, day, hour, minute, second }. */
export function fromJD(jd) {
  const z = Math.floor(jd + 0.5)
  const f = jd + 0.5 - z
  let a = z
  if (z >= 2299161) {
    const alpha = Math.floor((z - 1867216.25) / 36524.25)
    a = z + 1 + alpha - Math.floor(alpha / 4)
  }
  const b = a + 1524
  const c = Math.floor((b - 122.1) / 365.25)
  const d = Math.floor(365.25 * c)
  const e = Math.floor((b - d) / 30.6001)

  const dayWithFraction = b - d - Math.floor(30.6001 * e) + f
  const day = Math.floor(dayWithFraction)
  const month = e < 14 ? e - 1 : e - 13
  const year = month > 2 ? c - 4716 : c - 4715

  let rest = (dayWithFraction - day) * 24
  const hour = Math.floor(rest)
  rest = (rest - hour) * 60
  const minute = Math.floor(rest)
  const second = (rest - minute) * 60
  return { year, month, day, hour, minute, second }
}

/** Julian centuries of 36525 days from J2000.0. */
export function centuries(jd) {
  return (jd - 2451545.0) / 36525
}

/**
 * ΔT = TT − UT, in seconds.
 *
 * Espenak & Meeus, valid 2005–2050. It is a fit made before the Earth's
 * rotation sped up in the 2020s, so it runs high: it gives 75.1 s for 2026
 * against an observed value near 69 s. That 6 s overestimate is worth stating
 * because it is a systematic shift, not noise — but it moves a tithi boundary
 * by about 6 seconds of time, which is two orders of magnitude below the
 * quarter-hour margin that decides a date. See docs/CALENDAR-VERIFICATION.md.
 */
export function deltaT(year) {
  const t = year - 2000
  return 62.92 + 0.32217 * t + 0.005589 * t * t
}

/** JD in UT to JDE in TT. */
export function jdToJde(jd) {
  const { year } = fromJD(jd)
  return jd + deltaT(year) / 86400
}

/** JDE in TT back to JD in UT. */
export function jdeToJd(jde) {
  const { year } = fromJD(jde)
  return jde - deltaT(year) / 86400
}

/** 0 = Sunday. */
export function weekdayOf(jd) {
  return Math.floor(jd + 1.5) % 7
}

/** "2026-05-27" from a JD, in the given whole-hour-or-fractional UTC offset. */
export function isoDateAt(jd, tzOffsetHours) {
  const { year, month, day } = fromJD(jd + tzOffsetHours / 24)
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** "2026-05-27" to the JD of local midnight at the given offset. */
export function isoToJD(iso, tzOffsetHours = 0) {
  const [y, m, d] = iso.split('-').map(Number)
  return toJD(y, m, d) - tzOffsetHours / 24
}
