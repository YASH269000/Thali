import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExplanation } from '../src/lib/explainPlan.js'

// The panel makes a promise the rest of the app has to keep: the counts are
// real, the examples are a stated sample of them, and nothing is implied to be
// the whole list. These are the properties that promise rests on.

function rejection(i, over = {}) {
  return {
    recipeId: `R${i}`,
    name: `Dish ${i}`,
    region: 'indian',
    source: 'INDB',
    kind: 'flag',
    memberId: 'm1',
    member: 'Sumitra',
    because: 'needs low-GI food',
    detail: 'high GI carbs',
    ...over,
  }
}

const CONSTRAINTS = [{ id: 'm1', name: 'Sumitra', diet: 'vegetarian', religion: 'Hindu' }]

test('counts are the real totals, not the number of examples shown', () => {
  const rejections = Array.from({ length: 369 }, (_, i) => rejection(i))
  const out = buildExplanation({ rejections, constraints: CONSTRAINTS, stats: {} })

  assert.equal(out.reasons.length, 1)
  assert.equal(out.reasons[0].count, 369)
  assert.equal(out.reasons[0].examples.length, 3)
})

test('one group per person and reason, so counts never double-count a dish', () => {
  const rejections = [
    ...Array.from({ length: 5 }, (_, i) => rejection(i)),
    ...Array.from({ length: 3 }, (_, i) => rejection(100 + i, { because: 'avoids lactose' })),
    ...Array.from({ length: 2 }, (_, i) => rejection(200 + i, { memberId: 'm2', member: 'Asha' })),
  ]
  const out = buildExplanation({ rejections, constraints: CONSTRAINTS, stats: {} })
  const total = out.reasons.reduce((n, r) => n + r.count, 0)

  assert.equal(out.reasons.length, 3)
  assert.equal(total, rejections.length)
})

test('examples are spread across the group, not the first three', () => {
  // The catalogue is ordered by source, so "the first three" would be three
  // INDB rows every time whatever the family asked for.
  const rejections = Array.from({ length: 300 }, (_, i) =>
    rejection(i, { source: i < 200 ? 'INDB' : 'International v2' }))
  const out = buildExplanation({ rejections, constraints: CONSTRAINTS, stats: {} })
  const picked = out.reasons[0].examples.map((e) => e.recipeId)

  assert.deepEqual(picked, ['R0', 'R100', 'R200'])
  assert.ok(new Set(picked).size === 3, 'no example is repeated')
})

test('the same input explains itself the same way twice', () => {
  const rejections = Array.from({ length: 50 }, (_, i) => rejection(i))
  const a = buildExplanation({ rejections, constraints: CONSTRAINTS, stats: {} })
  const b = buildExplanation({ rejections, constraints: CONSTRAINTS, stats: {} })

  assert.deepEqual(a.reasons, b.reasons)
})

test('a chosen cuisine leads with examples from that cuisine', () => {
  const rejections = [
    ...Array.from({ length: 40 }, (_, i) => rejection(i, { region: 'indian' })),
    ...Array.from({ length: 6 }, (_, i) => rejection(500 + i, { region: 'italian' })),
  ]
  const out = buildExplanation(
    { rejections, constraints: CONSTRAINTS, stats: {} },
    { cuisine: 'italian' },
  )

  assert.equal(out.reasons[0].count, 46)
  for (const e of out.reasons[0].examples) {
    assert.ok(e.recipeId.startsWith('R5'), `${e.recipeId} should be one of the Italian rows`)
  }
})

test('fewer rejections than the sample size shows them all, without padding', () => {
  const rejections = [rejection(1), rejection(2)]
  const out = buildExplanation({ rejections, constraints: CONSTRAINTS, stats: {} })

  assert.equal(out.reasons[0].examples.length, 2)
  assert.equal(out.moreReasons, 0)
})

test('groups beyond the cap are counted, never silently dropped', () => {
  // Ten distinct reasons, a cap of eight: the panel has to say so rather than
  // present its eight as the whole story.
  const rejections = Array.from({ length: 10 }, (_, i) =>
    rejection(i, { because: `reason ${i}` }))
  const out = buildExplanation({ rejections, constraints: CONSTRAINTS, stats: {} })

  assert.equal(out.reasons.length, 8)
  assert.equal(out.moreReasons, 2)
})

test('the biggest reasons are the ones shown', () => {
  const rejections = [
    ...Array.from({ length: 2 }, (_, i) => rejection(i, { because: 'small reason' })),
    ...Array.from({ length: 40 }, (_, i) => rejection(100 + i, { because: 'big reason' })),
  ]
  const out = buildExplanation({ rejections, constraints: CONSTRAINTS, stats: {} })

  assert.equal(out.reasons[0].because, 'big reason')
})

test('a family with nothing recorded still gets a funnel and no reasons', () => {
  const out = buildExplanation(
    { rejections: [], constraints: [{ id: 'm1', name: 'Asha', diet: 'non_veg', religion: 'none' }],
      stats: { catalogue: 1464, mains: 1464, swaps: 0, excluded: 0 } },
    { eligible: 333, candidatesSent: 80 },
  )

  assert.equal(out.reasons.length, 0)
  assert.equal(out.funnel.catalogue, 1464)
  assert.equal(out.constraints[0].sources.length, 0, 'non_veg and none are not constraints')
})

test('a guest is named as a guest', () => {
  const out = buildExplanation({
    rejections: [],
    constraints: [{ id: 'guest:1', name: 'Jain aunt', diet: 'jain', religion: 'Jain' }],
    stats: {},
  })

  assert.equal(out.constraints[0].isGuest, true)
  assert.deepEqual(out.constraints[0].sources.map((s) => s.kind), ['diet', 'religion'])
})

test('reasons name the member, never the flag key', () => {
  const out = buildExplanation({ rejections: [rejection(1)], constraints: CONSTRAINTS, stats: {} })
  const head = `${out.reasons[0].member} ${out.reasons[0].because}`

  assert.equal(head, 'Sumitra needs low-GI food')
  assert.ok(!/diabeticFriendly|:\s*no/.test(head), 'no flag keys in user-facing text')
})

test('a fast names the fast, driven through the real filter', async () => {
  // Today is a Tuesday fast, which carries no compliance flag, so the browser
  // could not render this wording. Drive it through filterRecipes instead of
  // exporting the private phrase helper to reach it.
  const { filterRecipes } = await import('../src/lib/mealPlanRules.js')
  const { default: recipes } = await import('../src/data/recipes.json', { with: { type: 'json' } })

  const family = [{
    id: 'm1', name: 'Sumitra', age: 62, diet: 'vegetarian', health: [],
    // She has to observe it: an active fast only binds the members keeping it.
    fasts: ['ekadashi_vrat'], religion: 'Hindu', lifeStage: 'elderly',
  }]
  const filtered = filterRecipes(recipes, family, new Set(['ekadashi_vrat']))
  const out = buildExplanation(filtered, {})
  const fastGroup = out.reasons.find((r) => r.kind === 'fast')

  assert.ok(fastGroup, 'a fast day sets dishes aside for the fast')
  assert.equal(fastGroup.because, 'is keeping Ekadashi')
  assert.equal(`${fastGroup.member} ${fastGroup.because}`, 'Sumitra is keeping Ekadashi')
  assert.ok(fastGroup.examples.length > 0, 'and shows what it set aside')
})
