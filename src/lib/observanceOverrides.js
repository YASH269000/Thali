// A family's own answers about their calendar, and the one place that stores them.
//
// Two things brought this about and they turned out to be the same thing.
//
// Five dates across 2026 and 2027 sit on a tithi boundary tight enough that
// shifting the whole tithi by a quarter of an hour — far more than the
// ephemeris could plausibly be wrong by — lands them on the adjacent day. The
// engine knows which five and says so; it cannot know which day a particular
// household keeps, because that is settled by their panchang and sometimes by
// their temple, not by astronomy.
//
// And every Islamic date is provisional by nature: the month begins when the
// crescent is sighted, locally. Eid al-Adha 2026 is the worked example —
// 27 May in Jammu & Kashmir and 28 May across the rest of India. One country,
// one year, two dates, and no calculation resolves it.
//
// So the app asks, and stores the answer here. This is the top of the
// precedence order — user override > curated > computed — and the safety valve
// for everything the other two cannot know.
//
// ONE SLOT PER OCCURRENCE, AND FOUR ANSWERS THAT EXCLUDE EACH OTHER.
//
// Everything is keyed `observanceId@YYYY-MM-DD`, and an entry is exactly one
// of confirmed / movedTo / removed / added. That is why a confirmation and a
// manual edit cannot disagree: they are not two mechanisms that have to be
// reconciled, they are two values of the same slot, and `setAnswer` replaces
// rather than merges. There is no path by which a stored entry can say both
// "the shipped date is right" and "we keep it two days later".

export const OVERRIDES_KEY = 'thali_observance_dates'

/** The key one answer is filed under: the observance, and the date it is about. */
export function overrideKey(observanceId, date) {
  return `${observanceId}@${date}`
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

export function loadOverrides() {
  try {
    const raw = window.localStorage.getItem(OVERRIDES_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? readOverrides(parsed)
      : {}
  } catch {
    // Storage can be unreadable — a private window, a quota, a corrupt value.
    // An unanswered question is the safe failure: the family sees it again
    // rather than living with a date they never agreed to.
    return {}
  }
}

export function saveOverrides(overrides) {
  try {
    window.localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides))
    return true
  } catch {
    return false
  }
}

/**
 * Validate a stored or transmitted override set down to the shape above.
 *
 * Shared by the browser and the two API endpoints, which is the point: this
 * arrives from localStorage or over the wire and decides whether today is a
 * fast, so one reader means the client and the server cannot disagree about
 * what a malformed entry means. Anything unrecognised is dropped rather than
 * half-applied.
 */
export function readOverrides(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  for (const [key, value] of Object.entries(raw).slice(0, 500)) {
    const at = key.lastIndexOf('@')
    if (at < 1 || !ISO.test(key.slice(at + 1))) continue
    if (!/^[a-z0-9_]+$/.test(key.slice(0, at))) continue
    if (!value || typeof value !== 'object') continue

    // Exactly one answer survives, in this order. A hand-edited entry naming
    // two of them resolves to the most specific rather than to both.
    let entry = null
    if (value.added === true) {
      entry = { added: true }
      if (typeof value.through === 'string' && ISO.test(value.through)) {
        entry.through = value.through
      }
    } else if (value.removed === true) {
      entry = { removed: true }
    } else if (typeof value.movedTo === 'string' && ISO.test(value.movedTo)) {
      entry = { movedTo: value.movedTo }
    } else if (value.confirmed === true) {
      entry = { confirmed: true }
    }
    if (entry) out[key] = entry
  }
  return out
}

/**
 * Write one answer, replacing whatever was in the slot.
 *
 * The single writer. Every helper below goes through it, so "replaces rather
 * than merges" is a property of the module and not of each caller remembering.
 */
export function setAnswer(overrides, observanceId, date, answer) {
  const next = { ...overrides }
  const clean = readOverrides({ [overrideKey(observanceId, date)]: answer })
  const key = overrideKey(observanceId, date)
  if (clean[key]) next[key] = clean[key]
  else delete next[key]
  return next
}

/**
 * Record that the shipped date was right.
 *
 * Kept as an explicit entry rather than as the absence of one, because
 * "confirmed" and "never asked" are different states and only one of them
 * should stop the question reappearing.
 */
export function confirmDate(overrides, observanceId, date) {
  return setAnswer(overrides, observanceId, date, { confirmed: true })
}

/** Record that the family keeps it on a different day. */
export function moveDate(overrides, observanceId, date, movedTo) {
  if (!ISO.test(String(movedTo))) return overrides
  if (movedTo === date) return confirmDate(overrides, observanceId, date)
  return setAnswer(overrides, observanceId, date, { movedTo })
}

/** Record that this occurrence is not one the family keeps. */
export function removeDate(overrides, observanceId, date) {
  return setAnswer(overrides, observanceId, date, { removed: true })
}

/**
 * Record a date the family keeps that nothing shipped.
 *
 * `resolvesTo` is every date the calendar already produces for this
 * observance once the other answers are applied. Adding a date that is
 * already covered would leave a second entry saying the same thing, which the
 * family could see once and delete once — so it is refused rather than
 * written. The relocated or shipped occurrence is the one that stands.
 */
export function addDate(overrides, observanceId, date, { through = null, resolvesTo = [] } = {}) {
  if (!ISO.test(String(date))) return overrides
  if (resolvesTo.includes(date)) return overrides
  const answer = { added: true }
  if (through && ISO.test(through) && through > date) answer.through = through
  return setAnswer(overrides, observanceId, date, answer)
}

/** Withdraw an answer, so the shipped date stands again and the question returns. */
export function clearOverride(overrides, observanceId, date) {
  const next = { ...overrides }
  delete next[overrideKey(observanceId, date)]
  return next
}

/** The answer filed against one occurrence, if any. */
export function answerFor(overrides, observanceId, date) {
  return (overrides || {})[overrideKey(observanceId, date)] || null
}

/** Every date this family added for one observance. */
export function addedDatesFor(overrides, observanceId) {
  return Object.entries(overrides || {})
    .filter(([key, v]) => v?.added && key.startsWith(`${observanceId}@`))
    .map(([key, v]) => ({ date: key.slice(key.lastIndexOf('@') + 1), through: v.through || null }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** The day either side of an ISO date, which is the only choice a prompt offers. */
export function neighbouringDates(date) {
  const shift = (days) => {
    const d = new Date(`${date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }
  return { previous: shift(-1), next: shift(1) }
}
