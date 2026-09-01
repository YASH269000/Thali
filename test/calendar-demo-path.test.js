// The demo, as a test.
//
// Everything below is the path a person walks through the app on a fast day:
// a family whose members keep Ekadashi, a year view that should show all
// twenty-four of them, the five dates that ask a question, and a real 2026
// Ekadashi date narrowing the recipe pool. It was verified by hand once; this
// is so it stays verified.

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import { activeFastIdsOn, fastingYear, calendarNotesOn } from '../src/lib/fastingRules.js'
import { CONFIDENCE, isoDateOf, observancesOn } from '../src/lib/observances.js'
import { confirmDate, moveDate } from '../src/lib/observanceOverrides.js'
import { filterRecipes } from '../src/lib/mealPlanRules.js'

const RECIPES = JSON.parse(fs.readFileSync(new URL('../src/data/recipes.json', import.meta.url), 'utf8'))

const member = (o) => ({
  id: 'm', name: 'Asha', age: 40, relationship: 'self', diet: 'vegetarian',
  health: [], fasts: [], religion: 'Hindu', cuisine: 'north_indian',
  spiceLevel: 2, dislikes: '', lifeStage: 'adult', ...o,
})

// Sumitra keeps Ekadashi and nothing else. Vrinda keeps Ekadashi and Navratri.
const SUMITRA = member({ id: 'm1', name: 'Sumitra', age: 62, lifeStage: 'elderly', fasts: ['ekadashi_vrat'] })
const VRINDA = member({ id: 'm2', name: 'Vrinda', age: 38, fasts: ['ekadashi_vrat', 'navratri_vrat'] })
const FAMILY = [SUMITRA, VRINDA]

/** The days of `year` on which `id` shows in the year view. */
function daysWith(year, id, overrides) {
  const out = []
  for (const mo of fastingYear(FAMILY, year, overrides).months) {
    for (const d of mo.days) {
      if (d.observances.some((o) => o.id === id)) out.push(isoDateOf(d.date))
    }
  }
  return out
}

// From docs/CALENDAR-VERIFICATION.md §7a — the engine's 2026 Ekadashis, which
// agreed with the supplied 24-row table on all 24 dates and all 24 names.
const EKADASHI_2026 = [
  '2026-01-14', '2026-01-29', '2026-02-13', '2026-02-27', '2026-03-15', '2026-03-29',
  '2026-04-13', '2026-04-27', '2026-05-13', '2026-05-27', '2026-06-11', '2026-06-25',
  '2026-07-10', '2026-07-25', '2026-08-09', '2026-08-23', '2026-09-07', '2026-09-22',
  '2026-10-06', '2026-10-22', '2026-11-05', '2026-11-20', '2026-12-04', '2026-12-20',
]

test('the year view shows all 24 Ekadashis of 2026, not the two that were curated', () => {
  const marked = daysWith(2026, 'ekadashi_vrat')
  assert.equal(marked.length, 24,
    `${marked.length} Ekadashi days. The curated calendar held two — Sep 7 and Dec 22 — `
    + 'and a year has twenty-four.')
  assert.deepEqual(marked, EKADASHI_2026)
})

test('2027 has 25, which is the other right answer for a Gregorian year', () => {
  assert.equal(daysWith(2027, 'ekadashi_vrat').length, 25)
})

test('Sumitra and Vrinda both keep every one of them', () => {
  const year = fastingYear(FAMILY, 2026)
  const sumitra = year.perMember.find((p) => p.name === 'Sumitra')
  const vrinda = year.perMember.find((p) => p.name === 'Vrinda')

  assert.deepEqual(sumitra.breakdown, [{ label: 'Ekadashi Vrat', count: 24 }])
  assert.equal(vrinda.breakdown.find((b) => b.label === 'Ekadashi Vrat').count, 24)

  // Vrinda additionally keeps both Navratris: Chaitra and Sharad, nine tithis
  // each, and the engine resolves the last day as Navami rather than assuming
  // a ninth day that a kshaya tithi can take away.
  assert.equal(vrinda.breakdown.find((b) => b.label === 'Navratri Vrat').count, 19)
  assert.ok(vrinda.dayCount > sumitra.dayCount)
})

test('the five corrected observances land on the computed dates', () => {
  // Every one of these was wrong in the app's own 2026 calendar. The last
  // column of docs/CALENDAR-VERIFICATION.md §5 settles each by calculation:
  // on the date the app gave, a different tithi was running.
  const corrected = {
    maha_shivaratri: ['2026-02-15'],
    janmashtami: ['2026-09-04'],
    ganesh_chaturthi: ['2026-09-14'],
    karwa_chauth: ['2026-10-29'],
  }
  for (const [id, dates] of Object.entries(corrected)) {
    assert.deepEqual(daysWith(2026, id), dates, id)
  }
  // Mokshada Ekadashi was the fifth: 22 December in the app data, which was
  // shukla Trayodashi, against the 20th the engine computes.
  assert.ok(EKADASHI_2026.includes('2026-12-20'))
  assert.ok(!EKADASHI_2026.includes('2026-12-22'))
})

test('five dates across the two years ask to be confirmed, and no others', () => {
  const all = [...fastingYear(FAMILY, 2026).months, ...fastingYear(FAMILY, 2027).months]
  const flagged = all.flatMap((mo) => mo.days.filter((d) => d.needsConfirmation).map((d) => isoDateOf(d.date)))
  // Narrowed to what this family keeps: of the five unstable dates, only the
  // Yogini Ekadashi is one of Sumitra's or Vrinda's.
  assert.deepEqual(flagged, ['2026-07-10'])
  assert.deepEqual(fastingYear(FAMILY, 2026).confirmations.map((c) => c.date), ['2026-07-10'])
  assert.deepEqual(fastingYear(FAMILY, 2027).confirmations.map((c) => c.date), [])
})

