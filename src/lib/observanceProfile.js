// How one person keeps a fast, as distinct from what the fast is.
//
// A tradition states the strictest reading. Two people keeping the same
// Ekadashi do not keep it identically: one takes a single meal after sunset,
// another takes two; one avoids onion and garlic all day, another allows them
// in the evening meal. Before this, a tradition applied identically to
// everyone who selected it, which is not how any real family works.
//
// THE RESOLUTION RULE, and it is structural rather than something the model is
// asked to honour:
//
//   The shared meal is generated against the STRICTEST observer present.
//   A looser member gets an ADDITION on top — "you may also add an onion
//   tadka" — and never a relaxation of the shared dishes.
//
// The seam that guarantees it is `requiredFlags` in mealPlanRules: a Set that
// only ever gets .add(). A strict member contributes `onionGarlicFree`; a
// loose one contributes nothing. There is no branch anywhere that removes a
// flag another member added, so looseness cannot propagate to the stricter
// person's plate however the family is composed. Same principle as the Jain
// guest, who makes the whole pot Jain rather than getting a second pot.
//
// `observesLightly` is the one value that subtracts, and it subtracts only
// from its own member's contribution. Under a union that is safe while anyone
// else is still keeping the fast strictly; when the lightly-observing member
// is the only observer the pool widens, which is the correct answer and not a
// leak. test/observance-additive.test.js asserts both directions.

import { FAST_LABEL } from '../data/memberOptions.js'

/* ------------------------------------------------------------------ *
 * The vocabulary                                                      *
 *                                                                     *
 * Both lists are ordered strictest first. That order is the whole     *
 * comparison: `strictest()` is an index lookup, not a rule table.     *
 * ------------------------------------------------------------------ */

export const MEAL_COUNTS = [
  {
    id: 'nirjala',
    label: 'Nirjala — no food or water',
    short: 'nirjala',
    meals: [],
    note: 'Kept without water. Nothing is planned for them until the fast breaks.',
  },
  {
    id: 'nirahar',
    label: 'Nirahar — no food, water allowed',
    short: 'nirahar',
    meals: [],
    note: 'No food during the fast.',
  },
  {
    id: 'one_meal',
    label: 'One meal',
    short: 'one meal',
    meals: ['dinner'],
    note: 'One meal, taken after the fast breaks — Thali plans them into dinner.',
  },
  {
    id: 'two_meals',
    label: 'Two meals',
    short: 'two meals',
    // Breakfast and dinner: the fasting stretch is the day, and the two meals
    // sit either side of it. It is a default and it is said out loud on the
    // who-is-eating screen, because a household that takes its two meals at
    // lunch and dinner should not have to discover the assumption.
    meals: ['breakfast', 'dinner'],
    note: 'Two meals. Thali assumes breakfast and dinner — change it below if yours differ.',
  },
  {
    id: 'phalahar',
    label: 'Phalahar — fruit and vrat food through the day',
    short: 'phalahar',
    meals: ['breakfast', 'lunch', 'dinner'],
    note: 'Eats through the day, within the fast’s food rules.',
  },
  {
    id: 'unrestricted',
    label: 'Eats normally',
    short: 'eats normally',
    meals: ['breakfast', 'lunch', 'dinner'],
    note: 'Marks the day without changing when they eat.',
  },
]

export const ALLIUM_SCOPES = [
  {
    id: 'none_all_day',
    label: 'No onion or garlic all day',
    short: 'no onion or garlic',
  },
  {
    id: 'permitted_in_one_meal',
    label: 'Onion and garlic in one meal',
    short: 'onion and garlic in one meal',
  },
  {
    id: 'permitted',
    label: 'Onion and garlic as usual',
    short: 'onion and garlic as usual',
  },
]

export const MEAL_COUNT_BY_ID = Object.fromEntries(MEAL_COUNTS.map((m) => [m.id, m]))
export const ALLIUM_SCOPE_BY_ID = Object.fromEntries(ALLIUM_SCOPES.map((a) => [a.id, a]))

const MEAL_COUNT_ORDER = MEAL_COUNTS.map((m) => m.id)
const ALLIUM_ORDER = ALLIUM_SCOPES.map((a) => a.id)

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner']

/* ------------------------------------------------------------------ *
 * The baseline                                                        *
 * ------------------------------------------------------------------ */

/**
 * What a fast means before anyone varies it.
 *
 * A constant, not a table of 43 rows. The strictest reading of a Hindu or
 * Jain vrat is one meal and no allium, and writing that once is honest where
 * a per-tradition table would not be: `fastStrictnessLevel` in the database
 * carries twenty distinct free-text values ("Light to Moderate", "Sunnah
 * (recommended)", "Feast not fast (Onam Sadhya)"), and deriving observance
 * semantics from those would be the same substring guessing that put Ekadashi
 * on two days of the year.
 */
