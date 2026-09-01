// Dates a family sets themselves, which is the safety valve for the two things
// no calculation settles.
//
// An Islamic month begins when the crescent is sighted, locally: Eid al-Adha
// 2026 was kept on 27 May in Jammu & Kashmir and 28 May across the rest of
// India — one country, one year, two dates. And a tithi that turns near
// sunrise puts one panchang a day away from another.
//
// The Day of Arafah is the case exercised end to end below rather than Eid
// al-Adha, and for a reason worth recording: Eid is a feast, so it maps to no
// fasting tradition and moving it changes no plate. Arafah is the day before
// it, carries the identical sighting question, and is a dawn-to-sunset fast —
// so it is the one where the fast, the banner, attendance and the pool can all
// be watched to move together.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  addDate, addedDatesFor, answerFor, clearOverride, confirmDate, moveDate,
  readOverrides, removeDate, setAnswer,
} from '../src/lib/observanceOverrides.js'
import {
  CONFIDENCE, OBSERVANCE_TEMPLATES, datesNeedingConfirmation, isoDateOf,
  observanceIdForFast, observancesOn, observedObservanceIds, occurrencesOf,
  resolvedDatesFor, templateFor,
} from '../src/lib/observances.js'
import { activeFastIdsOn, fastingYear } from '../src/lib/fastingRules.js'
import { mealsAttendedBy } from '../src/lib/observanceProfile.js'
import { filterRecipes } from '../src/lib/mealPlanRules.js'
import { FAST_LABEL } from '../src/data/memberOptions.js'
import computed from '../src/data/observances.json' with { type: 'json' }

const RECIPES = JSON.parse(fs.readFileSync(new URL('../src/data/recipes.json', import.meta.url), 'utf8'))

/** Read out of the shipped calendar, never typed in. */
const shipped = (id) => {
  const hit = [...computed.observances, ...computed.provisional]
    .find((o) => o.id === id && o.date.startsWith('2026'))
  assert.ok(hit, `nothing shipped for ${id} in 2026`)
  return hit
}

const ARAFAH = shipped('arafah')
const dateOf = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d) }
const dayAfter = (iso) => { const d = dateOf(iso); d.setDate(d.getDate() + 1); return isoDateOf(d) }

/* ------------------------------------------------------------------ *
 * One slot, four answers, no way to disagree                          *
 * ------------------------------------------------------------------ */

test('a confirmation and a manual edit cannot both be held', () => {
  // They are not two mechanisms to reconcile — they are two values of one
  // slot, and the writer replaces rather than merges.
  let ov = confirmDate({}, 'arafah', ARAFAH.date)
  assert.deepEqual(answerFor(ov, 'arafah', ARAFAH.date), { confirmed: true })

  ov = moveDate(ov, 'arafah', ARAFAH.date, dayAfter(ARAFAH.date))
  assert.equal(Object.keys(ov).length, 1, 'a second entry appeared for the same day')
  assert.deepEqual(answerFor(ov, 'arafah', ARAFAH.date), { movedTo: dayAfter(ARAFAH.date) })

  ov = removeDate(ov, 'arafah', ARAFAH.date)
  assert.deepEqual(answerFor(ov, 'arafah', ARAFAH.date), { removed: true })

  ov = clearOverride(ov, 'arafah', ARAFAH.date)
  assert.deepEqual(ov, {})
})

test('an entry that names two answers resolves to one', () => {
  // Storage is hand-editable and arrives over the wire. A value claiming both
  // "the date is right" and "we keep it later" must not apply both.
  const messy = readOverrides({
    'arafah@2026-05-26': { confirmed: true, movedTo: '2026-05-27', removed: true },
  })
  assert.deepEqual(messy['arafah@2026-05-26'], { removed: true })
  assert.equal(Object.keys(messy['arafah@2026-05-26']).length, 1)
})

test('moving a date onto itself is a confirmation, not a move', () => {
  const ov = moveDate({}, 'arafah', ARAFAH.date, ARAFAH.date)
  assert.deepEqual(answerFor(ov, 'arafah', ARAFAH.date), { confirmed: true })
})

test('junk is dropped rather than half-applied', () => {
  assert.deepEqual(readOverrides({ 'no-at-sign': { confirmed: true } }), {})
  assert.deepEqual(readOverrides({ 'x@not-a-date': { confirmed: true } }), {})
  assert.deepEqual(readOverrides({ 'Bad Id@2026-01-01': { confirmed: true } }), {})
  assert.deepEqual(readOverrides({ 'ok@2026-01-01': { movedTo: 'tomorrow' } }), {})
  assert.deepEqual(readOverrides(null), {})
  assert.deepEqual(setAnswer({}, 'ok', '2026-01-01', { nonsense: true }), {})
})

/* ------------------------------------------------------------------ *
 * Precedence, and what a user date may and may not change             *
 * ------------------------------------------------------------------ */

