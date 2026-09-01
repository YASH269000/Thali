// A withdrawn health id in storage does not weaken a filter — it removes it,
// because memberConstraints ignores an id it does not recognise. The migration
// repairs the stored data rather than compensating for it on every read.

import test from 'node:test'
import assert from 'node:assert/strict'
import { migrateFamily } from '../src/lib/family.js'

const member = (health) => ({ id: 'm1', name: 'Asha', diet: 'vegetarian', health })

test('a withdrawn id is rewritten to the option that replaced it', () => {
  const { family, changed } = migrateFamily([member(['gluten_allergy'])])
  assert.equal(changed, true)
  assert.deepEqual(family[0].health, ['gluten_sensitive'])
})

test('holding both the old and the new id does not produce a duplicate', () => {
  const { family, changed } = migrateFamily([member(['gluten_allergy', 'gluten_sensitive'])])
  assert.equal(changed, true)
  assert.deepEqual(family[0].health, ['gluten_sensitive'])
})

test('other conditions are untouched and keep their order', () => {
  const { family } = migrateFamily([member(['diabetes_t2', 'gluten_allergy', 'nut_allergy'])])
  assert.deepEqual(family[0].health, ['diabetes_t2', 'gluten_sensitive', 'nut_allergy'])
})

test('a family with nothing to migrate is reported unchanged', () => {
  const input = [member(['nut_allergy']), member([]), { id: 'm3', name: 'No health key' }]
  const { family, changed } = migrateFamily(input)
  assert.equal(changed, false, 'so loadFamily does not write back for nothing')
  assert.deepEqual(family[0].health, ['nut_allergy'])
  assert.deepEqual(family[1].health, [])
})

test('an empty or malformed roster does not throw', () => {
  assert.deepEqual(migrateFamily([]).family, [])
  assert.deepEqual(migrateFamily(undefined).family, [])
  assert.equal(migrateFamily([{ id: 'x', health: 'not-an-array' }]).changed, false)
})
