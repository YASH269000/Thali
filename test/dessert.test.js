// 153 dessert-role recipes are reachable from no meal: lunch and dinner do not
// admit the role, and no dessert name reads as breakfast. A dessert is added
// alongside the meal on request rather than by widening those pools — a thali
// is not improved by a gulab jamun competing with the dal for a slot.
//
// The dessert is drawn from the same filtered pool as everything else, so
// "it passes every constraint the meal passes" is structural rather than a
// rule applied twice. These pin that, and the reasons it is withheld.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { filterRecipes, dessertsFor, dessertAvailability, roleOf } from '../src/lib/mealPlanRules.js'
import { activeFastIdsOn } from '../src/lib/fastingRules.js'

const RECIPES = JSON.parse(fs.readFileSync(new URL('../src/data/recipes.json', import.meta.url), 'utf8'))
const M = (o) => ({ id: 'm1', name: 'Asha', age: 32, relationship: 'self', diet: 'vegetarian',
  health: [], fasts: [], religion: 'Hindu', spiceLevel: 2, lifeStage: 'adult', ...o })
const run = (member, fasts = new Set()) => filterRecipes(RECIPES, [member], fasts)
const EKADASHI = activeFastIdsOn(new Date('2026-09-07T06:00:00.000Z'))

test('a dessert is only ever drawn from the pool that already passed every constraint', () => {
  for (const member of [M({ diet: 'vegan' }), M({ health: ['nut_allergy'] }), M({ religion: 'Buddhist' })]) {
    const { mains } = run(member)
    const desserts = dessertsFor(mains, 'indian')
    assert.ok(desserts.every((r) => mains.includes(r)), 'every dessert came from mains')
    assert.ok(desserts.every((r) => roleOf(r) === 'dessert'), 'and every one is a dessert')
  }
})

test('a diabetic member never gets a high-GI dessert', () => {
  const { mains } = run(M({ health: ['diabetes_t2'] }))
  const indian = dessertsFor(mains, 'indian')
  assert.ok(indian.length > 0, 'Indian sweets remain available')
  assert.ok(
    indian.every((r) => r.flags.diabeticFriendly.status !== 'no'),
    'not one of them is diabeticFriendly: no',
  )
})

test('every International v2 dessert is high-GI, so a diabetic member is told why', () => {
  const { mains, constraints } = run(M({ health: ['diabetes_t2'] }))
  for (const cuisine of ['Italian', 'Thai', 'East Asian', 'Mexican', 'Continental', 'Middle Eastern', 'Indo-Chinese']) {
    const a = dessertAvailability(mains, RECIPES, cuisine, constraints)
    assert.equal(a.available, false, `${cuisine} should have no diabetic-safe dessert`)
    assert.match(a.reason, /high-GI/, `${cuisine} should say why`)
  }
})

test('a fast day removes every non-Indian dessert, and keeps the fasting sweets', () => {
  const { mains, constraints } = run(M({ fasts: ['ekadashi_vrat'] }), EKADASHI)

  for (const cuisine of ['Italian', 'Thai', 'East Asian']) {
    assert.equal(dessertsFor(mains, cuisine).length, 0, `${cuisine} desserts are not ekadashiSafe`)
    assert.match(dessertAvailability(mains, RECIPES, cuisine, constraints).reason, /fast/)
  }

  // Indian sweets made for fasting do survive, and should: Sabudana Kheer and
  // Singhare Ka Halwa exist precisely to be eaten on a vrat.
  const indian = dessertsFor(mains, 'indian')
  assert.ok(indian.length > 0, 'fasting sweets are still desserts')
  assert.ok(
    indian.every((r) => r.flags.ekadashiSafe.status === 'yes'),
    'and every one of them is ekadashiSafe',
  )
})

test('an unavailable dessert always carries a reason, never a bare no', () => {
  const { mains, constraints } = run(M({ health: ['diabetes_t2'] }))
  const a = dessertAvailability(mains, RECIPES, 'Italian', constraints)
  assert.equal(a.available, false)
  assert.ok(a.reason && a.reason.length > 20, 'the reason is a sentence, not a shrug')
  assert.equal(a.count, 0)
})

test('the cuisine is honoured — a dessert never comes from a different table', () => {
  const { mains } = run(M({}))
  for (const cuisine of ['Italian', 'Thai', 'Mexican']) {
    assert.ok(
      dessertsFor(mains, cuisine).every((r) => r.region === cuisine),
      `${cuisine} desserts are all ${cuisine}`,
    )
  }
  assert.ok(
    dessertsFor(mains, 'indian').every((r) => r.source !== 'International v2'),
    'and Indian means Indian',
  )
})
