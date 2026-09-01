// Fasts measured in hours rather than ingredients.
//
// Karva Chauth forbids no ingredient at all — it forbids eating, from before
// sunrise until the moon is sighted. Ramadan restricts nothing a vegetarian
// app can act on beyond alcoholFree, but moves both meals outside the three
// the app plans. Treating either as an ingredient fast is why they showed a
// banner and changed nothing.
//
// Every date here is read out of observances.json rather than typed in, and
// every time is computed for a named city, because a time without its city is
// not an answer: the moon rises 74 minutes apart between Kolkata and Mumbai.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { dayTimes, formatTime, sargiTime, FAJR_ANGLE } from '../src/lib/times.js'
import { TIMING_SLOT_IDS, slotsFor, timingFastsFor, windowsFor } from '../src/lib/timingFasts.js'
import { MEAL_TARGET, SLOT_SHAPE, filterRecipes, selectCandidatesForMeal, shapeOf } from '../src/lib/mealPlanRules.js'
import { mealsAttendedBy, strictestMealCount } from '../src/lib/observanceProfile.js'
import { LOCATIONS } from '../src/lib/location.js'
import computed from '../src/data/observances.json' with { type: 'json' }

const RECIPES = JSON.parse(fs.readFileSync(new URL('../src/data/recipes.json', import.meta.url), 'utf8'))

/** A real date from the shipped calendar, never a literal. */
const shipped = (id, year = 2026) => {
  const hit = [...computed.observances, ...computed.provisional]
    .find((o) => o.id === id && o.date.startsWith(String(year)))
  assert.ok(hit, `nothing shipped for ${id} in ${year}`)
  return hit.date
}
const KARVA = shipped('karwa_chauth')
const RAMADAN = shipped('ramadan_start')

/* ------------------------------------------------------------------ *
 * Times, and the city they belong to                                  *
 * ------------------------------------------------------------------ */

test('a time is computed for a city, and differs between cities', () => {
  const delhi = dayTimes(KARVA, 'delhi')
  const mumbai = dayTimes(KARVA, 'mumbai')
  assert.equal(delhi.city, 'Delhi')
  assert.equal(mumbai.city, 'Mumbai')

  // The reason none of this could be precomputed for Delhi. A nirjala fast
  // ends at moonrise; ending it on Delhi's would end it early in Mumbai.
  const gap = Math.abs(mumbai.moonrise.jd - delhi.moonrise.jd) * 1440
  assert.ok(gap > 30, `moonrise differs by only ${gap.toFixed(0)} minutes`)
  assert.notEqual(delhi.moonrise.text, mumbai.moonrise.text)
})

test('every city gives a usable set of times', () => {
  for (const key of Object.keys(LOCATIONS)) {
    const t = dayTimes(KARVA, key)
    for (const field of ['sunrise', 'sunset', 'moonrise']) {
      assert.ok(t[field].jd != null, `${key} has no ${field}`)
      assert.match(t[field].text, /^\d{1,2}:\d{2} [AP]M$/, `${key} ${field}`)
    }
  }
})

test('an event that does not happen renders as one, not as a crash', () => {
  // The Moon rises later each day and skips a civil date about monthly.
  assert.equal(formatTime(null, LOCATIONS.delhi), null)
  const missing = { sunrise: { jd: null }, place: LOCATIONS.delhi }
  assert.deepEqual(sargiTime(missing), { jd: null, text: null })
})

test('Fajr uses a stated convention, and the app can say which', () => {
  const t = dayTimes(RAMADAN, 'delhi')
  assert.equal(t.fajrAngle, FAJR_ANGLE)
  assert.equal(FAJR_ANGLE, 18)
  // Maghrib IS sunset — the same instant, a different question.
  assert.equal(t.maghrib.jd, t.sunset.jd)
  // And Fajr is before sunrise, by an amount the convention decides.
  assert.ok(t.fajr.jd < t.sunrise.jd)
  const spread = (t.sunrise.jd - t.fajr.jd) * 1440
  assert.ok(spread > 60 && spread < 110, `${spread.toFixed(0)} minutes before sunrise`)

  // The other two conventions move it, which is why the angle is printed.
  const isna = dayTimes(RAMADAN, 'delhi', { fajrAngle: 15 })
  assert.ok(isna.fajr.jd > t.fajr.jd, 'a shallower angle should be later')
})

/* ------------------------------------------------------------------ *
 * Slots, and how they compose with mealCount                          *
 * ------------------------------------------------------------------ */

