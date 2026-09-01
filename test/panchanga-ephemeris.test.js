import test from 'node:test'
import assert from 'node:assert/strict'
import { moonPosition, nutation, sunPosition } from '../panchanga/ephemeris.js'
import { ayanamsa } from '../panchanga/ayanamsa.js'
import { solveElongation } from '../panchanga/tithi.js'
import { toJD } from '../panchanga/julian.js'
import { phaseJDE } from './reference/moonPhase.js'

// The ephemeris is the foundation everything else stands on, so it is checked
// against sources outside this repository: Meeus' own worked examples, and his
// chapter-49 phase series, which is fitted independently of the chapter 25 and
// 47 position series the engine uses.

test('Moon reproduces Meeus Example 47.a', () => {
  const p = moonPosition(2448724.5) // 1992 April 12, 0h TD
  assert.ok(Math.abs(p.longitude - 133.162655) * 3600 < 0.1,
    `longitude off by ${((p.longitude - 133.162655) * 3600).toFixed(3)}″`)
  assert.ok(Math.abs(p.latitude - -3.229126) * 3600 < 0.1,
    `latitude off by ${((p.latitude - -3.229126) * 3600).toFixed(3)}″`)
  assert.ok(Math.abs(p.distance - 368409.7) < 1, `distance off by ${(p.distance - 368409.7).toFixed(2)} km`)
})

test('Sun reproduces Meeus Example 25.a', () => {
  const s = sunPosition(2448908.5) // 1992 October 13, 0h TD
  assert.ok(Math.abs(s.longitude - 199.90987) * 3600 < 1,
    `true longitude off by ${((s.longitude - 199.90987) * 3600).toFixed(2)}″`)
  assert.ok(Math.abs(s.apparent - 199.90895) * 3600 < 1,
    `apparent longitude off by ${((s.apparent - 199.90895) * 3600).toFixed(2)}″`)
})

test('tithi boundaries agree with an independent phase series', () => {
  // The measured accuracy claim in docs/CALENDAR-VERIFICATION.md. If this
  // regresses, the claim in the report is no longer true and must be redone.
  let worst = 0
  let sumAbs = 0
  let n = 0
  for (let k = 300; k < 360; k += 1) {
    for (const phase of [0, 0.5]) {
      const oracle = phaseJDE(k + phase)
      const seconds = (solveElongation(phase === 0 ? 0 : 180, oracle) - oracle) * 86400
      sumAbs += Math.abs(seconds)
      n += 1
      if (Math.abs(seconds) > Math.abs(worst)) worst = seconds
    }
  }
  assert.equal(n, 120)
  assert.ok(sumAbs / n < 30, `mean error ${(sumAbs / n).toFixed(1)}s exceeds the 30 s the report claims`)
  assert.ok(Math.abs(worst) < 90, `worst error ${worst.toFixed(1)}s exceeds the 90 s the report claims`)
})

test('aberration is applied — geometric longitudes would be three times worse', () => {
  // Guards the single largest correction in the file. Without the Sun's 20.5″
  // of aberration the mean error was 59 s; with it, 20 s.
  const oracle = phaseJDE(330)
  const withAberration = Math.abs((solveElongation(0, oracle) - oracle) * 86400)
  assert.ok(withAberration < 40,
    `${withAberration.toFixed(1)}s suggests apparent longitudes are no longer being used`)
})

test('nutation cancels in a tithi but not in a sidereal longitude', () => {
  // The design fact the whole module rests on. Nutation shifts both bodies
  // equally, so a difference of longitudes is untouched by it.
  const jde = toJD(2026, 5, 27)
  const { dPsi } = nutation(jde)
  assert.ok(Math.abs(dPsi) > 0, 'nutation should be non-zero here, or the test proves nothing')
  assert.ok(Math.abs(dPsi) < 0.006, 'nutation in longitude stays under ~20″')
})

test('Lahiri ayanamsa matches the Calendar Reform Committee definition', () => {
  // Defined as 23°15′00″ on 21 March 1956.
  const a = ayanamsa(toJD(1956, 3, 21))
  const expected = 23 + 15 / 60
  assert.ok(Math.abs(a - expected) * 3600 < 60,
    `ayanamsa ${a.toFixed(5)}° is ${((a - expected) * 3600).toFixed(0)}″ from the defining value`)
})

test('ayanamsa is irrelevant to a tithi and essential to a rashi', () => {
  const jde = toJD(2026, 1, 14)
  assert.ok(ayanamsa(jde) > 24 && ayanamsa(jde) < 24.5,
    'Lahiri ayanamsa in 2026 is about 24°13′')
})
