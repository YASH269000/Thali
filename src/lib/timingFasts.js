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

  sankashti_chaturthi: {
    id: 'sankashti_chaturthi',
    label: 'Sankashti Chaturthi',
    windowFrom: 'sunrise',
    windowTo: 'moonrise',
    describe: (t) => `Kept from sunrise, ${t.sunrise.text}, and broken after the `
      + `moon is sighted at ${t.moonrise.text}. The moon rises late on a krishna `
      + 'Chaturthi, which is why this is the one fast whose end most needs a '
      + 'local time rather than a published one.',
    slots: (t) => [
      slot('moonrise_meal', 'After moonrise', t.moonrise, {
        target: [3, 4],
        note: 'The fast is broken after the arghya to the moon, so this is the '
          + 'meal of the day rather than a late dinner.',
      }),
    ],
  },

  vinayaka_chaturthi_vrat: {
    id: 'vinayaka_chaturthi_vrat',
    label: 'Vinayaka Chaturthi',
    windowFrom: 'sunrise',
    windowTo: 'madhyahna',
    describe: (t) => `Kept from sunrise, ${t.sunrise.text}, until madhyahna at `
      + `${t.madhyahna.text}. Madhyahna is the midpoint between sunrise and `
      + 'sunset, not twelve o’clock — the engine resolves the date by it too.',
    slots: (t) => [
      slot('midday_meal', 'After midday', t.madhyahna, {
        target: [3, 4],
        note: 'Taken after the madhyahna puja, which is when the fast ends.',
      }),
    ],
  },

  // Nirjala Ekadashi is not a tradition of its own — it is ONE OCCURRENCE of
  // ekadashi_vrat, the Jyeshtha shukla one, and the only Ekadashi kept without
  // water. So it is matched on the occurrence rather than on the fast id, and
  // it is the case that made `matches` necessary at all.
  //
  // It is also the only fast here that is both a timing fast and an ingredient
  // fast: the day is waterless, and the vrat food rules still govern the
  // parana. Those two halves are enforced in different places and neither
  // knows about the other — the pool narrows through ingredientRules exactly
  // as it does on any other Ekadashi, and the slots come from here.
  nirjala_ekadashi: {
    id: 'nirjala_ekadashi',
    label: 'Nirjala Ekadashi',
    fastId: 'ekadashi_vrat',
    matches: (o) => o.ekadashiName === 'Nirjala',
    windowFrom: 'sunrise',
    windowTo: 'sunrise',
    describe: (t) => `Nirjala — without water — from sunrise, ${t.sunrise.text}, `
      + 'through the whole day and night, until the parana after sunrise '
      + 'tomorrow. The vrat food rules still hold for that meal: no grains, no '
      + 'pulses, sendha namak.',
    slots: (t) => [
      slot('parana', 'Parana', t.sunrise, {
        target: [3, 4],
        note: 'Broken the next morning after sunrise. Vrat food, because the '
          + 'parana of an Ekadashi is still an Ekadashi meal.',
      }),
    ],
  },
}

/**
 * Uposatha is deliberately not in the table above.
 *
 * It was handed to this work as a timing fast — "nothing after noon" — and it
 * is one, but it needs no slots: its rule maps exactly onto WHICH of the
 * standard three are eaten, which is what `mealCount` already answers. Its
 * baseline is `before_noon`, so breakfast and lunch stand and dinner does not.
 *
 * What it does need is the cutoff itself, computed, because "noon" here is
 * madhyahna — the midpoint between sunrise and sunset — and that is 12:11 in
 * one city and 12:39 in another. So it contributes a window and no slots.
 */
export const WINDOW_ONLY_FASTS = {
  uposatha_observance: {
    id: 'uposatha_observance',
    label: 'Uposatha',
    describe: (t) => `No solid food after madhyahna, ${t.madhyahna.text} — the `
      + 'midpoint between sunrise and sunset rather than twelve on a clock. '
      + 'Breakfast and lunch stand; dinner is the meal that goes.',
  },
  vesak_buddha_purnima: {
    id: 'vesak_buddha_purnima',
    label: 'Vesak',
    describe: (t) => `Vegetarian, and no solid food after madhyahna at `
      + `${t.madhyahna.text} for those who keep the precept.`,
  },
}

/**
 * Every timing tradition in force today.
 *
 * `observances` is optional and is what lets a tradition match an OCCURRENCE
 * rather than an id: Nirjala Ekadashi is one of the twenty-four Ekadashis and
 * cannot be told apart by fast id alone.
 */
export function timingFastsFor(fastIds, observances = []) {
  const ids = new Set(fastIds || [])
  const out = []
  for (const t of [...Object.values(TIMING_FASTS), ...Object.values(WINDOW_ONLY_FASTS)]) {
    if (t.matches) {
      if (!ids.has(t.fastId)) continue
      if (!observances.some((o) => t.matches(o))) continue
    } else if (!ids.has(t.id)) continue
    if (!out.includes(t)) out.push(t)
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
export function slotsFor(fastIds, isoDate, locationKey, observances = []) {
  const traditions = timingFastsFor(fastIds, observances).filter((t) => t.slots)
  if (traditions.length === 0) return []
  const times = dayTimes(isoDate, locationKey)
  return traditions
    // `fastId` is the tradition a MEMBER selects, which is not always the
    // tradition's own id: Nirjala Ekadashi is matched as an occurrence of
    // ekadashi_vrat, so a slot filed under `nirjala_ekadashi` would belong to
    // nobody — and did, until the parana came back with an empty guest list.
    .flatMap((t) => t.slots(times).map((s) => ({
      ...s, fastId: t.fastId || t.id, tradition: t.label,
    })))
    // A slot with no time is a slot that cannot be kept: the Moon does not
    // rise on every civil date, and an undated "after moonrise" would be worse
    // than saying so.
    .filter((s) => s.atJd != null)
    .sort((a, b) => a.atJd - b.atJd)
}

/** The window a timing fast holds, in words, with every time located. */
export function windowsFor(fastIds, isoDate, locationKey, observances = []) {
  const traditions = timingFastsFor(fastIds, observances)
  if (traditions.length === 0) return []
  const times = dayTimes(isoDate, locationKey)
  return traditions.map((t) => ({
    fastId: t.id,
    label: t.label,
    city: times.city,
    text: t.describe(times),
  }))
}

// The slot IDS do not depend on the times, only their labels do, so this
// stands in where only the shape is wanted and avoids an ephemeris call.
const STUB_TIMES = {
  sunrise: {}, sunset: {}, moonrise: {}, moonset: {}, madhyahna: {},
  fajr: {}, maghrib: {}, fajrAngle: 18,
}

/** Every slot id any timing tradition can produce, for validating a request. */
export const TIMING_SLOT_IDS = [...new Set(
  Object.values(TIMING_FASTS)
    .filter((t) => t.slots)
    .flatMap((t) => t.slots(STUB_TIMES).map((s) => s.id)),
)]