test('a timing fast supplies slots; mealCount still decides the standard meals', () => {
  // The interaction, asserted rather than described. Karva Chauth's baseline
  // is nirjala, and nirjala already meant "none of the standard three" — so
  // there is nothing to arbitrate and never was. What the timing layer adds
  // is what appears instead.
  const priya = { id: 'm1', name: 'Priya', diet: 'vegetarian', health: [],
    lifeStage: 'adult', fasts: ['karwa_chauth'] }
  assert.deepEqual(mealsAttendedBy(priya, new Set(['karwa_chauth'])), [])

  const slots = slotsFor(['karwa_chauth'], KARVA, 'delhi')
  assert.deepEqual(slots.map((s) => s.id), ['sargi', 'parana'])
  assert.ok(slots[0].atJd < slots[1].atJd, 'slots are ordered by time')
})

test('one_meal and nirjala on one day resolve without a tiebreaker', () => {
  const priya = { id: 'm1', name: 'Priya', diet: 'vegetarian', health: [],
    lifeStage: 'adult', fasts: ['ekadashi_vrat', 'karwa_chauth'],
    observances: { ekadashi_vrat: { mealCount: 'one_meal' } } }
  assert.equal(strictestMealCount(['one_meal', 'nirjala']), 'nirjala')
  assert.deepEqual(mealsAttendedBy(priya, new Set(['ekadashi_vrat', 'karwa_chauth'])), [])
  // And Karva Chauth is the one that supplies the slots.
  assert.deepEqual(
    slotsFor(['ekadashi_vrat', 'karwa_chauth'], KARVA, 'delhi').map((s) => s.id),
    ['sargi', 'parana'],
  )
})

test('the health exemption removes the slots with the fast', () => {
  // Not special-cased here: an exempt observance never reaches slotsFor,
  // because the caller passes only the BINDING fast ids.
  assert.deepEqual(slotsFor([], KARVA, 'delhi'), [])
  assert.deepEqual(windowsFor([], KARVA, 'delhi'), [])
})

test('a household where one person fasts keeps its other meals', () => {
  const observers = timingFastsFor(['karwa_chauth'])
  assert.equal(observers.length, 1)
  // A member with no timing fast contributes no slots, so the standard three
  // stand for them — the slot list is per-tradition, never per-household.
  assert.deepEqual(timingFastsFor(['ekadashi_vrat']), [])
})

test('Ramadan moves both meals outside the three the app plans', () => {
  const slots = slotsFor(['ramadan_ramzan'], RAMADAN, 'kolkata')
  assert.deepEqual(slots.map((s) => s.id), ['suhoor', 'iftar'])
  const [w] = windowsFor(['ramadan_ramzan'], RAMADAN, 'kolkata')
  assert.equal(w.city, 'Kolkata')
  assert.match(w.text, /Fajr/)
  assert.match(w.text, /18°/, 'the convention is not stated')
})

test('every window names its city, on every tradition', () => {
  for (const [ids, date] of [[['karwa_chauth'], KARVA], [['ramadan_ramzan'], RAMADAN]]) {
    for (const key of Object.keys(LOCATIONS)) {
      const [w] = windowsFor(ids, date, key)
      assert.equal(w.city, LOCATIONS[key].name)
      assert.ok(/\d{1,2}:\d{2} [AP]M/.test(w.text), `${ids} in ${key} states no time`)
    }
  }
})

/* ------------------------------------------------------------------ *
 * The three mealType costs, paid                                      *
 * ------------------------------------------------------------------ */

test('a slot has its own dish count and borrows a meal shape', () => {
  for (const id of TIMING_SLOT_IDS) {
    assert.ok(MEAL_TARGET[id], `${id} has no dish count, so it would borrow dinner's`)
    assert.ok(SLOT_SHAPE[id], `${id} borrows no meal shape, so it would take the whole pool`)
  }
  assert.equal(shapeOf('sargi'), 'breakfast')
  assert.equal(shapeOf('iftar'), 'dinner')
  assert.equal(shapeOf('lunch'), 'lunch', 'a real meal is its own shape')
})

test('a slot selects the dishes of the meal it sits at, not the whole pool', () => {
  const member = { id: 'm1', name: 'Priya', age: 38, relationship: 'self',
    diet: 'vegetarian', health: [], religion: 'Hindu', cuisine: 'north_indian',
    spiceLevel: 2, dislikes: '', lifeStage: 'adult', fasts: ['karwa_chauth'] }
  const { mains } = filterRecipes(RECIPES, [member], new Set(['karwa_chauth']))
  const opts = { limit: 40, excludeIds: [], anyFasting: true, forceCuisine: 'indian' }

  const sargi = selectCandidatesForMeal(mains, 'sargi', opts)
  const breakfast = selectCandidatesForMeal(mains, 'breakfast', opts)
  const dinner = selectCandidatesForMeal(mains, 'dinner', opts)

  assert.equal(sargi.eligible, breakfast.eligible, 'sargi did not take breakfast\'s shape')
  assert.ok(sargi.eligible < mains.length, 'sargi fell through to the whole pool')
  assert.equal(selectCandidatesForMeal(mains, 'parana', opts).eligible, dinner.eligible)
})