test('a family that confirms a date settles it; one that moves it moves it', () => {
  const confirmed = confirmDate({}, 'ekadashi_vrat', '2026-07-10')
  assert.deepEqual(fastingYear(FAMILY, 2026, confirmed).confirmations, [],
    'a confirmed date stops asking')
  assert.ok(daysWith(2026, 'ekadashi_vrat', confirmed).includes('2026-07-10'))

  const moved = moveDate({}, 'ekadashi_vrat', '2026-07-10', '2026-07-11')
  const days = daysWith(2026, 'ekadashi_vrat', moved)
  assert.ok(days.includes('2026-07-11'), 'the fast moved to the day the family keeps')
  assert.ok(!days.includes('2026-07-10'), 'and left the day it was calculated for')
  assert.equal(days.length, 24, 'the other twenty-three are untouched')
})

test('user override outranks curated, which outranks computed', () => {
  // Computed: nothing curated claims an Ekadashi, so the engine decides.
  const [ekadashi] = observancesOn(new Date(2026, 8, 7))
  assert.equal(ekadashi.source, 'computed')
  assert.equal(ekadashi.confidence, CONFIDENCE.COMPUTED)

  // Curated: Paryushana is set by the Shvetambar order and the engine holds
  // no rule for it, so it comes from the table and says so.
  const paryushana = observancesOn(new Date(2026, 8, 10))
    .find((o) => o.id === 'paryushana_parva')
  assert.equal(paryushana.source, 'curated')
  assert.equal(paryushana.confidence, CONFIDENCE.CURATED)

  // Override: on top of either.
  const moved = moveDate({}, 'ekadashi_vrat', '2026-09-07', '2026-09-08')
  assert.equal(observancesOn(new Date(2026, 8, 7), moved).length, 0)
  const [shifted] = observancesOn(new Date(2026, 8, 8), moved)
  assert.equal(shifted.source, 'override')
  assert.equal(shifted.movedFrom, '2026-09-07')
})

test('every observance carries a confidence', () => {
  for (const year of [2026, 2027]) {
    for (let d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 1)) {
      for (const o of observancesOn(new Date(d))) {
        assert.ok(Object.values(CONFIDENCE).includes(o.confidence),
          `${o.id} on ${isoDateOf(d)} has confidence ${o.confidence}`)
      }
    }
  }
})

/* ------------------------------------------------------------------ *
 * The pool still narrows on a fast day                                *
 * ------------------------------------------------------------------ */

const poolOn = (date, family = FAMILY) =>
  filterRecipes(RECIPES, family, activeFastIdsOn(date)).mains.length

test('a real 2026 Ekadashi narrows the pool, and an ordinary day does not', () => {
  const ordinary = poolOn(new Date(2026, 8, 9))
  const ekadashi = poolOn(new Date(2026, 8, 7))
  assert.ok(ekadashi < ordinary,
    `Ekadashi pool ${ekadashi} is not smaller than the ordinary ${ordinary}`)
  assert.ok(ekadashi > 0, 'and something is still servable')
})

test('the same narrowing happens on a date the curated calendar never knew', () => {
  // 14 January 2026 is Shattila Ekadashi. No row in the old calendar mentioned
  // it, so this day planned an unrestricted menu for a family keeping the fast.
  const before = poolOn(new Date(2026, 0, 13))
  const during = poolOn(new Date(2026, 0, 14))
  assert.ok(during < before, `${during} was not smaller than ${before}`)
  assert.ok(activeFastIdsOn(new Date(2026, 0, 14)).has('ekadashi_vrat'))
})

// Days in 2026 carrying an observance the guidance table says nothing about.
const GUIDANCE_FREE_DAYS = [
  new Date(2026, 0, 3), new Date(2026, 0, 6), new Date(2026, 0, 18),
  new Date(2026, 1, 1), new Date(2026, 2, 3),
].filter((d) => calendarNotesOn(d).some((n) => !('impact' in n)))

test('the prompt is told what day it is, with no empty fields', () => {
  const notes = calendarNotesOn(new Date(2026, 8, 7))
  assert.equal(notes.length, 1)
  assert.equal(notes[0].observance, 'Aja Ekadashi')
  assert.equal(notes[0].confidence, CONFIDENCE.COMPUTED)
  assert.ok(notes[0].impact.includes('sendha namak'))
  for (const note of notes) {
    for (const [key, value] of Object.entries(note)) {
      assert.ok(value !== null && value !== undefined && value !== '',
        `calendar note field ${key} is empty`)
    }
  }

  // A day whose observance carries no curated guidance still names the day,
  // and carries no blank impact or action fields for the model to read.
  //
  // The observance is found rather than named: this used to pin Vinayaka
  // Chaturthi, which then acquired guidance when it got a tradition row of
  // its own, and the test failed for a change that was entirely correct. What
  // it means to assert is that SOME observance has no guidance and still
  // names its day — not that any particular one is guidance-less forever.
  const guidanceless = GUIDANCE_FREE_DAYS.find((d) => calendarNotesOn(d).length > 0)
  assert.ok(guidanceless, 'every observance now carries guidance — good, but retire this test')
  for (const note of calendarNotesOn(guidanceless)) {
    assert.ok(note.observance, 'a note that names no day')
    if ('impact' in note) continue
    assert.ok(!('appAction' in note), 'a note with an action but no impact')
  }
})
