// The Theravada observances, and the confidence they are honestly owed.
//
// Vesak, Asalha Puja and Magha Puja are purnimas. The engine resolves a
// purnima to the minute and was therefore marking Vesak `computed` — the same
// confidence as an Ekadashi checked 24 of 24 against Drik Panchang. That is
// not equivalent evidence, and the difference is not about the astronomy.
//
// These belong to the Theravada calendars, which intercalate on a different
// rule from the Indian one: the engine implements "a lunar month with no solar
// ingress", while the Thai calendar inserts a second Ashadha on a fixed cycle.
// Nothing here models that reckoning, so nothing has ever checked which month
// the engine's Ashadha is in Bangkok. When the rules disagree the gap is a
// MONTH — 2026 carries Adhika Jyeshtha immediately before Ashadha, which would
// put Asalha Puja around 30 June rather than 29 July.
//
// So: exact arithmetic, unverified calendar, marked provisional and
// override-able. The same treatment as the Islamic dates and for the same
// structural reason.

import test from 'node:test'
import assert from 'node:assert/strict'

import { CONFIDENCE, OBSERVANCE_FASTS, templateFor } from '../src/lib/observances.js'
import { fastingYear } from '../src/lib/fastingRules.js'
import { mealsAttendedBy } from '../src/lib/observanceProfile.js'
import { moveDate } from '../src/lib/observanceOverrides.js'
import { FAST_LABEL } from '../src/data/memberOptions.js'
import computed from '../src/data/observances.json' with { type: 'json' }

const buddhist = computed.observances.filter((o) => o.religion === 'Buddhist')
const byId = (id) => computed.observances.filter((o) => o.id === id)

test('every Theravada date is provisional, and says why on the row', () => {
  assert.ok(buddhist.length >= 8, `only ${buddhist.length} Buddhist observances`)
  for (const o of buddhist) {
    assert.equal(o.confidence, CONFIDENCE.PROVISIONAL,
      `${o.id} on ${o.date} claims ${o.confidence}`)
    assert.ok(o.provisionalReason, `${o.id} is provisional with no reason given`)
    assert.match(o.provisionalReason, /Theravada/)
    assert.match(o.provisionalReason, /MONTH, not a day/)
  }
})

test('Vesak is among them — it was the one already shipping overconfident', () => {
  const vesak = byId('buddha_purnima')
  assert.equal(vesak.length, 2)
  for (const o of vesak) assert.equal(o.confidence, CONFIDENCE.PROVISIONAL)
})

test('the three derive from purnimas the engine already computes', () => {
  // Not new astronomy — the same mapping shape as Uposatha.
  const purnimaOn = (date) => computed.observances
    .some((o) => o.id === 'purnima' && o.date === date)
  for (const id of ['asalha_puja', 'magha_puja', 'buddha_purnima']) {
    for (const o of byId(id)) {
      assert.ok(purnimaOn(o.date), `${id} on ${o.date} is not a purnima the engine computes`)
    }
  }
  assert.deepEqual(byId('asalha_puja').map((o) => o.date), ['2026-07-29', '2027-07-18'])
  assert.deepEqual(byId('magha_puja').map((o) => o.date), ['2026-02-01', '2027-02-20'])
})

test('Vassa runs three lunar months from the day after Asalha', () => {
  const vassa = byId('vassa')
  assert.equal(vassa.length, 2)
  for (const v of vassa) {
    const asalha = byId('asalha_puja').find((o) => o.date.slice(0, 4) === v.date.slice(0, 4))
    const dayAfter = new Date(`${asalha.date}T00:00:00Z`)
    dayAfter.setUTCDate(dayAfter.getUTCDate() + 1)
    assert.equal(v.date, dayAfter.toISOString().slice(0, 10), 'Vassa does not begin the day after Asalha')

    // Ends on the Ashwin full moon: 89 days in both years, which is the
    // arithmetic checking itself against three lunar months.
    const span = (Date.parse(v.through) - Date.parse(v.date)) / 86400000 + 1
    assert.equal(span, 89, `${v.date} spans ${span} days`)
    assert.ok(computed.observances.some((o) => o.id === 'purnima' && o.date === v.through
      && o.masa === 'Ashwin'))
    assert.equal(v.confidence, CONFIDENCE.PROVISIONAL)
  }
})

