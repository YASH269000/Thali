// Per-person observance: the shared meal is the strictest observer's meal.
//
// The claim under test is structural, not behavioural. `requiredFlags` in
// mealPlanRules is a Set that only ever gets .add(), so there is no code path
// by which a looser member relaxes a stricter one's plate — and the way to
// prove that is not to read the code but to add a looser member and watch the
// pool not move.
//
// Every date here is read out of src/data/observances.json rather than typed
// in, so the day these run on is the day the calendar engine computes. A
// literal would keep passing after the calendar moved underneath it, which is
// exactly the failure the calendar work was about.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { filterRecipes } from '../src/lib/mealPlanRules.js'
import { activeFastIdsOn } from '../src/lib/fastingRules.js'
import { isoDateOf } from '../src/lib/observances.js'
import { moveDate } from '../src/lib/observanceOverrides.js'
import {
  ALLIUM_SCOPES, BASELINE_OVERRIDES, DEFAULT_BASELINE, MEAL_COUNTS,
  additiveSuggestions, attendsMeal, baselineFor, lightObservanceEligibility,
  mealsAttendedBy, observanceFor, suggestedAttendance,
} from '../src/lib/observanceProfile.js'
import { FAST_LABEL } from '../src/data/memberOptions.js'
import computed from '../src/data/observances.json' with { type: 'json' }

const RECIPES = JSON.parse(fs.readFileSync(new URL('../src/data/recipes.json', import.meta.url), 'utf8'))

/** A real date from the shipped calendar, never a literal. */
function dateOf(id, year = 2026, nth = 0) {
  const hits = computed.observances.filter((o) => o.id === id && o.date.startsWith(String(year)))
  assert.ok(hits[nth], `observances.json has no ${id} in ${year}`)
  const [y, m, d] = hits[nth].date.split('-').map(Number)
  return new Date(y, m - 1, d)
}

const EKADASHI = dateOf('ekadashi_vrat')
const EKADASHI_FASTS = activeFastIdsOn(EKADASHI)

const base = {
  age: 40, relationship: 'self', diet: 'vegetarian', health: [], religion: 'Hindu',
  cuisine: 'north_indian', spiceLevel: 2, dislikes: '', lifeStage: 'adult',
}

// Sumitra keeps two meals and allows onion and garlic in one of them.
const SUMITRA = {
  ...base,
  id: 'm1',
  name: 'Sumitra',
  age: 62,
  lifeStage: 'elderly',
  health: ['diabetes_t2'],
  fasts: ['ekadashi_vrat'],
  observances: { ekadashi_vrat: { mealCount: 'two_meals', alliumScope: 'permitted_in_one_meal' } },
}

// Vrinda keeps one meal and no allium at all — the strictest of the two.
const VRINDA = {
  ...base,
  id: 'm2',
  name: 'Vrinda',
  age: 38,
  fasts: ['ekadashi_vrat'],
  observances: { ekadashi_vrat: { mealCount: 'one_meal', alliumScope: 'none_all_day' } },
}

const pool = (family, fasts = EKADASHI_FASTS) => filterRecipes(RECIPES, family, fasts).mains
const constraintsOf = (family, fasts = EKADASHI_FASTS) =>
  filterRecipes(RECIPES, family, fasts).constraints

/* ------------------------------------------------------------------ *
 * The seam                                                            *
 * ------------------------------------------------------------------ */

// A weekly vrat is where allium scope actually bites. On Ekadashi it does not
// change the pool — every ekadashiSafe recipe is already free of onion and
// garlic — so a test that only ever looked at Ekadashi would pass whether the
// seam worked or not.
//
// Both are health-free on purpose. Sumitra is diabetic, which narrows the pool
// on its own, and a pool comparison that carried that would be measuring two
// things at once — the first draft of this test failed for exactly that
// reason and it was the fixture that was wrong, not the seam.
const MONDAY = new Set(['somvar_vrat_monday_fast'])
const strictMonday = {
  ...base, id: 'a', name: 'Anil', fasts: ['somvar_vrat_monday_fast'],
  observances: { somvar_vrat_monday_fast: { alliumScope: 'none_all_day' } },
}
const looseMonday = {
  ...base, id: 'b', name: 'Bela', fasts: ['somvar_vrat_monday_fast'],
  observances: { somvar_vrat_monday_fast: { alliumScope: 'permitted' } },
}

