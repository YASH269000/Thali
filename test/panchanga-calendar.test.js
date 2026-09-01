import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_LOCATION, TITHI_RULES, adhikaMaasFor, christianDates, easter,
  resolveTithiRule, solarIngresses,
} from '../panchanga/index.js'
import { hijriToJD, jdToHijri } from '../panchanga/hijri.js'
import { sunRiseSet } from '../panchanga/riseset.js'
import { isoToJD, fromJD } from '../panchanga/julian.js'

const place = DEFAULT_LOCATION
const rule = (id) => TITHI_RULES.find((r) => r.id === id)
const dates = (id, year) => resolveTithiRule(rule(id), year, place).map((e) => e.smarta)

/* ---- Christian: closed form, so these are exact or the code is wrong ---- */

test('computus gives the known Easters', () => {
  const known = {
    2024: [3, 31], 2025: [4, 20], 2026: [4, 5], 2027: [3, 28], 2028: [4, 16], 2030: [4, 21],
  }
  for (const [year, [month, day]] of Object.entries(known)) {
    const e = easter(Number(year))
    assert.deepEqual([e.month, e.day], [month, day], `Easter ${year}`)
  }
})

test('Lent is derived from Easter, not tabulated', () => {
  const d = christianDates(2026)
  assert.deepEqual([d.easter.month, d.easter.day], [4, 5])
  assert.deepEqual([d.ashWednesday.month, d.ashWednesday.day], [2, 18])
  assert.deepEqual([d.goodFriday.month, d.goodFriday.day], [4, 3])
})

/* ---- Islamic: arithmetic, and provisional by construction -------------- */

test('the Hijri epoch and round trip hold', () => {
  assert.equal(hijriToJD(1, 1, 1), 1948440)
  assert.deepEqual(jdToHijri(hijriToJD(1447, 9, 1)), { year: 1447, month: 9, day: 1 })
})

test('Eid al-Adha 1447 lands on the date India actually split over', () => {
  // 27 May 2026 in Jammu & Kashmir, 28 May elsewhere. The tabular calendar
  // gives one of them, which is the point of marking it provisional.
  const g = fromJD(hijriToJD(1447, 12, 10))
  assert.deepEqual([g.year, g.month, g.day], [2026, 5, 27])
})

/* ---- Hindu: the rules, not a table ------------------------------------ */

test('2026 has an Adhik Maas and 2027 does not', () => {
  const a26 = adhikaMaasFor(2026, place)
  assert.equal(a26.adhika.length, 1, 'exactly one intercalary month in 2026')
  assert.equal(a26.adhika[0].name, 'Adhika Jyeshtha')
  assert.equal(a26.adhika[0].from, '2026-05-17')
  assert.equal(a26.adhika[0].to, '2026-06-15')
  assert.equal(adhikaMaasFor(2027, place).adhika.length, 0)
})

test('the intercalary month is the one with no solar ingress', () => {
  const { months } = adhikaMaasFor(2026, place)
  const adhika = months.filter((m) => m.sankrantis.length === 0)
  assert.equal(adhika.length, 1)
  assert.equal(adhika[0].label, 'Adhika Jyeshtha')
  // Every other month has exactly one; two would be a kshaya month.
  for (const m of months) {
    if (m.label === 'Adhika Jyeshtha') continue
    assert.equal(m.sankrantis.length, 1, `${m.label} should have exactly one ingress`)
  }
})

test('an Adhik Maas renames Ekadashis rather than adding them to a Gregorian year', () => {
  // The counter-intuitive result the report turns on. A Gregorian year holds
  // ~12.37 lunations whatever they are called.
  assert.equal(dates('ekadashi_vrat', 2026).length, 24)
  assert.equal(dates('ekadashi_vrat', 2027).length, 25)
  const named = resolveTithiRule(rule('ekadashi_vrat'), 2026, place)
    .filter((e) => e.adhikaMasa)
    .map((e) => e.ekadashiName)
  assert.deepEqual(named, ['Padmini', 'Parama'], 'the leap month carries these two and only these')
})