test('a user date overrides the date and nothing else about the tradition', () => {
  const template = templateFor('upvas_complete_day_fast')
  const ov = addDate({}, 'upvas_complete_day_fast', '2026-06-15')
  const entry = observancesOn(dateOf('2026-06-15'), ov).find((o) => o.addedByFamily)

  assert.ok(entry, 'the added date did not reach the calendar')
  // Every one of these is cloned from the tradition, not supplied by whoever
  // set the date. There is no field a household can type that changes what
  // the fast means — only when they keep it.
  assert.equal(entry.name, template.name)
  assert.equal(entry.religion, template.religion)
  assert.deepEqual(entry.fastIds, template.fastIds)
  assert.equal(entry.date, '2026-06-15')
  assert.equal(entry.source, 'override')
})

test('user beats curated beats computed', () => {
  // Computed, untouched.
  const ekadashi = shipped('ekadashi_vrat')
  const plain = observancesOn(dateOf(ekadashi.date)).find((o) => o.id === 'ekadashi_vrat')
  assert.equal(plain.source, 'computed')

  // Curated, untouched — the engine holds no rule for a Jain sect date.
  const paryushana = observancesOn(dateOf('2026-09-10')).find((o) => o.id === 'paryushana_parva')
  assert.equal(paryushana.source, 'curated')

  // A user answer outranks either.
  for (const [id, date] of [['ekadashi_vrat', ekadashi.date], ['paryushana_parva', '2026-09-09']]) {
    const ov = moveDate({}, id, date, dayAfter(date))
    assert.equal(observancesOn(dateOf(date), ov).filter((o) => o.id === id).length, 0,
      `${id} did not leave its shipped date`)
    const moved = observancesOn(dateOf(dayAfter(date)), ov).find((o) => o.id === id)
    assert.equal(moved.source, 'override')
    assert.equal(moved.movedFrom, date)
  }
})

test('a removed occurrence disappears but stays reversible', () => {
  const ekadashi = shipped('ekadashi_vrat')
  const ov = removeDate({}, 'ekadashi_vrat', ekadashi.date)
  assert.equal(observancesOn(dateOf(ekadashi.date), ov).filter((o) => o.id === 'ekadashi_vrat').length, 0)

  // Still listed on the dates screen, marked removed, so it can be put back.
  const shownAsRemoved = occurrencesOf('ekadashi_vrat', 2026, ov)
    .filter((o) => o.source === 'removed').map((o) => o.date)
  assert.deepEqual(shownAsRemoved, [ekadashi.date])

  const back = clearOverride(ov, 'ekadashi_vrat', ekadashi.date)
  assert.equal(observancesOn(dateOf(ekadashi.date), back).filter((o) => o.id === 'ekadashi_vrat').length, 1)
})

test('one day cannot hold the same tradition twice', () => {
  // The collision worth guarding: a shipped Shivaratri moved to the 16th, and
  // a date added for the same tradition on the 16th. Different ids — the
  // engine's rule id and the tradition slug — so the guard is on what an
  // entry covers, not on its id.
  const shivaratri = shipped('maha_shivaratri')
  const moved = dayAfter(shivaratri.date)
  let ov = moveDate({}, 'maha_shivaratri', shivaratri.date, moved)
  ov = addDate(ov, 'maha_shivaratri_vrat', moved)

  const hits = observancesOn(dateOf(moved), ov)
    .filter((o) => (o.fastIds || []).includes('maha_shivaratri_vrat'))
  assert.equal(hits.length, 1, 'the same fast landed on one day twice')
  assert.equal(hits[0].movedFrom, shivaratri.date, 'the relocated entry lost its provenance')
})

test('adding a date the calendar already produces is refused, not duplicated', () => {
  const ekadashi = shipped('ekadashi_vrat')
  const resolvesTo = resolvedDatesFor('ekadashi_vrat', {})
  assert.ok(resolvesTo.includes(ekadashi.date))
  assert.deepEqual(addDate({}, 'ekadashi_vrat', ekadashi.date, { resolvesTo }), {},
    'a redundant entry was written that the family would have to delete')
})

test('a multi-day added date covers every day of its span', () => {
  const ov = addDate({}, 'upvas_complete_day_fast', '2026-06-15', { through: '2026-06-17' })
  for (const day of ['2026-06-15', '2026-06-16', '2026-06-17']) {
    assert.ok(observancesOn(dateOf(day), ov).some((o) => o.addedByFamily), day)
  }
  assert.ok(!observancesOn(dateOf('2026-06-18'), ov).some((o) => o.addedByFamily))
  assert.deepEqual(addedDatesFor(ov, 'upvas_complete_day_fast'),
    [{ date: '2026-06-15', through: '2026-06-17' }])
})

/* ------------------------------------------------------------------ *
 * Every tradition can be given a date                                 *
 * ------------------------------------------------------------------ */

test('every tradition a member can select can also be given a date', () => {
  // Sixteen of the forty-three ship no date at all — Ekasana, Upvas and
  // Varsitap are kept on a day the practitioner chooses — and those are
  // exactly the ones a household most needs this for.
  const missing = Object.keys(FAST_LABEL)
    .filter((fastId) => !templateFor(observanceIdForFast(fastId)))
  assert.deepEqual(missing, [],
    'a selectable tradition has no template, so a date added for it would carry no rules')
})