export const DEFAULT_BASELINE = {
  mealCount: 'one_meal',
  alliumScope: 'none_all_day',
}

/**
 * Where a tradition genuinely departs from that, and only where the database
 * says so in words rather than by inference.
 *
 * Every key is checked against the real tradition slugs by
 * test/observance-additive.test.js — a renamed tradition must not leave a
 * baseline silently pointing at nothing.
 */
export const BASELINE_OVERRIDES = {
  // "Very Strict (nirjala — no water)" in the database, in those words.
  karwa_chauth: { mealCount: 'nirjala' },
  // A 36-hour nirjala fast around the Shashti arghya; the calendar guidance
  // for chhath_puja says so too.
  chhath_puja_vrat: { mealCount: 'nirjala' },
  // Dawn to sunset, every day of the month. Suhoor and iftar sit outside the
  // three meal types Thali plans, so the fasting day itself carries no meal.
  ramadan_ramzan: { mealCount: 'nirahar' },
  ashura_fast: { mealCount: 'nirahar' },
  arafah_fast_day_of_arafah: { mealCount: 'nirahar' },
  monday_thursday_sunnah_fasts: { mealCount: 'nirahar' },
  shawwal_fasts_6_days: { mealCount: 'nirahar' },
  sha_ban_fasts: { mealCount: 'nirahar' },
  ayyam_al_bid_white_days: { mealCount: 'nirahar' },
  // Named for what they are.
  ekasana_one_meal_fast: { mealCount: 'one_meal' },
  upvas_complete_day_fast: { mealCount: 'nirahar' },
  atthai_8_day_continuous_fast: { mealCount: 'nirahar' },
  // Observances that are not fasts. Marking the day must not empty anyone's
  // plate: a Gurpurab is a langar, and Onam is a sadhya.
  gurpurab_observances: { mealCount: 'unrestricted', alliumScope: 'permitted' },
  sikh_dietary_observance: { mealCount: 'unrestricted', alliumScope: 'permitted' },
  onam_kerala: { mealCount: 'unrestricted', alliumScope: 'permitted' },
  makar_sankranti_pongal: { mealCount: 'unrestricted', alliumScope: 'permitted' },
  mahavir_jayanti: { mealCount: 'unrestricted' },
  // Always active and never a fasting day of its own; the Jain diet's own
  // rules already reach the filter through `diet: 'jain'`.
  jain_year_round_dietary_rules: { mealCount: 'unrestricted' },
  // Buddhist Uposatha: no solid food after noon, so the evening meal is the
  // one that goes rather than the morning.
  uposatha_observance: { mealCount: 'two_meals' },
  vesak_buddha_purnima: { mealCount: 'two_meals' },
  // A year-long practice with alternate-day fasting; the day itself is not
  // predictable from a calendar, so it changes nothing on its own.
  varsitap: { mealCount: 'unrestricted' },
}

/** The strictest reading of one tradition. */
export function baselineFor(fastId) {
  return { ...DEFAULT_BASELINE, ...(BASELINE_OVERRIDES[fastId] || {}) }
}

/* ------------------------------------------------------------------ *
 * A member's variation on it                                          *
 * ------------------------------------------------------------------ */

/**
 * Who may be offered the health exemption.
 *
 * Thali does not decide this and must not appear to: it offers the toggle to
 * a household where going without food carries a known risk, and the family
 * — with whoever advises them — decides. Nothing here is switched on
 * automatically, and the "why this meal" panel's rule holds: this restates a
 * setting the family entered, it does not recommend one.
 */
export const LIGHT_OBSERVANCE_HEALTH = [
  'diabetes_t1', 'diabetes_t2', 'pcod', 'kidney_issues',
]
export const LIGHT_OBSERVANCE_STAGES = [
  'toddler', 'school_child', 'pregnant', 'elderly',
]

/** @returns {{ eligible: boolean, because: string|null }} */
export function lightObservanceEligibility(member) {
  const health = (member?.health || []).filter((h) => LIGHT_OBSERVANCE_HEALTH.includes(h))
  const stage = LIGHT_OBSERVANCE_STAGES.includes(member?.lifeStage) ? member.lifeStage : null
  if (health.length === 0 && !stage) return { eligible: false, because: null }
  return {
    eligible: true,
    because: health.length > 0 ? 'health' : 'life stage',
  }
}

const warned = new Set()
function warnUnreadable(field, value, name) {
  const key = `${field}:${value}`
  if (warned.has(key)) return
  warned.add(key)
  console.warn(
    `[thali:observance] unrecognised ${field} "${value}" on ${name || 'a member'} — `
    + 'falling back to the tradition\'s strictest reading. Re-select it in Family.',
  )
}