test('adding a looser member changes nothing about the shared meal', () => {
  const strictAlone = pool([strictMonday], MONDAY)
  const together = pool([strictMonday, looseMonday], MONDAY)
  assert.equal(together.length, strictAlone.length)
  assert.deepEqual(
    together.map((r) => r.recipeId ?? r.id),
    strictAlone.map((r) => r.recipeId ?? r.id),
    'the looser member moved the pool — the additive seam leaked',
  )
})

test('removing the stricter member is what widens it', () => {
  const looseAlone = pool([looseMonday], MONDAY).length
  const together = pool([strictMonday, looseMonday], MONDAY).length
  assert.ok(looseAlone > together,
    `loose alone ${looseAlone} should exceed both together ${together}`)
})

test('and the looser member is told what they may add', () => {
  const constraints = constraintsOf([strictMonday, looseMonday], MONDAY)
  const suggestions = additiveSuggestions(constraints)
  assert.equal(suggestions.length, 1, 'only the looser member gets additions')
  assert.equal(suggestions[0].name, 'Bela')
  assert.ok(suggestions[0].additions.some((a) => /onion/i.test(a)))

  // And every dish in the shared pool still satisfies the stricter member.
  const strict = constraints.find((c) => c.name === 'Anil')
  assert.ok(strict.requiredFlags.includes('onionGarlicFree'))
  for (const recipe of pool([strictMonday, looseMonday], MONDAY)) {
    for (const flag of strict.requiredFlags) {
      assert.notEqual(recipe.flags?.[flag]?.status, 'no',
        `a dish in the shared pool fails ${flag}, which Anil requires`)
    }
  }
})

test('a Jain member is never offered onion, however loose anyone else is', () => {
  const jain = { ...base, id: 'm3', name: 'Kirti', diet: 'jain', fasts: [] }
  const suggestions = additiveSuggestions(constraintsOf([strictMonday, jain], MONDAY))
  assert.deepEqual(suggestions.map((s) => s.name), [],
    'the Jain member requires onionGarlicFree from their diet, so nothing is offered')
})

/* ------------------------------------------------------------------ *
 * The health exemption                                                *
 * ------------------------------------------------------------------ */

test('a lightly-observing member does not relax anyone else', () => {
  const lightly = {
    ...SUMITRA,
    observances: { ekadashi_vrat: { mealCount: 'two_meals', alliumScope: 'permitted', observesLightly: true } },
  }
  // The right control is the same person with no fast recorded at all: a full
  // exemption should contribute exactly what not keeping the fast contributes,
  // which is nothing. Comparing against Vrinda alone would instead measure
  // Sumitra's diabetes, which narrows the pool whether she is fasting or not.
  const noFast = { ...SUMITRA, fasts: [], observances: {} }
  assert.equal(pool([VRINDA, lightly]).length, pool([VRINDA, noFast]).length,
    'the exemption did not behave like an exemption')

  // And Vrinda's fast still decides the meal for both of them.
  const withoutHer = pool([lightly]).length
  assert.ok(pool([VRINDA, lightly]).length < withoutHer,
    'the exemption propagated to the strict observer')
  const strict = constraintsOf([VRINDA, lightly]).find((c) => c.name === 'Vrinda')
  assert.ok(strict.requiredFlags.includes('ekadashiSafe'))

  const suggestions = additiveSuggestions(constraintsOf([VRINDA, lightly]))
  assert.equal(suggestions.length, 1)
  assert.ok(suggestions[0].additions.some((a) => /lightly/i.test(a)))
})

test('a sole lightly-observing member does widen the pool, and that is correct', () => {
  // Deliberate, so that nobody later "fixes" it. If Sumitra is the only person
  // keeping Ekadashi and she is exempt on health grounds, there is no fast at
  // the table to cook around.
  const lightly = {
    ...SUMITRA,
    observances: { ekadashi_vrat: { observesLightly: true } },
  }
  const exempt = pool([lightly]).length
  const observing = pool([SUMITRA]).length
  assert.ok(exempt > observing, `${exempt} should exceed ${observing}`)
})

