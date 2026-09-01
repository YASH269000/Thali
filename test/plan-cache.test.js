// The last plan that worked, offered when every retry has failed. It is a
// fallback, not a fresh answer — the banner says so, and these pin the parts
// that decide whether one is available at all.

import test from 'node:test'
import assert from 'node:assert/strict'

// A localStorage stand-in, installed before the module reads window.
const store = {}
globalThis.window = {
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: (k) => { delete store[k] },
  },
}
const { rememberPlan, recallPlan, describeSavedAt, PLAN_CACHE_KEY } = await import('../src/lib/planCache.js')

const reset = () => { delete store[PLAN_CACHE_KEY] }
const planOf = (names, extra = {}) => ({
  dishes: names.map((name, i) => ({ recipeId: `R${i}`, name })),
  headcount: 4,
  ...extra,
})

test('a plan comes back for the exact key it was stored under', () => {
  reset()
  rememberPlan('lunch|m1||indian', planOf(['Dal Tadka']))
  assert.equal(recallPlan('lunch|m1||indian').plan.dishes[0].name, 'Dal Tadka')
  assert.equal(recallPlan('dinner|m1||indian'), null, 'a different meal is a different plan')
  assert.equal(recallPlan('lunch|m1||Italian'), null, 'a different cuisine too')
  assert.equal(recallPlan('lunch|m1,m2||indian'), null, 'and a different set of diners')
})

test('alternates are dropped — 107 KB of a 119 KB plan, and useless to a fallback', () => {
  reset()
  rememberPlan('k', planOf(['Dal Tadka'], { alternates: { dal: [{ recipeId: 'X', big: 'x'.repeat(1000) }] } }))
  const { plan } = recallPlan('k')
  assert.equal(plan.alternates, undefined)
  assert.equal(plan.dishes.length, 1, 'everything else survives')
  assert.equal(plan.headcount, 4)
})

test('a plan with no dishes is never stored or offered', () => {
  reset()
  rememberPlan('k', { dishes: [] })
  assert.equal(recallPlan('k'), null)
  rememberPlan('k', null)
  assert.equal(recallPlan('k'), null)
  assert.equal(recallPlan(''), null)
})

test('the oldest entry is evicted once six combinations are held', () => {
  reset()
  for (let i = 0; i < 8; i += 1) {
    rememberPlan(`key-${i}`, planOf([`Dish ${i}`]))
    // Distinct timestamps, so eviction order is well defined.
    const all = JSON.parse(store[PLAN_CACHE_KEY])
    all[`key-${i}`].savedAt = new Date(2026, 0, 1 + i).toISOString()
    store[PLAN_CACHE_KEY] = JSON.stringify(all)
  }
  const held = Object.keys(JSON.parse(store[PLAN_CACHE_KEY]))
  assert.equal(held.length, 6)
  assert.ok(!held.includes('key-0'), 'oldest gone')
  assert.ok(held.includes('key-7'), 'newest kept')
})

test('corrupt storage is treated as an empty cache, never a crash', () => {
  store[PLAN_CACHE_KEY] = 'not json'
  assert.equal(recallPlan('k'), null)
  store[PLAN_CACHE_KEY] = '[1,2,3]'
  assert.equal(recallPlan('k'), null)
  reset()
  assert.equal(recallPlan('k'), null)
})

test('the banner names when the plan was made', () => {
  assert.match(describeSavedAt(new Date().toISOString()), /^earlier today, /)
  assert.match(describeSavedAt('2026-08-31T10:00:00.000Z'), /31 August/)
  assert.equal(describeSavedAt('nonsense'), 'an earlier session')
})