/**
 * How this member keeps this fast, resolved against the baseline.
 *
 * An unreadable stored value falls back to the baseline rather than to the
 * loosest option, for the reason the rest of the app already fails closed: a
 * setting nobody recognises must never be the one that widens a plate.
 *
 * `observesLightly` only survives if the member is eligible for it. A member
 * who was diabetic when the setting was made and is not recorded as diabetic
 * now loses the exemption rather than keeping an exemption with no reason
 * behind it.
 *
 * @returns {{ fastId, mealCount, alliumScope, observesLightly, customised, baseline }}
 */
export function observanceFor(member, fastId) {
  const baseline = baselineFor(fastId)
  const stored = member?.observances?.[fastId] || {}

  let mealCount = baseline.mealCount
  if (stored.mealCount !== undefined && stored.mealCount !== null) {
    if (MEAL_COUNT_BY_ID[stored.mealCount]) mealCount = stored.mealCount
    else warnUnreadable('mealCount', stored.mealCount, member?.name)
  }

  let alliumScope = baseline.alliumScope
  if (stored.alliumScope !== undefined && stored.alliumScope !== null) {
    if (ALLIUM_SCOPE_BY_ID[stored.alliumScope]) alliumScope = stored.alliumScope
    else warnUnreadable('alliumScope', stored.alliumScope, member?.name)
  }

  const observesLightly = stored.observesLightly === true
    && lightObservanceEligibility(member).eligible

  return {
    fastId,
    mealCount,
    alliumScope,
    observesLightly,
    customised: mealCount !== baseline.mealCount
      || alliumScope !== baseline.alliumScope
      || observesLightly,
    baseline,
  }
}

/** Every fast this member is keeping today, with how they keep it. */
export function observancesToday(member, activeFastIds) {
  return (member?.fasts || [])
    .filter((id) => activeFastIds.has(id))
    .map((id) => observanceFor(member, id))
}

/* ------------------------------------------------------------------ *
 * Comparison                                                          *
 * ------------------------------------------------------------------ */

const strictestBy = (order) => (values) => {
  let best = null
  for (const v of values) {
    const i = order.indexOf(v)
    if (i < 0) continue
    if (best === null || i < order.indexOf(best)) best = v
  }
  return best
}

export const strictestMealCount = strictestBy(MEAL_COUNT_ORDER)
export const strictestAlliumScope = strictestBy(ALLIUM_ORDER)

/** Is `a` strictly tighter than `b`? Used to decide who gets an addition. */
export function isStricterAllium(a, b) {
  return ALLIUM_ORDER.indexOf(a) < ALLIUM_ORDER.indexOf(b)
}

/**
 * Which meals this member is present for today, from their observances alone.
 *
 * Attendance, not dish logic. A member on one_meal is simply not at breakfast,
 * and that is the existing who-is-eating machinery doing its job rather than a
 * second mechanism for the same thing.
 *
 * Where someone keeps two fasts at once the stricter meal count wins, because
 * they cannot be both present and absent.
 */
export function mealsAttendedBy(member, activeFastIds) {
  const observances = observancesToday(member, activeFastIds)
  if (observances.length === 0) return [...MEAL_TYPES]

  // The exemption is exactly an exemption from going without food.
  const binding = observances.filter((o) => !o.observesLightly)
  if (binding.length === 0) return [...MEAL_TYPES]

  const strictest = strictestMealCount(binding.map((o) => o.mealCount))
  return [...(MEAL_COUNT_BY_ID[strictest]?.meals || MEAL_TYPES)]
}

/** Does this member eat `mealType` today? */
export function attendsMeal(member, mealType, activeFastIds) {
  return mealsAttendedBy(member, activeFastIds).includes(mealType)
}

/**
 * Who Thali suggests is at the table, and why, for one meal.
 *
 * A suggestion, not a decision. The reason travels with it so the
 * who-is-eating screen can say why somebody is unchecked instead of silently
 * leaving them out, and the checkbox beside it is the manual override — the
 * existing machinery, rather than a second one built for fasting.
 *
 * @returns {{ present: string[], absent: Array<{memberId, name, mealCount, reason}> }}
 */
export function suggestedAttendance(family, mealType, activeFastIds) {
  const present = []
  const absent = []
  for (const m of family || []) {
    if (attendsMeal(m, mealType, activeFastIds)) {
      present.push(m.id)
      continue
    }
    const binding = observancesToday(m, activeFastIds).filter((o) => !o.observesLightly)
    const strictest = strictestMealCount(binding.map((o) => o.mealCount))
    const fastName = FAST_LABEL[binding[0]?.fastId] || 'their fast'
    absent.push({
      memberId: m.id,
      name: m.name,
      mealCount: strictest,
      reason: `${fastName} — ${MEAL_COUNT_BY_ID[strictest]?.note || 'not eating this meal'}`,
    })
  }
  return { present, absent }
}

