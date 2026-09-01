// A family's own answers about their calendar, and the one place that stores them.
//
// Five dates across 2026 and 2027 sit on a tithi boundary tight enough that
// shifting the whole tithi by a quarter of an hour — far more than the
// ephemeris could plausibly be wrong by — lands them on the adjacent day.
// The engine knows which five and says so; it cannot know which day a
// particular household keeps, because that is settled by their panchang and
// sometimes by their temple, not by astronomy.
//
// So the app asks, and stores the answer here. An override outranks both the
// curated table and the engine: precedence is user override > curated >
// computed, and this is the top of it.

export const OVERRIDES_KEY = 'thali_observance_dates'

/** The key one answer is filed under: the observance, and the date offered. */
export function overrideKey(observanceId, date) {
  return `${observanceId}@${date}`
}

export function loadOverrides() {
  try {
    const raw = window.localStorage.getItem(OVERRIDES_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    // Storage can be unreadable — a private window, a quota, a corrupt value.
    // An unanswered confirmation prompt is the safe failure: the family sees
    // the question again rather than a date they never agreed to.
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
 * Record that the calculated date was right.
 *
 * Kept as an explicit entry rather than deleting the question, because
 * "confirmed" and "never asked" are different states and only one of them
 * should stop the prompt reappearing.
 */
export function confirmDate(overrides, observanceId, date) {
  return { ...overrides, [overrideKey(observanceId, date)]: { confirmed: true, at: date } }
}

/** Record that the family keeps it on a different day. */
export function moveDate(overrides, observanceId, date, movedTo) {
  return { ...overrides, [overrideKey(observanceId, date)]: { confirmed: true, movedTo } }
}

/** Withdraw an answer, so the prompt returns. */
export function clearOverride(overrides, observanceId, date) {
  const next = { ...overrides }
  delete next[overrideKey(observanceId, date)]
  return next
}

/** The day either side of an ISO date, which is the only choice on offer. */
export function neighbouringDates(date) {
  const shift = (days) => {
    const d = new Date(`${date}T00:00:00Z`)
    d.setUTCDate(d.getUTCDate() + days)
    return d.toISOString().slice(0, 10)
  }
  return { previous: shift(-1), next: shift(1) }
}
