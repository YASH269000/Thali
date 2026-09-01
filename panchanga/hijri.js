// Arithmetic Hijri dates — for PLANNING ONLY.
//
// READ THIS BEFORE USING ANY DATE FROM THIS FILE.
//
// The Islamic calendar as observed is not calculated, it is sighted. A month
// begins when the new crescent is actually seen, so the same month can begin
// on different days in different places, and the decision is not knowable in
// advance. This file implements the tabular Hijri calendar — a fixed 30-year
// cycle of 11 leap years — which is a planning convenience and nothing more.
//
// The difference is not hypothetical and not always small. Eid al-Adha 2026
// was kept on 27 May in Jammu & Kashmir and on 28 May across the rest of
// India: one country, one year, two dates. An engine that prints a single
// date for that is wrong in a way no amount of arithmetic precision fixes.
//
// So every value returned here carries `provisional: true` and an explicit
// ±1 day window, and callers are expected to show that rather than a date.
// The tabular calendar also differs from Saudi Arabia's Umm al-Qura — which
// is itself calculated, not sighted — by a day or two in some years; these
// outputs should not be described as Umm al-Qura.

const ISLAMIC_EPOCH = 1948440

export const HIJRI_MONTHS = [
  'Muharram', 'Safar', 'Rabi al-Awwal', 'Rabi al-Thani', 'Jumada al-Ula',
  'Jumada al-Akhirah', 'Rajab', "Sha'ban", 'Ramadan', 'Shawwal',
  'Dhu al-Qadah', 'Dhu al-Hijjah',
]

/** Hijri date to Julian Day (civil tabular reckoning). */
export function hijriToJD(year, month, day) {
  return Math.floor((11 * year + 3) / 30)
    + 354 * year + 30 * month
    - Math.floor((month - 1) / 2)
    + day + ISLAMIC_EPOCH - 385
}

/** Julian Day to a tabular Hijri date. */
export function jdToHijri(jd) {
  let l = Math.floor(jd) - ISLAMIC_EPOCH + 10632
  const n = Math.floor((l - 1) / 10631)
  l = l - 10631 * n + 354
  const j = Math.floor((10985 - l) / 5316) * Math.floor((50 * l) / 17719)
    + Math.floor(l / 5670) * Math.floor((43 * l) / 15238)
  l = l - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50)
    - Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29
  const month = Math.floor((24 * l) / 709)
  const day = l - Math.floor((709 * month) / 24)
  const year = 30 * n + j - 30
  return { year, month, day }
}

/**
 * The observances a Muslim household plans food around, for a Gregorian year.
 *
 * Every entry is provisional. `window` gives the range the day may actually
 * fall in once the month is declared locally.
 */
export function islamicObservances(gregorianYear, jdOfIso) {
  const out = []
  // Two Hijri years can overlap one Gregorian year.
  const approxHijri = Math.floor((gregorianYear - 622) * (33 / 32))
  for (const h of [approxHijri - 1, approxHijri, approxHijri + 1]) {
    const add = (month, day, id, name, extra = {}) => {
      const jd = hijriToJD(h, month, day)
      out.push({
        id, name, jd, hijriYear: h,
        hijri: `${day} ${HIJRI_MONTHS[month - 1]} ${h}`,
        provisional: true,
        window: '±1 day — the month begins on local sighting',
        ...extra,
      })
    }
    add(9, 1, 'ramadan_start', 'Ramadan begins',
      { note: 'Thirty days of dawn-to-sunset fasting follow; suhoor and iftar times come from sunrise and sunset.' })
    add(10, 1, 'eid_al_fitr', 'Eid al-Fitr')
    add(12, 9, 'arafah', 'Day of Arafah')
    // The note belongs to 1447 specifically. Repeating a worked example of a
    // past disagreement on every future year would state it as a prediction.
    add(12, 10, 'eid_al_adha', 'Eid al-Adha', h === 1447
      ? { note: 'Kept on different days within India — 27 May in J&K, 28 May elsewhere.' }
      : {})
    add(1, 10, 'ashura', 'Ashura')
  }
  void jdOfIso
  return out
}