test('the exemption relaxes the food rules, not the day itself', () => {
  // `anyFasting` gates the cuisine picker down to Indian. Someone keeping
  // Ekadashi lightly is still keeping Ekadashi, so the day stays a fast day
  // and only their dish pool widens. Asserted in both directions so that a
  // later change in either has to be a decision.
  const lightly = { ...SUMITRA, observances: { ekadashi_vrat: { observesLightly: true } } }
  const c = constraintsOf([lightly])[0]
  assert.deepEqual(c.activeFasts, ['ekadashi_vrat'],
    'the day stopped being a fast day, so the cuisine would open up')
  assert.ok(!c.requiredFlags.includes('ekadashiSafe'),
    'the food rules did not relax, so the exemption did nothing')
})

test('the exemption is offered on recorded grounds and withdrawn without them', () => {
  assert.equal(lightObservanceEligibility(SUMITRA).eligible, true)
  assert.equal(lightObservanceEligibility(VRINDA).eligible, false)

  // A member who no longer records the condition loses the exemption rather
  // than keeping one with nothing behind it.
  const stale = { ...VRINDA, observances: { ekadashi_vrat: { observesLightly: true } } }
  assert.equal(observanceFor(stale, 'ekadashi_vrat').observesLightly, false)
})

/* ------------------------------------------------------------------ *
 * Meal count is attendance, not dish logic                            *
 * ------------------------------------------------------------------ */

test('meal count decides who is at which meal, on a real Ekadashi', () => {
  assert.deepEqual(mealsAttendedBy(VRINDA, EKADASHI_FASTS), ['dinner'])
  assert.deepEqual(mealsAttendedBy(SUMITRA, EKADASHI_FASTS), ['breakfast', 'dinner'])

  const binod = { ...base, id: 'm3', name: 'Binod', diet: 'non_veg', fasts: [] }
  const family = [VRINDA, SUMITRA, binod]

  const at = (meal) => suggestedAttendance(family, meal, EKADASHI_FASTS)
  assert.deepEqual(at('breakfast').present, ['m1', 'm3'])
  assert.deepEqual(at('lunch').present, ['m3'])
  assert.deepEqual(at('dinner').present, ['m2', 'm1', 'm3'])

  // Absence is explained, never silent.
  for (const a of at('lunch').absent) {
    assert.ok(a.reason.includes(FAST_LABEL.ekadashi_vrat))
    assert.ok(a.reason.length > FAST_LABEL.ekadashi_vrat.length + 3)
  }
})

test('nobody is absent on a day their fast is not active', () => {
  const ordinary = new Date(EKADASHI)
  ordinary.setDate(ordinary.getDate() + 2)
  const fasts = activeFastIdsOn(ordinary)
  assert.ok(!fasts.has('ekadashi_vrat'), `${isoDateOf(ordinary)} is still an Ekadashi`)
  assert.deepEqual(
    suggestedAttendance([VRINDA, SUMITRA], 'breakfast', fasts).absent, [],
    'a fast that is not running today cannot empty anyone\'s plate',
  )
})

test('a nirjala fast plans no meals, and the exemption restores them', () => {
  const karwa = dateOf('karwa_chauth')
  const fasts = activeFastIdsOn(karwa)
  const observer = { ...SUMITRA, fasts: ['karwa_chauth'], observances: {} }
  assert.deepEqual(mealsAttendedBy(observer, fasts), [],
    'the database calls Karwa Chauth nirjala, in those words')

  const exempt = { ...observer, observances: { karwa_chauth: { observesLightly: true } } }
  assert.deepEqual(mealsAttendedBy(exempt, fasts), ['breakfast', 'lunch', 'dinner'])
})

/* ------------------------------------------------------------------ *
 * Composition with the date-confirmation prompt                       *
 * ------------------------------------------------------------------ */

