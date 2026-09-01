// Where the household is, and the one thing it must NOT change.
//
// A tithi is the same instant everywhere; only the sunrise it is measured
// against is local. That is still enough to move 14 of 352 observances across
// 2026 and 2027 — Kolkata's sunrise is about fifty minutes earlier than
// Delhi's and accounts for twelve of them, and Mumbai and Ahmedabad move two
// the other way.
//
// The shipped dates stay Delhi's. Recomputing a year per city in the browser
// costs about a second, and more importantly a date that silently differed
// from the published all-India panchang would be worse than one that asks.
// So the generator records where each date moves to and the family is asked.

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_LOCATION_KEY, LOCATION_OPTIONS, LOCATIONS, isDefaultLocation,
  locationName, placeFor,
} from '../src/lib/location.js'
import { CITIES, observancesOn, variantFor } from '../src/lib/observances.js'
import { fastingYear } from '../src/lib/fastingRules.js'
import { moveDate } from '../src/lib/observanceOverrides.js'
import computed from '../src/data/observances.json' with { type: 'json' }

const dateOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d) }

test('the eight cities are the engine\'s, not a second list', () => {
  assert.deepEqual(
    LOCATION_OPTIONS.map((o) => o.id).sort(),
    Object.keys(LOCATIONS).sort(),
  )
  // And the generator checked every one of them.
  assert.deepEqual(Object.keys(CITIES).sort(), Object.keys(LOCATIONS).sort())
  assert.equal(DEFAULT_LOCATION_KEY, 'delhi')
  assert.equal(locationName('mumbai'), 'Mumbai')
})

test('an unreadable city falls back to Delhi rather than to nothing', () => {
  // Every caller needs a place; a missing one would mean no sunrise at all,
  // and a screen with no times on it is a worse failure than the default.
  assert.equal(placeFor('atlantis').name, 'Delhi')
  assert.equal(placeFor(undefined).name, 'Delhi')
  assert.equal(isDefaultLocation('atlantis'), true)
})

/* ------------------------------------------------------------------ *
 * The invariant: dates do not move, questions appear                  *
 * ------------------------------------------------------------------ */

test('the shipped dates are Delhi\'s whatever city is selected', () => {
  // The one thing this step must not do. observancesOn takes no location and
  // must never learn to: a second source of dates is how two screens start
  // disagreeing about when Ekadashi is.
  const varying = computed.observances.find((o) => o.variesByCity?.kolkata)
  assert.ok(varying, 'nothing varies, so this test proves nothing')

  const onDelhiDate = observancesOn(dateOf(varying.date)).map((o) => o.id)
  assert.ok(onDelhiDate.includes(varying.id))
  const onKolkataDate = observancesOn(dateOf(varying.variesByCity.kolkata)).map((o) => o.id)
  assert.ok(!onKolkataDate.includes(varying.id),
    'the date moved by itself — it should have become a question instead')
})

test('a date that moves for your city becomes a question there and only there', () => {
  const varying = computed.observances.find((o) => o.variesByCity?.kolkata)
  assert.equal(variantFor(varying, 'delhi'), null)
  assert.equal(variantFor(varying, undefined), null)
  const v = variantFor(varying, 'kolkata')
  assert.equal(v.city, 'Kolkata')
  assert.equal(v.date, varying.variesByCity.kolkata)
})

test('Kolkata is asked more than Delhi, and the extra questions are the moved ones', () => {
  const family = [{ id: 'm1', name: 'Vrinda', fasts: ['ekadashi_vrat', 'purnima_vrat', 'sankashti_chaturthi'] }]
  const delhi = fastingYear(family, 2026, {}, 'delhi').confirmations
  const kolkata = fastingYear(family, 2026, {}, 'kolkata').confirmations

  assert.ok(kolkata.length > delhi.length,
    'a family in Kolkata is asked about no more dates than one in Delhi')
  for (const c of kolkata) {
    if (delhi.some((d) => d.id === c.id && d.date === c.date)) continue
    assert.ok(c.variant, `${c.date} ${c.name} is extra but carries no variant`)
    assert.notEqual(c.variant.date, c.date)
  }
  // Delhi's own questions are unchanged — the location adds, never removes.
  for (const d of delhi) {
    assert.ok(kolkata.some((c) => c.id === d.id && c.date === d.date), `${d.date} vanished`)
  }
})

test('answering a location question uses the same slot as every other answer', () => {
  const family = [{ id: 'm1', name: 'Vrinda', fasts: ['ekadashi_vrat'] }]
  const [first] = fastingYear(family, 2026, {}, 'kolkata').confirmations
    .filter((c) => c.variant)
  assert.ok(first, 'Kolkata asks about no Ekadashi')

  const answered = moveDate({}, first.id, first.date, first.variant.date)
  assert.deepEqual(Object.keys(answered), [`${first.id}@${first.date}`],
    'a location answer wrote to a slot of its own')
  const after = fastingYear(family, 2026, answered, 'kolkata').confirmations
  assert.ok(!after.some((c) => c.id === first.id && c.date === first.date),
    'answering it did not settle it')
  // And it must not survive its own answer. `variesByCity` still names the day
  // the occurrence now sits on, so a check that only looked at the keyword
  // would re-ask forever — about the very date it had just been given.
  // Matched on the occurrence, not the id: all 24 Ekadashis share an id.
  assert.ok(!after.some((c) => c.id === first.id && c.date === first.variant.date),
    'the row came back asking about the date it had just been given')
  assert.ok(observancesOn(dateOf(first.variant.date), answered).some((o) => o.id === first.id))
})

/* ------------------------------------------------------------------ *
 * What actually moves                                                 *
 * ------------------------------------------------------------------ */

test('the cross-city differences are recorded, and they are few', () => {
  const varying = computed.observances.filter((o) => o.variesByCity)
  assert.ok(varying.length > 0, 'the generator recorded no variance at all')
  // Few enough to ask about: 14 of 352 across two years. If this ever grows
  // past a handful the prompt becomes noise and the design needs revisiting.
  assert.ok(varying.length < 30,
    `${varying.length} dates vary by city — too many to put to a family one at a time`)

  for (const o of varying) {
    for (const [city, date] of Object.entries(o.variesByCity)) {
      assert.ok(LOCATIONS[city], `${o.id} names a city that does not exist: ${city}`)
      assert.notEqual(date, o.date, `${o.id} lists ${city} with Delhi's own date`)
      assert.match(date, /^\d{4}-\d{2}-\d{2}$/)
      // A tithi moves by a day, never more: the sunrise it is measured
      // against differs by under an hour across these eight cities.
      const gap = Math.abs(Date.parse(date) - Date.parse(o.date)) / 86400000
      assert.equal(gap, 1, `${o.id} moves ${gap} days in ${city}`)
    }
  }
})

test('Delhi is never listed as varying from itself', () => {
  for (const o of computed.observances) {
    assert.ok(!o.variesByCity?.delhi, `${o.id} lists Delhi as varying`)
  }
})
