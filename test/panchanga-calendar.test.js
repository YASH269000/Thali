import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_LOCATION, TITHI_RULES, adhikaMaasFor, christianDates, easter,
  resolveTithiRule, solarIngresses,
} from '../panchanga/index.js'
import { hijriToJD, jdToHijri } from '../panchanga/hijri.js'
import { sunRiseSet } from '../panchanga/riseset.js'
import { isoToJD, fromJD, jdToJde } from '../panchanga/julian.js'
import { describeTithi, tithiIndexAt } from '../panchanga/tithi.js'

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

test('Padmini is Dashami-viddha, so both schools keep the second day', () => {
  // The tithi is current at both sunrises, so the plain rule would give Smarta
  // the 26th. Dashami ran to 05:12 against a 05:25 sunrise — inside arunodaya —
  // so the 26th is viddha and the vrat moves. This is what Drik Panchang,
  // ISKCON and the panchang media publish, and it is the whole reason the
  // engine needed a viddha rule rather than the two-sunrise rule alone.
  const padmini = resolveTithiRule(rule('ekadashi_vrat'), 2026, place)
    .find((e) => e.ekadashiName === 'Padmini')
  assert.equal(padmini.spansTwoSunrises, true)
  assert.equal(padmini.dashamiViddha, true)
  assert.equal(padmini.smarta, '2026-05-27')
  assert.equal(padmini.vaishnava, '2026-05-27')
})

test('the whole 2026 comparison table reproduces, dates and names', async () => {
  const { EKADASHI_2026, normaliseName } = await import('./reference/ekadashi2026.js')
  const mine = resolveTithiRule(rule('ekadashi_vrat'), 2026, place)
  assert.equal(mine.length, EKADASHI_2026.length)
  EKADASHI_2026.forEach((expected, i) => {
    assert.equal(mine[i].smarta, expected.date, `row ${i + 1} date`)
    assert.equal(normaliseName(mine[i].ekadashiName), normaliseName(expected.name), `row ${i + 1} name`)
  })
})

test('the Padmini tithi window matches the cited authority to a minute', () => {
  // If the window matches and only the day assignment differs, the question is
  // convention, not accuracy. It matched, which is why the viddha rule above
  // was the right fix rather than anything in the ephemeris.
  const { PADMINI_WINDOW } = { PADMINI_WINDOW: { begins: [2026, 5, 26, 5, 10], ends: [2026, 5, 27, 6, 21] } }
  const padmini = resolveTithiRule(rule('ekadashi_vrat'), 2026, place)
    .find((e) => e.ekadashiName === 'Padmini')
  const asLocal = (jd) => fromJD(jd + place.tz / 24)
  const s = asLocal(padmini.startsAt)
  const e = asLocal(padmini.endsAt)
  const [, , sd, sh, sm] = PADMINI_WINDOW.begins
  const [, , ed, eh, em] = PADMINI_WINDOW.ends
  const startDiff = Math.abs((s.day - sd) * 1440 + (s.hour - sh) * 60 + (s.minute - sm))
  const endDiff = Math.abs((e.day - ed) * 1440 + (e.hour - eh) * 60 + (e.minute - em))
  assert.ok(startDiff <= 5, `tithi start differs from Drik Panchang by ${startDiff} min`)
  assert.ok(endDiff <= 5, `tithi end differs from Drik Panchang by ${endDiff} min`)
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

test('Pradosh is decided by a window after sunset, not the instant of it', () => {
  // 3 May 2027: Trayodashi begins 67 minutes after sunset, so the instant and
  // the window disagree about whether that evening qualifies at all. The
  // following evening holds more overlap and wins either way — this pins the
  // outcome so a change to PRADOSH_KAAL_MINUTES cannot move it silently.
  const p = dates('pradosh_vrat', 2027)
  assert.ok(p.includes('2027-05-04'), 'the evening with the greater overlap')
  assert.ok(!p.includes('2027-05-03'), 'the evening Trayodashi barely clips')
})

test('every Pradosh day has Trayodashi overlapping its pradosh kaal', () => {
  // The defining property. If a computed date fails this, the rule is not
  // being applied, whatever the date happens to look like.
  for (const year of [2026, 2027]) {
    for (const e of resolveTithiRule(rule('pradosh_vrat'), year, place)) {
      const { sunset } = sunRiseSet(isoToJD(e.smarta, place.tz), place)
      const windowEnd = sunset + 72 / 1440
      const overlap = Math.min(e.endsAt, windowEnd) - Math.max(e.startsAt, sunset)
      assert.ok(overlap > 0,
        `${e.smarta}: Trayodashi does not reach pradosh kaal`)
      assert.equal(e.tithi.number, 13, `${e.smarta} is not a Trayodashi`)
    }
  }
})

test('the app\'s disputed 2026 dates are the wrong tithi, not a rule difference', () => {
  // Refutation by computation rather than by assertion — the claim made in
  // section 5 of the report. Each app date carries a tithi that cannot be the
  // observance under any school, because a tithi is the same instant everywhere.
  const at = (iso) => {
    const { sunrise } = sunRiseSet(isoToJD(iso, place.tz), place)
    return describeTithi(tithiIndexAt(jdToJde(sunrise)))
  }
  assert.notEqual(at('2026-08-14').name, 'Ashtami', 'app Janmashtami date')
  assert.notEqual(at('2026-12-22').name, 'Ekadashi', 'app Mokshada date')
  assert.notEqual(at('2026-10-25').number, 4, 'app Karwa Chauth date')
})

test('a tight margin is not the same as an unstable date', () => {
  // The distinction the report turns on, and one the margin alone got wrong in
  // both directions: most tight margins are stable, and some dates the margin
  // never flagged do move.
  const rows = []
  for (const year of [2026, 2027]) {
    for (const r of TITHI_RULES) rows.push(...resolveTithiRule(r, year, place))
  }
  const tight = rows.filter((e) => e.atRisk)
  const unstable = rows.filter((e) => e.needsConfirmation)

  assert.ok(tight.some((e) => e.stable), 'some tight margins must be stable, or the test proves nothing')
  assert.ok(unstable.some((e) => !e.atRisk), 'some unstable dates are not flagged by margin')
  for (const e of rows) {
    assert.equal(typeof e.stable, 'boolean', `${e.smarta} has no stability verdict`)
    assert.equal(e.needsConfirmation, !e.stable)
  }
})

test('Padmini is tight but stable — a date worth shipping', () => {
  const padmini = resolveTithiRule(rule('ekadashi_vrat'), 2026, place)
    .find((e) => e.ekadashiName === 'Padmini')
  assert.ok(padmini.margin < 15, 'it really is a tight boundary')
  assert.equal(padmini.stable, true, 'both sides of the boundary give 27 May')
  assert.equal(padmini.needsConfirmation, false)
})