test('observance follows a date the family moved', () => {
  // Yogini Ekadashi is one of the five dates the engine flags as moving under
  // a fifteen-minute perturbation, so it is the case where a family's own
  // answer and their observance have to compose.
  const yogini = computed.observances.find(
    (o) => o.id === 'ekadashi_vrat' && o.confidence === 'computed_unstable')
  assert.ok(yogini, 'no unstable Ekadashi in the shipped calendar')
  assert.equal(yogini.date, '2026-07-10')

  const [y, m, d] = yogini.date.split('-').map(Number)
  const computedDay = new Date(y, m - 1, d)
  const nextDay = new Date(y, m - 1, d + 1)
  const overrides = moveDate({}, 'ekadashi_vrat', yogini.date, isoDateOf(nextDay))

  // Before the move: absent at lunch on the 10th, present on the 11th.
  assert.equal(attendsMeal(VRINDA, 'lunch', activeFastIdsOn(computedDay)), false)
  assert.equal(attendsMeal(VRINDA, 'lunch', activeFastIdsOn(nextDay)), true)

  // After it, both flip — the attendance path carries the overrides through.
  assert.equal(attendsMeal(VRINDA, 'lunch', activeFastIdsOn(computedDay, overrides)), true)
  assert.equal(attendsMeal(VRINDA, 'lunch', activeFastIdsOn(nextDay, overrides)), false)

  // And so does the exemption, and the pool it governs.
  const lightly = { ...SUMITRA, observances: { ekadashi_vrat: { observesLightly: true } } }
  const on = (date, ov) => pool([lightly], activeFastIdsOn(date, ov)).length
  assert.ok(on(computedDay) > 0 && on(computedDay) === on(nextDay, overrides),
    'the exemption did not move with the date')
  assert.equal(on(nextDay), on(computedDay, overrides),
    'the fast did not move with the date')
})

/* ------------------------------------------------------------------ *
 * The vocabulary itself                                               *
 * ------------------------------------------------------------------ */

test('every baseline override names a real fasting tradition', () => {
  const known = new Set(Object.keys(FAST_LABEL))
  const unknown = Object.keys(BASELINE_OVERRIDES).filter((id) => !known.has(id))
  assert.deepEqual(unknown, [],
    'a baseline points at a tradition nobody can select, so it can never apply')
})

test('every baseline resolves, and to a value the vocabulary knows', () => {
  const meals = new Set(MEAL_COUNTS.map((m) => m.id))
  const allium = new Set(ALLIUM_SCOPES.map((a) => a.id))
  for (const id of Object.keys(FAST_LABEL)) {
    const b = baselineFor(id)
    assert.ok(meals.has(b.mealCount), `${id} -> mealCount ${b.mealCount}`)
    assert.ok(allium.has(b.alliumScope), `${id} -> alliumScope ${b.alliumScope}`)
  }
  assert.deepEqual(baselineFor('a_tradition_that_does_not_exist'), DEFAULT_BASELINE)
})

test('an unreadable observance falls back to the strictest reading, not the loosest', () => {
  const typo = {
    ...SUMITRA,
    observances: { ekadashi_vrat: { mealCount: 'two_mealz', alliumScope: 'permited' } },
  }
  const resolved = observanceFor(typo, 'ekadashi_vrat')
  assert.equal(resolved.mealCount, DEFAULT_BASELINE.mealCount)
  assert.equal(resolved.alliumScope, DEFAULT_BASELINE.alliumScope)
  assert.ok(pool([typo]).length <= pool([SUMITRA]).length,
    'a typo widened the plate')
})

test('a member with no observances recorded gets the tradition unaltered', () => {
  const plain = { ...base, id: 'm9', name: 'Asha', fasts: ['ekadashi_vrat'] }
  const resolved = observanceFor(plain, 'ekadashi_vrat')
  assert.equal(resolved.customised, false)
  assert.equal(resolved.mealCount, DEFAULT_BASELINE.mealCount)
  assert.equal(resolved.alliumScope, DEFAULT_BASELINE.alliumScope)
  assert.equal(resolved.observesLightly, false)
  assert.deepEqual(additiveSuggestions(constraintsOf([plain])), [],
    'nothing to add when nothing was loosened')
})
