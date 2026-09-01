// An INDEPENDENT oracle for new and full moon instants. Test-only.
//
// Meeus chapter 49 is a series fitted directly to the phases, derived
// separately from the chapter 25 and 47 position series the engine uses. So
// comparing the engine's "elongation crosses 0°" against this gives a real
// measurement of tithi-boundary error rather than a repeat of the same
// arithmetic — which is the whole point: the engine's accuracy claim has to be
// checked against something that does not share its assumptions.
//
// Nothing in panchanga/ imports this, and nothing should.

const DEG = Math.PI / 180
const sin = (d) => Math.sin(d * DEG)

// Corrections for new moon and for full moon. Meeus, ch. 49.
// [coefficient, powerOfE, multiples of M', M, F, omega]
const NEW_MOON = [
  [-0.40720, 0, 1, 0, 0], [0.17241, 1, 0, 1, 0], [0.01608, 0, 2, 0, 0],
  [0.01039, 0, 0, 0, 2], [0.00739, 1, 1, -1, 0], [-0.00514, 1, 1, 1, 0],
  [0.00208, 2, 0, 2, 0], [-0.00111, 0, 1, 0, -2], [-0.00057, 0, 1, 0, 2],
  [0.00056, 1, 2, 1, 0], [-0.00042, 0, 3, 0, 0], [0.00042, 1, 0, 1, 2],
  [0.00038, 1, 0, 1, -2], [-0.00024, 1, 2, -1, 0], [-0.00007, 0, 1, 2, 0],
  [0.00004, 0, 2, 0, -2], [0.00004, 0, 0, 3, 0], [0.00003, 0, 1, 1, -2],
  [0.00003, 0, 2, 0, 2], [-0.00003, 0, 1, 1, 2], [0.00003, 0, 1, -1, 2],
  [-0.00002, 0, 1, -1, -2], [-0.00002, 0, 3, 1, 0], [0.00002, 0, 4, 0, 0],
]

const FULL_MOON = [
  [-0.40614, 0, 1, 0, 0], [0.17302, 1, 0, 1, 0], [0.01614, 0, 2, 0, 0],
  [0.01043, 0, 0, 0, 2], [0.00734, 1, 1, -1, 0], [-0.00515, 1, 1, 1, 0],
  [0.00209, 2, 0, 2, 0], [-0.00111, 0, 1, 0, -2], [-0.00057, 0, 1, 0, 2],
  [0.00056, 1, 2, 1, 0], [-0.00042, 0, 3, 0, 0], [0.00042, 1, 0, 1, 2],
  [0.00038, 1, 0, 1, -2], [-0.00024, 1, 2, -1, 0], [-0.00007, 0, 1, 2, 0],
  [0.00004, 0, 2, 0, -2], [0.00004, 0, 0, 3, 0], [0.00003, 0, 1, 1, -2],
  [0.00003, 0, 2, 0, 2], [-0.00003, 0, 1, 1, 2], [0.00003, 0, 1, -1, 2],
  [-0.00002, 0, 1, -1, -2], [-0.00002, 0, 3, 1, 0], [0.00002, 0, 4, 0, 0],
]

// The 14 additional planetary arguments, common to every phase.
const EXTRA = [
  [0.000325, 299.77, 0.107408, -0.009173], [0.000165, 251.88, 0.016321, 0],
  [0.000164, 251.83, 26.651886, 0], [0.000126, 349.42, 36.412478, 0],
  [0.000110, 84.66, 18.206239, 0], [0.000062, 141.74, 53.303771, 0],
  [0.000060, 207.14, 2.453732, 0], [0.000056, 154.84, 7.306860, 0],
  [0.000047, 34.52, 27.261239, 0], [0.000042, 207.19, 0.121824, 0],
  [0.000040, 291.34, 1.844379, 0], [0.000037, 161.72, 24.198154, 0],
  [0.000035, 239.56, 25.513099, 0], [0.000023, 331.55, 3.592518, 0],
]

/**
 * JDE (TT) of the phase for lunation index k.
 * @param {number} k integer for new moon, k + 0.5 for full moon
 */
export function phaseJDE(k) {
  const T = k / 1236.85
  const T2 = T * T
  const T3 = T2 * T
  const T4 = T3 * T

  let jde = 2451550.09766 + 29.530588861 * k
    + 0.00015437 * T2 - 0.000000150 * T3 + 0.00000000073 * T4

  const E = 1 - 0.002516 * T - 0.0000074 * T2
  const M = 2.5534 + 29.10535670 * k - 0.0000014 * T2 - 0.00000011 * T3
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2
    + 0.00001238 * T3 - 0.000000058 * T4
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T2
    - 0.00000227 * T3 + 0.000000011 * T4
  const omega = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3

  const isFull = Math.abs(k - Math.floor(k) - 0.5) < 1e-9
  for (const [coeff, powE, nMp, nM, nF] of (isFull ? FULL_MOON : NEW_MOON)) {
    jde += coeff * E ** powE * sin(nMp * Mp + nM * M + nF * F)
  }
  jde += -0.00017 * sin(omega)

  for (const [coeff, a, b, c] of EXTRA) {
    jde += coeff * sin(a + b * k + c * T2)
  }
  return jde
}

/** Lunation index nearest a given date, for either phase. */
export function kFor(year, monthFraction, phase = 0) {
  return Math.round((year + monthFraction - 2000) * 12.3685 - phase) + phase
}
