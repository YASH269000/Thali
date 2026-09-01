// Easter, and the Lenten dates derived from it.
//
// Closed form and exact: the Gregorian computus is arithmetic, not astronomy.
// It uses a fixed lunar cycle rather than the real Moon, so unlike the Hindu
// and Islamic calculations here there is no ephemeris error to characterise —
// the answer is either right or the arithmetic is wrong.

import { fromJD, toJD } from './julian.js'

/**
 * Gregorian Easter Sunday. The anonymous algorithm as given by Meeus (ch. 8),
 * which he attributes to Butcher's Ecclesiastical Calendar (1876).
 *
 * @returns {{ year, month, day }}
 */
export function easter(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const n = Math.floor((h + l - 7 * m + 114) / 31)
  const p = (h + l - 7 * m + 114) % 31
  return { year, month: n, day: p + 1 }
}

function shift({ year, month, day }, days) {
  const { year: y, month: m, day: d } = fromJD(toJD(year, month, day) + days)
  return { year: y, month: m, day: d }
}

/**
 * The dates a Christian household plans food around.
 *
 * Ash Wednesday is 46 days before Easter — 40 fasting days plus the six
 * Sundays, which are not fast days. Lent runs from Ash Wednesday to the
 * Saturday before Easter.
 */
export function christianDates(year) {
  const e = easter(year)
  return {
    ashWednesday: shift(e, -46),
    lentStart: shift(e, -46),
    lentEnd: shift(e, -1),
    palmSunday: shift(e, -7),
    maundyThursday: shift(e, -3),
    goodFriday: shift(e, -2),
    holySaturday: shift(e, -1),
    easter: e,
    ascension: shift(e, 39),
    pentecost: shift(e, 49),
  }
}
