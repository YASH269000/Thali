// Fasts that are about WHEN, not about what.
//
// Six traditions cannot be handled by narrowing the recipe pool, and treating
// them as ingredient fasts is why they showed a banner and changed nothing.
// Karva Chauth forbids no ingredient at all: it forbids eating, from before
// sunrise until the moon is sighted. Ramadan restricts nothing a vegetarian
// app can act on beyond halal, which here is alcoholFree — but it moves both
// meals outside the three the app plans.
//
// HOW THIS COMPOSES WITH mealCount, WHICH WAS THE QUESTION.
//
// It does not fight it, because there is nothing to arbitrate. `mealCount`
// answers "how many times does this person eat"; a timing tradition answers
// "when, and what are those occasions called". Karva Chauth's baseline is
// already `nirjala` — taken from the database's own words — and `nirjala`
// already means "none of the standard slots", so a member keeping one_meal
// for Ekadashi and nirjala for Karva Chauth resolves to nirjala by the
// strictest-wins rule that was already there. No standard meal, no tie to
// break.
//
// What was missing is what appears INSTEAD, and that is all this adds: a
// tradition contributes an ordered list of its own slots with real times, and
// `mealsAttendedBy` keeps deciding whether the standard three apply. One
// mechanism extended, not two mechanisms negotiating.
//
// `observesLightly` needs no special handling here either, for the same
// reason: it removes the observance from `binding` before any of this is
// consulted, so an exempt member gets the standard three meals and no slots.

import { dayTimes, sargiTime, SARGI_MINUTES_BEFORE_SUNRISE } from './times.js'

/**
 * A slot is a meal the tradition names, with the moment it opens.
 *
 * `at` is when it happens; `until` bounds it where the tradition does. Both
 * carry the raw JD as well as the text, because slots are ordered by time and
 * "10:00 AM" sorts after "8:56 PM" as a string.
 */
function slot(id, label, at, extra = {}) {
  return { id, label, at: at?.text ?? null, atJd: at?.jd ?? null, ...extra }
}

export const TIMING_FASTS = {
  karwa_chauth: {
    id: 'karwa_chauth',
    label: 'Karva Chauth',
    // Nirjala: no food AND no water. The window is stated so the family sees
    // what they are being asked to do rather than just an empty plan.
    windowFrom: 'sunrise',
    windowTo: 'moonrise',
    describe: (t) => `Nirjala from sunrise, ${t.sunrise.text}, until the moon `
      + `is sighted at ${t.moonrise.text}. No food and no water between them.`,
    slots: (t) => [
      slot('sargi', 'Sargi', sargiTime(t), {
        target: [2, 3],
        note: `Eaten and finished before sunrise at ${t.sunrise.text}, when the `
          + `fast begins. Thali puts it ${SARGI_MINUTES_BEFORE_SUNRISE} minutes `
          + 'before — households differ, so move it if yours does.',
      }),
      slot('parana', 'After moonrise', t.moonrise, {
        target: [3, 4],
        note: 'The first food and water of the day, after the moon is sighted '
          + 'and the arghya offered.',
      }),
    ],
  },

  ramadan_ramzan: {
    id: 'ramadan_ramzan',
    label: 'Ramadan',
    windowFrom: 'fajr',
    windowTo: 'maghrib',
    describe: (t) => `Fasting from Fajr, ${t.fajr.text}, to Maghrib, `
      + `${t.maghrib.text}. Fajr is taken at ${t.fajrAngle}° below the horizon, `
      + 'the majority convention; 15° and 19.5° are also kept and would move it '
      + 'by ten to fifteen minutes.',
    slots: (t) => [
      slot('suhoor', 'Suhoor', t.fajr, {
        target: [2, 3],
        before: true,
        note: `Eaten before Fajr at ${t.fajr.text}, which is when the fast `
          + 'begins — not at sunrise.',
      }),
      slot('iftar', 'Iftar', t.maghrib, {
        target: [3, 4],
        note: `The fast is broken at Maghrib, ${t.maghrib.text}, which is `
          + 'sunset. Dates and water first, by long practice.',
      }),
    ],
  },
}

/** Every timing tradition this member is keeping today. */
export function timingFastsFor(fastIds) {
  const out = []
  for (const id of fastIds || []) {
    const t = TIMING_FASTS[id]
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

/**
 * The slots that replace this member's standard meals today.
 *
 * Empty when no timing tradition is active, which is the ordinary case and
 * means the standard three apply unchanged.
 *
 * @param {string[]} fastIds  the traditions this member is BINDINGLY keeping —
 *   the health exemption has already removed anything it applies to.
 */
export function slotsFor(fastIds, isoDate, locationKey) {
  const traditions = timingFastsFor(fastIds)
  if (traditions.length === 0) return []
  const times = dayTimes(isoDate, locationKey)
  return traditions
    .flatMap((t) => t.slots(times).map((s) => ({ ...s, fastId: t.id, tradition: t.label })))
    // A slot with no time is a slot that cannot be kept: the Moon does not
    // rise on every civil date, and an undated "after moonrise" would be worse
    // than saying so.
    .filter((s) => s.atJd != null)
    .sort((a, b) => a.atJd - b.atJd)
}

/** The window a timing fast holds, in words, with every time located. */
export function windowsFor(fastIds, isoDate, locationKey) {
  const traditions = timingFastsFor(fastIds)
  if (traditions.length === 0) return []
  const times = dayTimes(isoDate, locationKey)
  return traditions.map((t) => ({
    fastId: t.id,
    label: t.label,
    city: times.city,
    text: t.describe(times),
  }))
}

/** Is this meal type one of today's timing slots rather than a standard meal? */
export function isTimingSlot(mealType, fastIds) {
  return timingFastsFor(fastIds)
    .some((t) => t.slots(STUB_TIMES).some((s) => s.id === mealType))
}

// The slot IDS do not depend on the times, only their labels do, so this
// stands in where only the shape is wanted and avoids an ephemeris call.
const STUB_TIMES = {
  sunrise: {}, sunset: {}, moonrise: {}, moonset: {}, fajr: {}, maghrib: {}, fajrAngle: 18,
}

/** Every slot id any timing tradition can produce, for validating a request. */
export const TIMING_SLOT_IDS = [...new Set(
  Object.values(TIMING_FASTS).flatMap((t) => t.slots(STUB_TIMES).map((s) => s.id)),
)]
