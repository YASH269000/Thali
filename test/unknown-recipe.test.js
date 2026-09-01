// A dish the model invented has no ingredients, no method and no compliance
// flags. It passed no diet, allergy, religion or fasting check, while every
// other dish on the plate was verified in code before the model saw it. These
// pin that it never reaches the plate.
//
// The model is stubbed at the fetch boundary rather than mocked, so the retry
// is observed as a second real request from the SDK.

import test from 'node:test'
import assert from 'node:assert/strict'

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key-long-enough-to-pass-the-unset-check'

const { default: handler } = await import('../api/generate-plan.js')

const KNOWN = 'B003'   // Chapati/Roti
const INVENTED = 'ZZZ999'

const planWith = (ids) => JSON.stringify({
  dishes: ids.map((id) => ({
    recipeId: id, name: `Dish ${id}`, role: 'bread',
    servesMembers: ['m1'], excludedMembers: [], substitutes: [], why: 'test',
  })),
  perMemberNotes: {}, prepTimeTotalMin: 30, planSummary: 'test plan',
})

/** Stub Gemini at the fetch boundary; returns the call log. */
function stubModel(responses) {
  const calls = []
  const real = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? String(init.body) : '' })
    const text = responses[Math.min(calls.length - 1, responses.length - 1)]
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  return { calls, restore: () => { globalThis.fetch = real } }
}

function fakeRes() {
  const out = { statusCode: null, body: null, headers: {} }
  return {
    out,
    setHeader(k, v) { out.headers[k] = v },
    status(code) { out.statusCode = code; return this },
    json(payload) { out.body = payload; return this },
  }
}

const body = {
  family: [{
    id: 'm1', name: 'Asha', age: 32, relationship: 'self', diet: 'vegetarian',
    health: [], fasts: [], religion: 'Hindu', spiceLevel: 2, dislikes: '', lifeStage: 'adult',
  }],
  presentMembers: ['m1'],
  mealType: 'lunch',
  date: '2026-09-01T06:00:00.000Z',
  cuisine: 'indian',
}

test('an invented recipeId triggers exactly one retry, and a good retry is accepted', async () => {
  const stub = stubModel([planWith([KNOWN, INVENTED]), planWith([KNOWN])])
  try {
    const res = fakeRes()
    await handler({ method: 'POST', body }, res)

    assert.equal(res.out.statusCode, 200)
    assert.equal(stub.calls.length, 2, 'one initial call plus one retry')
    assert.match(stub.calls[1].body, /YOUR PREVIOUS ANSWER WAS REJECTED/)
    assert.match(stub.calls[1].body, new RegExp(INVENTED), 'the retry names the invented id')
    assert.match(stub.calls[1].body, /must use a recipeId that appears verbatim/)

    assert.equal(res.out.body.dishes.length, 1)
    assert.equal(res.out.body.dishes[0].recipeId, KNOWN)
    assert.equal(res.out.body.unknownNote, null, 'nothing was dropped, so nothing to say')
  } finally { stub.restore() }
})

test('a retry that invents again drops the dish and says so', async () => {
  const stub = stubModel([planWith([KNOWN, INVENTED])])   // same answer both times
  try {
    const res = fakeRes()
    await handler({ method: 'POST', body }, res)

    assert.equal(res.out.statusCode, 200)
    assert.equal(stub.calls.length, 2, 'retried once, then gave up')

    const { dishes, unknownNote, ingredientsAggregated } = res.out.body
    assert.equal(dishes.length, 1, 'the invented dish is gone')
    assert.equal(dishes[0].recipeId, KNOWN)
    assert.ok(unknownNote, 'the drop is visible, not silent')
    assert.match(unknownNote, /left out/)
    assert.match(unknownNote, /never checked against anyone/)

    // The list covers exactly the dishes shown - the silent shortfall is gone.
    assert.ok(ingredientsAggregated.length > 0)
    assert.equal(dishes.every((d) => d.known), true, 'every surviving dish is real')
    assert.equal(dishes.every((d) => d.ingredients), true, 'and has ingredients to shop for')
  } finally { stub.restore() }
})

test('a plan of nothing but invented dishes is an error, not an empty plan', async () => {
  const stub = stubModel([planWith([INVENTED])])
  try {
    const res = fakeRes()
    await handler({ method: 'POST', body }, res)
    assert.equal(res.out.statusCode, 502)
    assert.match(res.out.body.error, /recipes that do not exist/)
    assert.equal(res.out.body.dishes, undefined, 'no dishless plan reaches the client')
  } finally { stub.restore() }
})

test('a clean answer is not retried', async () => {
  const stub = stubModel([planWith([KNOWN])])
  try {
    const res = fakeRes()
    await handler({ method: 'POST', body }, res)
    assert.equal(res.out.statusCode, 200)
    assert.equal(stub.calls.length, 1, 'no wasted model call')
    assert.equal(res.out.body.unknownNote, null)
  } finally { stub.restore() }
})