/* ------------------------------------------------------------------ *
 * Selectable, not the jain_chaturdashi position                       *
 * ------------------------------------------------------------------ */

test('all four are reachable by a tradition somebody can tick', () => {
  for (const id of ['buddha_purnima', 'asalha_puja', 'magha_puja', 'vassa']) {
    const fasts = OBSERVANCE_FASTS[id]
    assert.ok(fasts?.length > 0, `${id} is computed and observable by nobody`)
    for (const f of fasts) assert.ok(FAST_LABEL[f], `${id} names a tradition that does not exist: ${f}`)
    assert.ok(templateFor(id), `${id} has no template, so no date can be added for it`)
  }
})

test('the Eight Precepts shape the day the same way Uposatha does', () => {
  const observer = (fasts) => ({ id: 'm1', name: 'Tenzin', diet: 'vegetarian',
    health: [], lifeStage: 'adult', fasts })
  for (const f of ['asalha_puja', 'magha_puja']) {
    assert.deepEqual(mealsAttendedBy(observer([f]), new Set([f])), ['breakfast', 'lunch'],
      `${f} planned a meal after midday`)
  }
  // Vassa is three months of added restraint, not a fasting day: the meals
  // stand and what changes is what is in them.
  assert.deepEqual(
    mealsAttendedBy(observer(['vassa_rains_retreat']), new Set(['vassa_rains_retreat'])),
    ['breakfast', 'lunch', 'dinner'])
})

/* ------------------------------------------------------------------ *
 * Provisional means asked, and answerable                             *
 * ------------------------------------------------------------------ */

test('a Buddhist household is prompted about all of them, and can answer', () => {
  const family = [{ id: 'm1', name: 'Ananda',
    fasts: ['vesak_buddha_purnima', 'asalha_puja', 'magha_puja'] }]
  const asked = fastingYear(family, 2026, {}, 'delhi').confirmations
  assert.deepEqual(asked.map((o) => o.id).sort(),
    ['asalha_puja', 'buddha_purnima', 'magha_puja'])

  // And answering settles it, through the same slot as every other answer.
  let overrides = {}
  for (const q of asked) overrides = moveDate(overrides, q.id, q.date, q.variant?.date || q.date)
  assert.deepEqual(fastingYear(family, 2026, overrides, 'delhi').confirmations, [])
})

/* ------------------------------------------------------------------ *
 * The city check that has caught two already                          *
 * ------------------------------------------------------------------ */

test('the Uposatha days that vary by city are reachable and prompted there', () => {
  // Two of the fourteen are days Uposatha is kept on — Kalashtami 3 October
  // and the Purnima of 23 December — so a Buddhist household in an affected
  // city must be asked, and one elsewhere must not.
  const varying = computed.observances.filter((o) => o.variesByCity
    && (OBSERVANCE_FASTS[o.id] || []).includes('uposatha_observance'))
  assert.ok(varying.length >= 2, `${varying.length} Uposatha days vary by city`)

  const tenzin = [{ id: 'm1', name: 'Tenzin', fasts: ['uposatha_observance'] }]
  const asked = (city) => fastingYear(tenzin, 2026, {}, city).confirmations.map((c) => c.date)

  assert.ok(asked('kolkata').includes('2026-10-03'), 'Kolkata is not asked about its Kalashtami')
  assert.ok(asked('varanasi').includes('2026-10-03'))
  assert.ok(!asked('delhi').includes('2026-10-03'),
    'a Delhi household was asked about another city\'s date')
  assert.ok(!asked('mumbai').includes('2026-10-03'))
})

test('every city-varying observance is reachable by somebody', () => {
  // The invariant that has now caught three separate cases. A date that varies
  // and reaches nobody is a question that can never be put.
  for (const o of computed.observances) {
    if (!o.variesByCity) continue
    assert.ok((OBSERVANCE_FASTS[o.id] || []).length > 0,
      `${o.id} on ${o.date} varies by city and nobody can select it`)
  }
})
