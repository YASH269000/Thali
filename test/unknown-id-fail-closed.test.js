// An id the app cannot interpret must never widen a member's pool. Skipping it
// was the bug: a constraint nobody recognises is a constraint nobody applies,
// leaving the member less protected than if they had selected nothing.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { filterRecipes } from '../src/lib/mealPlanRules.js'
import { activeFastIdsOn } from '../src/lib/fastingRules.js'
import { unknownMemberIds, hasBlockingId, familyIdWarnings } from '../src/lib/memberValidation.js'

const RECIPES = JSON.parse(fs.readFileSync(new URL('../src/data/recipes.json', import.meta.url), 'utf8'))
const M = (o) => ({ id: 'm1', name: 'Asha', age: 32, relationship: 'self', diet: 'vegetarian',
  health: [], fasts: [], religion: 'none', spiceLevel: 2, lifeStage: 'adult', ...o })
const pool = (member, fasts = new Set()) => filterRecipes(RECIPES, [member], fasts).mains.length
const constraint = (member, fasts = new Set()) => filterRecipes(RECIPES, [member], fasts).constraints[0]

// A day with an active fast, so the fasting case is exercised where it counts.
const FAST_DAY = activeFastIdsOn(new Date('2026-09-07T06:00:00.000Z'))

test('a typo\'d diet does not widen the pool', () => {
  const good = pool(M({ diet: 'jain' }))
  const typo = pool(M({ diet: 'jian' }))
  assert.ok(typo <= good, `typo'd diet opened the pool: ${typo} > ${good}`)
  assert.equal(unknownMemberIds(M({ diet: 'jian' }))[0].kind, 'diet')
})

test('a typo\'d religion does not widen the pool', () => {
  const good = pool(M({ religion: 'Buddhist' }))
  const typo = pool(M({ religion: 'Budhist' }))
  assert.ok(typo <= good, `typo'd religion opened the pool: ${typo} > ${good}`)
})

test('a withdrawn health id does not widen the pool', () => {
  const good = pool(M({ health: ['gluten_sensitive'] }))
  const typo = pool(M({ health: ['gluten_allergy'] }))
  assert.ok(typo <= good, `unreadable health id opened the pool: ${typo} > ${good}`)
})

test('a typo\'d allergy does not widen the pool', () => {
  const good = pool(M({ health: ['soy_allergy'] }))
  const typo = pool(M({ health: ['soya_allergy'] }))
  assert.ok(typo <= good, `typo'd allergy opened the pool: ${typo} > ${good}`)
  // It could have been any allergy, so every one is assumed.
  assert.deepEqual(
    constraint(M({ health: ['soya_allergy'] })).allergens.sort(),
    ['dairy', 'nuts', 'sesame', 'soy'],
  )
})

test('a typo\'d fast blocks rather than planning around a guess', () => {
  const good = M({ fasts: ['ekadashi_vrat'] })
  const typo = M({ fasts: ['ekadashi_vrath'] })
  assert.equal(constraint(good, FAST_DAY).blocked, false)
  assert.equal(constraint(typo, FAST_DAY).blocked, true, 'the planner must refuse, not guess')
  assert.equal(hasBlockingId(typo), true)
  assert.equal(hasBlockingId(good), false)
})

test('unreadable ids are strictest, never absent', () => {
  const c = constraint(M({ diet: 'jian', religion: 'Budhist', health: ['made_up'] }))
  for (const flag of ['jainSafe', 'onionGarlicFree', 'vegan', 'alcoholFree',
    'lactoseFree', 'glutenFree', 'diabeticFriendly']) {
    assert.ok(c.requiredFlags.includes(flag), `expected ${flag} to be required`)
  }
  assert.deepEqual(c.allowedKinds, ['veg'], 'the vegetarian gate still fails safe')
})

test('a valid member raises no warning', () => {
  const clean = M({ diet: 'jain', religion: 'Jain', health: ['nut_allergy'], fasts: [] })
  assert.deepEqual(unknownMemberIds(clean), [])
  assert.deepEqual(familyIdWarnings([clean]), [])
})

test('missing values are not unrecognised values', () => {
  // Older rosters predate some fields; those have working defaults and always
  // did. Only a value that is present and unknown counts.
  assert.deepEqual(unknownMemberIds({ id: 'x', name: 'Legacy' }), [])
  assert.deepEqual(unknownMemberIds({ id: 'x', name: 'Legacy', diet: '', religion: '' }), [])
})

test('the warning names the member and says what to do', () => {
  const [w] = familyIdWarnings([M({ name: 'Asha', health: ['made_up'] })])
  assert.match(w.message, /^Asha has a health condition setting Thali doesn/)
  assert.match(w.message, /Please re-select it/)
  assert.equal(w.blocking, false)

  const [f] = familyIdWarnings([M({ name: 'Asha', fasts: ['not_a_fast'] })])
  assert.equal(f.blocking, true)
  assert.match(f.message, /will not plan a meal around a fast it cannot read/)
})