test('Padmini spans two sunrises, so Smarta and Vaishnava differ', () => {
  const padmini = resolveTithiRule(rule('ekadashi_vrat'), 2026, place)
    .find((e) => e.ekadashiName === 'Padmini')
  assert.equal(padmini.spansTwoSunrises, true)
  assert.equal(padmini.smarta, '2026-05-26')
  assert.equal(padmini.vaishnava, '2026-05-27')
  assert.ok(padmini.vaishnava > padmini.smarta, 'Vaishnava takes the later day, by rule')
})

test('where a tithi claims one sunrise the two schools agree', () => {
  const all = resolveTithiRule(rule('ekadashi_vrat'), 2026, place)
  for (const e of all) {
    if (e.spansTwoSunrises) continue
    assert.equal(e.smarta, e.vaishnava, `${e.ekadashiName} should not split`)
  }
})

test('festivals fixed at nishita or madhyahna are not resolved at sunrise', () => {
  // Both of these move by a full day under the correct rule, onto the
  // published date. Resolving them at sunrise was measurably wrong.
  assert.deepEqual(dates('maha_shivaratri', 2026), ['2026-02-15'])
  assert.deepEqual(dates('ganesh_chaturthi', 2026), ['2026-09-14'])
  assert.deepEqual(dates('janmashtami', 2026), ['2026-09-04'])
  assert.deepEqual(dates('karwa_chauth', 2026), ['2026-10-29'])
})

test('Janmashtami 2026 says out loud that nishita gives no answer', () => {
  const j = resolveTithiRule(rule('janmashtami'), 2026, place)[0]
  assert.match(j.kaalNote || '', /No nishita falls inside this tithi/)
})

test('Makar Sankranti falls on 14 or 15 January', () => {
  for (const year of [2026, 2027, 2028]) {
    const mk = solarIngresses(year, place).find((s) => s.rashi === 'Makara')
    assert.match(mk.date, new RegExp(`^${year}-01-(14|15)$`), `Makar Sankranti ${year} = ${mk.date}`)
  }
})

test('every Ekadashi is the 11th tithi of its fortnight', () => {
  for (const year of [2026, 2027]) {
    for (const e of resolveTithiRule(rule('ekadashi_vrat'), year, place)) {
      assert.equal(e.tithi.number, 11, `${e.smarta} is not an 11th tithi`)
      assert.equal(e.tithi.name, 'Ekadashi')
    }
  }
})

test('Ekadashis alternate fortnights and never bunch', () => {
  const all = resolveTithiRule(rule('ekadashi_vrat'), 2026, place)
  for (let i = 1; i < all.length; i += 1) {
    const gap = (Date.parse(all[i].smarta) - Date.parse(all[i - 1].smarta)) / 86400000
    assert.ok(gap >= 13 && gap <= 17, `${all[i - 1].smarta} → ${all[i].smarta} is ${gap} days apart`)
  }
})

/* ---- Rise and set ----------------------------------------------------- */

test('Delhi sunrise and sunset bracket the solstices correctly', () => {
  const dayLength = (iso) => {
    const { sunrise, sunset } = sunRiseSet(isoToJD(iso, place.tz), place)
    return (sunset - sunrise) * 24
  }
  const june = dayLength('2026-06-21')
  const december = dayLength('2026-12-21')
  assert.ok(june > 13.8 && june < 14.1, `June solstice day length ${june.toFixed(2)}h`)
  assert.ok(december > 10.2 && december < 10.5, `December solstice day length ${december.toFixed(2)}h`)
  assert.ok(june > december)
})

test('a margin is a distance and is never negative', () => {
  for (const year of [2026, 2027]) {
    for (const r of TITHI_RULES) {
      for (const e of resolveTithiRule(r, year, place)) {
        assert.ok(e.margin >= 0, `${e.name} ${e.smarta} has margin ${e.margin}`)
        assert.ok(Number.isFinite(e.margin), `${e.name} ${e.smarta} margin is not finite`)
      }
    }
  }
})