/* ------------------------------------------------------------------ *
 * Additions                                                           *
 *                                                                     *
 * The other half of the resolution rule, and the reason it can be a   *
 * union of flags rather than a negotiation. A looser member does not  *
 * get a different plan; they get the same plan and a short list of    *
 * things they may add to their own plate.                             *
 *                                                                     *
 * Computed here, deterministically, and never fed back into the       *
 * candidate pool. The model is told what the additions are so it can  *
 * word them; it is not asked to work out who may relax what, because  *
 * an instruction is not a guarantee.                                  *
 * ------------------------------------------------------------------ */

/**
 * Onion and garlic go on at the table, not in the pot.
 *
 * That is not a workaround for the data — it is how a shared kitchen actually
 * handles it. One pan of sabzi is cooked without them and whoever wants them
 * adds them to their own plate, which is exactly the additive rule expressed
 * in food.
 */
export const ALLIUM_ADDITIONS = [
  'sliced raw onion with lemon and salt, on the side',
  'an onion and garlic tadka, stirred into your own portion',
  'garlic chutney on the side',
]

/** What a fast flag is holding back, in words, for a member exempt from it. */
const RELAXATION_PHRASE = {
  ekadashiSafe: 'grains, pulses and regular salt are fine for you today',
  navratriSafe: 'grains, pulses and regular salt are fine for you today',
  onionGarlicFree: 'onion and garlic are fine for you today',
}

/**
 * What each member may add to the shared plan, given what the plan had to be.
 *
 * Reads the resolved constraints and returns a per-member list. It cannot
 * subtract: nothing here is returned to `filterRecipes`, and the only inputs
 * are the flags the plan already carries.
 *
 * @param {Array} constraints output of memberConstraints, one per diner
 * @returns {Array<{ memberId, name, additions: string[], because: string }>}
 */
export function additiveSuggestions(constraints) {
  const shared = new Set((constraints || []).flatMap((c) => c.requiredFlags || []))
  const out = []

  for (const c of constraints || []) {
    const own = new Set(c.requiredFlags || [])
    const additions = []
    const reasons = []
    // Flags already spoken for above, so the exemption below does not say the
    // same relaxation twice in two different sets of words.
    const covered = new Set()

    // The shared meal is onion- and garlic-free because somebody at this table
    // needed it to be. This member did not — from any source, so a Jain or a
    // Buddhist member never appears here — so they may add it back themselves.
    if (shared.has('onionGarlicFree') && !own.has('onionGarlicFree')) {
      const scope = strictestAlliumScope(
        (c.observances || []).map((o) => o.alliumScope),
      ) || 'permitted'
      additions.push(...ALLIUM_ADDITIONS)
      reasons.push(scope === 'permitted_in_one_meal'
        ? 'you keep onion and garlic to one meal, and this is it'
        : 'you do not avoid onion and garlic today')
      covered.add('onionGarlicFree')
    }

    // The health exemption, named rather than silently applied.
    const lightly = (c.observances || []).filter((o) => o.observesLightly)
    if (lightly.length > 0) {
      for (const flag of shared) {
        if (own.has(flag) || covered.has(flag)) continue
        const phrase = RELAXATION_PHRASE[flag]
        if (phrase && !reasons.includes(phrase)) reasons.push(phrase)
      }
      const names = [...new Set(lightly.map((o) => FAST_LABEL[o.fastId] || o.fastId))]
      additions.push(`the everyday version of any dish above — ${names.join(' and ')} `
        + 'is being kept lightly for you on health grounds')
    }

    if (additions.length > 0) {
      out.push({
        memberId: c.id,
        name: c.name,
        additions: [...new Set(additions)],
        because: reasons.join('; '),
      })
    }
  }
  return out
}

/** One line per member describing how they keep today's fasts, for the prompt. */
export function describeObservances(constraints) {
  return (constraints || [])
    .filter((c) => (c.observances || []).length > 0)
    .map((c) => ({
      memberId: c.id,
      name: c.name,
      keeping: c.observances.map((o) => ({
        fast: FAST_LABEL[o.fastId] || o.fastId,
        meals: MEAL_COUNT_BY_ID[o.mealCount]?.short || o.mealCount,
        allium: ALLIUM_SCOPE_BY_ID[o.alliumScope]?.short || o.alliumScope,
        observesLightly: o.observesLightly || undefined,
      })),
    }))
}