test('every template names a religion and at least one tradition', () => {
  for (const [id, t] of OBSERVANCE_TEMPLATES) {
    assert.ok(t.name, `${id} has no name`)
    assert.ok(t.religion, `${id} has no religion`)
    assert.ok(Array.isArray(t.fastIds), `${id} has no fastIds`)
  }
})

test('an added Ekadashi is called Ekadashi, not last September\'s name', () => {
  // The shipped names are per-occurrence — "Aja Ekadashi" is one night in
  // September, not the tradition — so a template must not carry one.
  assert.equal(templateFor('ekadashi_vrat').name, 'Ekadashi Vrat')
})

/* ------------------------------------------------------------------ *
 * Provisional dates now carry the same one-tap answer                 *
 * ------------------------------------------------------------------ */

const base = {
  age: 40, relationship: 'self', diet: 'vegetarian', health: [], religion: 'Muslim',
  cuisine: 'north_indian', spiceLevel: 2, dislikes: '', lifeStage: 'adult',
}
const NASREEN = { ...base, id: 'm1', name: 'Nasreen', fasts: ['arafah_fast_day_of_arafah'] }

test('a provisional date is offered the same one-tap answer as a tithi date', () => {
  const asked = datesNeedingConfirmation(2026, {})
  const provisional = asked.filter((o) => o.confidence === CONFIDENCE.PROVISIONAL)
  const unstable = asked.filter((o) => o.confidence === CONFIDENCE.UNSTABLE)
  assert.ok(provisional.length > 0, 'no provisional date is ever put to the family')
  assert.ok(unstable.length > 0, 'the tithi-boundary dates stopped being asked')

  // Narrowed to what the family actually keeps, as before.
  const mine = fastingYear([NASREEN], 2026, {}).confirmations
  assert.deepEqual(mine.map((o) => o.id), ['arafah'])

  // And answering settles it.
  const settled = fastingYear([NASREEN], 2026, confirmDate({}, 'arafah', ARAFAH.date)).confirmations
  assert.deepEqual(settled, [])
})

test('a Hindu family is not asked about Islamic dates', () => {
  const hindu = { ...base, id: 'm2', name: 'Vrinda', religion: 'Hindu', fasts: ['ekadashi_vrat'] }
  assert.deepEqual(fastingYear([hindu], 2026, {}).confirmations.map((o) => o.date), ['2026-07-10'])
})

/* ------------------------------------------------------------------ *
 * The whole thing moves together                                      *
 * ------------------------------------------------------------------ */

test('moving a provisional Islamic date moves the fast, attendance and the pool', () => {
  const from = ARAFAH.date
  const to = dayAfter(from)
  assert.equal(ARAFAH.confidence, CONFIDENCE.PROVISIONAL)

  const ov = moveDate({}, 'arafah', from, to)
  const fastsOn = (iso, o) => activeFastIdsOn(dateOf(iso), o)
  const poolOn = (iso, o) => filterRecipes(RECIPES, [NASREEN], fastsOn(iso, o)).mains.length

  // The fast.
  assert.ok(fastsOn(from, {}).has('arafah_fast_day_of_arafah'))
  assert.ok(!fastsOn(to, {}).has('arafah_fast_day_of_arafah'))
  assert.ok(!fastsOn(from, ov).has('arafah_fast_day_of_arafah'), 'the fast stayed on the old day')
  assert.ok(fastsOn(to, ov).has('arafah_fast_day_of_arafah'), 'the fast did not reach the new day')

  // The banner — what the plan screen and the prompt name.
  assert.equal(observancesOn(dateOf(from), ov).filter((o) => o.id === 'arafah').length, 0)
  const moved = observancesOn(dateOf(to), ov).find((o) => o.id === 'arafah')
  assert.equal(moved.source, 'override')
  assert.equal(moved.confidence, CONFIDENCE.CURATED, 'it is still being shown as provisional')

  // Attendance: Arafah is dawn-to-sunset, so its baseline plans no meals.
  assert.deepEqual(mealsAttendedBy(NASREEN, fastsOn(from, {})), [])
  assert.deepEqual(mealsAttendedBy(NASREEN, fastsOn(to, {})), ['breakfast', 'lunch', 'dinner'])
  assert.deepEqual(mealsAttendedBy(NASREEN, fastsOn(from, ov)), ['breakfast', 'lunch', 'dinner'])
  assert.deepEqual(mealsAttendedBy(NASREEN, fastsOn(to, ov)), [])

  // And the pool. Arafah's baseline is allium-free, so the day narrows it.
  assert.ok(poolOn(from, {}) < poolOn(to, {}), 'the fast day did not narrow the pool to begin with')
  assert.equal(poolOn(to, ov), poolOn(from, {}), 'the narrowing did not move with the date')
  assert.equal(poolOn(from, ov), poolOn(to, {}), 'the old day did not go back to normal')
})

test('the traditions a family observes are the ones offered for editing', () => {
  const ids = observedObservanceIds([NASREEN])
  assert.deepEqual(ids, ['arafah'])
  assert.equal(templateFor(ids[0]).name, 'Day of Arafah')
  assert.deepEqual(observedObservanceIds([]), [])
})
